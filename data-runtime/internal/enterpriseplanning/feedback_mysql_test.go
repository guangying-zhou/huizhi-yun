package enterpriseplanning

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestMySQLLightweightFeedbackAtomicRegisteredOutbox(t *testing.T) {
	db, registry, b := planningMySQLFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// A legacy logical table deliberately points somewhere else. The producer
	// must resolve the registered owner, never rely on an ambiguous view.
	exec("DROP VIEW integration_operation")
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	permit := func(resource, action string) pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: resource, Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	id := func(action string) pc.CommandIdentity {
		return pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: action, IdempotencyKey: action}
	}
	must := func(result pc.CommandResult, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var v map[string]any
		if err = json.Unmarshal(result.Value, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	request := must(pc.CreateProductRequest(ctx, db, id("product_requests:create"), permit("product_requests", "create"), pc.RequestDraft{ExpectedRevision: 1, Title: "Feedback", ProblemStatement: "Feedback", SourceType: "internal", UrgencyLevel: "P2"}))
	requestBiz := request["biz_id"].(string)
	exec("INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_requests WHERE biz_id=?", requestBiz)
	exec("INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-1','P',request_id,id,'pm',UTC_TIMESTAMP(3) FROM product_request_sources WHERE source_type='service_ticket'")
	unbound, err := NewPlanningService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	owner := "pm"
	version := must(unbound.CreateProductCenterVersion(ctx, id("product_versions:create"), permit("product_versions", "edit"), pc.ProductVersionDraft{ExpectedRevision: 2, VersionCode: "v1", Name: "v1", PlanningMode: "simple", BusinessOwnerUID: &owner}))
	versionID := int64(version["id"].(float64))
	input := pc.LightweightVersionPlanItemCreate{VersionID: versionID, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, ExpectedRequestRevision: 1, RequestBizID: requestBiz, ScopeSummary: "Scope", AdoptRequest: true}
	call := func(s *PlanningService) (pc.CommandResult, error) {
		return s.CreateLightweightVersionPlanItem(ctx, id("product_versions:plan-item-create"), permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	}
	if _, err = call(unbound); err == nil {
		t.Fatal("linked feedback without explicit worker accepted")
	}
	writer := unbound.writer
	resolved, err := registry.Resolve(writer)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(writer, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewPlanningService(ctx, registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	exec("CREATE TRIGGER feedback_late_failure BEFORE INSERT ON u_product_activity_logs FOR EACH ROW BEGIN IF NEW.action='plan-item-create' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late failure'; END IF; END")
	if _, err = call(service); err == nil {
		t.Fatal("late audit accepted")
	}
	var count int
	for _, table := range []string{"u_integration_operation", "product_planning_items", "product_version_plan_scopes"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("rollback", table, count, err)
		}
	}
	var status string
	if err = db.QueryRow("SELECT decision_status FROM product_requests WHERE biz_id=?", requestBiz).Scan(&status); err != nil || status != "submitted" {
		t.Fatal(status, err)
	}
	exec("DROP TRIGGER feedback_late_failure")
	must(call(service))
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation WHERE tenant_code='tenant' AND deployment_code='real-aims-worker' AND source_app='aims' AND original_actor_uid='pm'").Scan(&count); err != nil || count != 2 {
		t.Fatal("mapped events", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong table", count, err)
	}
	replay, err := pc.CreateLightweightVersionPlanItem(ctx, db, id("product_versions:plan-item-create"), permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	if err != nil || !replay.Replayed {
		t.Fatal("old replay", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation").Scan(&count); err != nil || count != 2 {
		t.Fatal("duplicate events", count, err)
	}
}

func TestMySQLRequestDecisionMergeFeedbackAtomic(t *testing.T) {
	db, registry, b := planningMySQLFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("DROP VIEW integration_operation")
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	a, z := uuid.NewString(), uuid.NewString()
	exec("INSERT INTO product_requests(id,biz_id,product_code,title,decision_status,created_by,updated_by,created_at,updated_at) VALUES(1,?,'P','First','submitted','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),(2,?,'P','Second','submitted','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", a, z)
	exec("INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_requests")
	exec("INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket',CONCAT('ST-',request_id),'P',request_id,id,'pm',UTC_TIMESTAMP(3) FROM product_request_sources")
	permit := func() pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: "product_requests", Action: "decide", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	unbound, err := NewRequestService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := registry.Resolve(unbound.writer)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(unbound.writer, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewRequestService(ctx, registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	decisionID := pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: "product_requests:decide", IdempotencyKey: "decision"}
	decision := pc.RequestDecision{BizID: a, ExpectedRevision: 1, ExpectedRequestRevision: 1, Status: "evaluating"}
	if _, err = unbound.Decide(ctx, decisionID, permit(), decision); err == nil {
		t.Fatal("decision missing worker")
	}
	exec("CREATE TRIGGER feedback_decision_late BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late failure'")
	if _, err = service.Decide(ctx, decisionID, permit(), decision); err == nil {
		t.Fatal("decision late failure")
	}
	var count int
	var status string
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation").Scan(&count); err != nil || count != 0 {
		t.Fatal("decision outbox rollback", count, err)
	}
	if err = db.QueryRow("SELECT decision_status FROM product_requests WHERE id=1").Scan(&status); err != nil || status != "submitted" {
		t.Fatal("decision rollback", status, err)
	}
	exec("DROP TRIGGER feedback_decision_late")
	if _, err = service.Decide(ctx, decisionID, permit(), decision); err != nil {
		t.Fatal(err)
	}
	replay, err := pc.DecideProductRequest(ctx, db, decisionID, permit(), decision)
	if err != nil || !replay.Replayed {
		t.Fatal("decision replay", err)
	}
	mergeID := pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: "product_requests:merge", IdempotencyKey: "merge"}
	merge := pc.RequestMerge{BizID: z, TargetBizID: a, ExpectedRevision: 2, ExpectedRequestRevision: 1, ExpectedTargetRevision: 2, Reason: "same need"}
	if _, err = unbound.Merge(ctx, mergeID, permit(), merge); err == nil {
		t.Fatal("merge missing worker")
	}
	exec("CREATE TRIGGER feedback_merge_late BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late failure'")
	if _, err = service.Merge(ctx, mergeID, permit(), merge); err == nil {
		t.Fatal("merge late failure")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation").Scan(&count); err != nil || count != 2 {
		t.Fatal("merge outbox rollback", count, err)
	}
	if err = db.QueryRow("SELECT decision_status FROM product_requests WHERE id=2").Scan(&status); err != nil || status != "submitted" {
		t.Fatal("merge rollback", status, err)
	}
	exec("DROP TRIGGER feedback_merge_late")
	if _, err = service.Merge(ctx, mergeID, permit(), merge); err != nil {
		t.Fatal(err)
	}
	replay, err = pc.MergeProductRequest(ctx, db, mergeID, permit(), merge)
	if err != nil || !replay.Replayed {
		t.Fatal("merge replay", err)
	}
	// Merge emits the changed source status plus progress for both original identities.
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation").Scan(&count); err != nil || count != 5 {
		t.Fatal("family outbox", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 0 {
		t.Fatal("unregistered table", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalRequestBizId'))=? AND JSON_EXTRACT(command_json,'$.sourceRevision')=3", a).Scan(&count); err != nil || count != 2 {
		t.Fatal("merge canonical family", count, err)
	}
}
