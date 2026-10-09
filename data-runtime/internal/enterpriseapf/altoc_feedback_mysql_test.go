package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func feedbackFixture(t *testing.T) (*Service, *sql.DB, string) {
	t.Helper()
	s, db := ticketsFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithAltocFeedback(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocFeedback(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := inst.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	if e = inst.Apply(ctx, db, p, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = inst.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	names := []string{"product_workspaces", "product_members", "product_requests", "product_request_sources", "product_feedback_bindings", "product_activity_logs"}
	var source string
	for _, f := range []string{"migration_v5.19_product_center.sql", "migration_v5.36_product_feedback_bindings.sql"} {
		raw, e := os.ReadFile("../../../aims/docs/" + f)
		if e != nil {
			t.Fatal(e)
		}
		source += string(raw)
	}
	conn, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	if _, e = conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0"); e != nil {
		t.Fatal(e)
	}
	d := b.Domains["aims"]
	d.Tables = cloneStrings(d.Tables)
	for _, n := range names {
		ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS " + n + " \\(.*?ENGINE=InnoDB[^;]*;").FindString(source)
		if ddl == "" {
			t.Fatal(n)
		}
		for _, m := range names {
			ddl = regexp.MustCompile(`\b`+m+`\b`).ReplaceAllString(ddl, "f16_"+m)
		}
		if _, e = conn.ExecContext(ctx, ddl); e != nil {
			t.Fatal(n, e)
		}
		if _, e = conn.ExecContext(ctx, "CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW "+n+" AS SELECT * FROM f16_"+n); e != nil {
			t.Fatal(e)
		}
		d.Tables[n] = "f16_" + n
	}
	conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1")
	conn.Close()
	b.Domains["aims"] = d
	reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = reg.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e = New(reg, b)
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P','" + uuid.NewString() + "','person','person',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", "INSERT INTO product_members(product_code,uid,relation_type,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','person','manager',UTC_TIMESTAMP(3),'person','person',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "agreement"}
	v, e := s.Sales(ctx, "service-agreements-create", SalesInput{Payload: map[string]any{"name": "反馈标记", "contract_id": "1", "status": "active", "included_quota": "2", "quota_unit": "ticket"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	who.Key = "ticket"
	v, e = s.Sales(ctx, "service-tickets-create", SalesInput{Payload: map[string]any{"title": "中文反馈", "description": "首次证据", "ticket_type": "requirement", "service_agreement_id": fmt.Sprint(v.(map[string]any)["id"])}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(v.(map[string]any)["id"])
	if _, e = db.Exec("UPDATE altoc_service_ticket SET product_code='P' WHERE id=?", id); e != nil {
		t.Fatal(e)
	}
	return s, db, id
}
func cloneStrings(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		out[k] = v
	}
	return out
}
func TestAPFFeedbackCommandsMySQL(t *testing.T) {
	s, db, id := feedbackFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "feedback", RequestID: "isolated"}
	permit := func() string {
		f, e := pc.LoadAuthorizationFacts(ctx, db, "P", "person")
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(pc.AuthorizationPermit{Resource: "product_requests", Action: "create", Facts: f, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()})
		return string(raw)
	}
	call := func(op string, p map[string]any) map[string]any {
		t.Helper()
		v, e := s.Feedback(ctx, op, SalesInput{ID: id, Payload: p}, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	preview := call("product-feedback-view", map[string]any{})
	input := map[string]any{"expectedSourceSha256": preview["expectedSourceSha256"], "productAuthorization": permit()}
	bad := map[string]any{"expectedSourceSha256": strings.Repeat("0", 64), "productAuthorization": permit()}
	if _, e := s.Feedback(ctx, "product-feedback-submit", SalesInput{ID: id, Payload: bad}, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("changed source", e)
	}
	// Audit failure must roll back the immutable intent as well.
	db.Exec("CREATE TRIGGER feedback_freeze_fail BEFORE INSERT ON altoc_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated'")
	if _, e := s.Feedback(ctx, "product-feedback-submit", SalesInput{ID: id, Payload: input}, who, scope); e == nil {
		t.Fatal("audit failure")
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_ticket_product_feedback").Scan(&count)
	if count != 0 {
		t.Fatal("partial freeze")
	}
	db.Exec("DROP TRIGGER feedback_freeze_fail")
	frozen := call("product-feedback-submit", input)
	call("product-feedback-submit", input)
	db.Exec("UPDATE altoc_service_ticket SET description='源已变化' WHERE id=?", id)
	// Late Aims failure must not lose the first frozen source or leave a receipt.
	db.Exec("CREATE TRIGGER feedback_receive_fail BEFORE INSERT ON f16_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated'")
	resume := map[string]any{"productAuthorization": permit()}
	if _, e := s.Feedback(ctx, "product-feedback-resume", SalesInput{ID: id, Payload: resume}, who, scope); e == nil {
		t.Fatal("late failure")
	}
	db.QueryRow("SELECT COUNT(*) FROM product_requests").Scan(&count)
	if count != 0 {
		t.Fatal("partial product request")
	}
	db.Exec("DROP TRIGGER feedback_receive_fail")
	result := call("product-feedback-resume", resume)
	if result["requestBizId"] != frozen["requestBizId"] || result["status"] != "succeeded" {
		t.Fatal(result)
	}
	call("product-feedback-resume", map[string]any{"productAuthorization": permit()})
	db.QueryRow("SELECT COUNT(*) FROM product_requests WHERE problem_statement='首次证据'").Scan(&count)
	if count != 1 {
		t.Fatal("original source/replay", count)
	}
	previousPermit := permit()
	db.Exec("UPDATE product_members SET status='inactive' WHERE uid='person'")
	if _, e := s.Feedback(ctx, "product-feedback-resume", SalesInput{ID: id, Payload: map[string]any{"productAuthorization": previousPermit}}, who, scope); e == nil {
		t.Fatal("revoked receipt replay")
	}
	db.Exec("UPDATE product_members SET status='active' WHERE uid='person'")
	denied := altoc.BasicReadScope{Access: "self"}
	other := who
	other.Actor = "other"
	if _, e := s.Feedback(ctx, "product-feedback-view", SalesInput{ID: id, Payload: map[string]any{}}, other, denied); httperrorStatus(e) != 403 {
		t.Fatal("scope", e)
	}
	var ticketCode string
	db.QueryRow("SELECT code FROM altoc_service_ticket WHERE id=?", id).Scan(&ticketCode)
	projection := func(kind string, revision int, decision string) integrationoperation.ReceiptCommandInput {
		cmd := map[string]any{"ticketCode": ticketCode, "productCode": "P", "requestBizId": frozen["requestBizId"], "canonicalRequestBizId": frozen["requestBizId"], "decisionStatus": decision, "sourceRevision": revision}
		if kind == "progress" {
			cmd["canonicalDecisionStatus"] = decision
			cmd["versions"] = []any{}
		}
		raw, _ := json.Marshal(cmd)
		hash, e := integrationoperation.ValidateAndDigestCommand(cmd)
		if e != nil {
			t.Fatal(e)
		}
		return integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: "aims-test", SourceApp: "aims", ServiceClientID: "aims.runtime"}, SourceDeploymentCode: "aims-test", TargetDeploymentCode: "altoc-test", TargetApp: "altoc", OperationID: uuid.NewString(), OperationCode: "aims.altoc.product-feedback.update-" + kind + ".v1", RequiredCapability: "altoc:product-feedback:update-" + kind, IdempotencyKey: fmt.Sprintf("aims:feedback:%s:%d:%s", kind, revision, decision), CommandSchemaVersion: "product-feedback-" + kind + ".v1", CommandSHA256: hash, Command: raw}
	}
	for _, kind := range []string{"status", "progress"} {
		in := projection(kind, 2, "rejected")
		v, e := s.FeedbackProjection(ctx, kind, in, who)
		if e != nil {
			t.Fatal(kind, e)
		}
		v, e = s.FeedbackProjection(ctx, kind, in, who)
		if e != nil || v.(map[string]any)["idempotent"] != true {
			t.Fatal("projection replay", e, v)
		}
		old := projection(kind, 1, "submitted")
		if _, e = s.FeedbackProjection(ctx, kind, old, who); e != nil {
			t.Fatal(e)
		}
		conflict := projection(kind, 2, "accepted")
		if _, e = s.FeedbackProjection(ctx, kind, conflict, who); httperrorStatus(e) != 409 {
			t.Fatal("same revision", e)
		}
		wrong := in
		wrong.TrustedContext.SourceApp = "enterprise"
		if _, e = s.FeedbackProjection(ctx, kind, wrong, who); httperrorStatus(e) != 403 {
			t.Fatal("owner changed", e)
		}
	}
	read := call("product-feedback-view", map[string]any{})
	if read["decisionStatus"] != "rejected" {
		t.Fatal(read)
	}
	call("product-feedback-submit", map[string]any{"expectedSourceSha256": preview["expectedSourceSha256"], "productAuthorization": permit()})
	db.QueryRow("SELECT COUNT(*) FROM product_requests").Scan(&count)
	if count != 1 {
		t.Fatal("rejected resubmitted", count)
	}
}
