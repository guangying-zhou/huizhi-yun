package productcenter

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestMySQLFeedbackStatusOutbox(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-STATUS")
	for _, statement := range []string{
		`INSERT INTO product_requests(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001','P-STATUS','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_requests`,
		`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-1','P-STATUS',request_id,id,'pm',UTC_TIMESTAMP(3) FROM product_request_sources`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	var requestID int64
	if err := db.QueryRow(`SELECT id FROM product_requests LIMIT 1`).Scan(&requestID); err != nil {
		t.Fatal(err)
	}
	trusted := integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "TENANT", DeploymentCode: "AIMS"}
	for _, commit := range []bool{false, true} {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		err = enqueueFeedbackDecisionTx(context.Background(), tx, trusted, "pm", "P-STATUS", requestID, "00000000-0000-4000-8000-000000000001", "accepted", 3)
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit()
		} else {
			err = tx.Rollback()
		}
		if err != nil {
			t.Fatal(err)
		}
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		expected := 0
		if commit {
			expected = 1
		}
		if n != expected {
			t.Fatal("outbox escaped parent transaction")
		}
	}
	var status, schema, actor string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.decisionStatus')),command_schema_version,original_actor_uid FROM integration_operation`).Scan(&status, &schema, &actor); err != nil {
		t.Fatal(err)
	}
	if status != "accepted" || schema != "product-feedback-status.v1" || actor != "pm" {
		t.Fatal("incorrect frozen status command")
	}
	permit := workspacePermit(t, db, "P-STATUS", "pm", "decide")
	permit.Resource = "product_requests"
	identity := CommandIdentity{ProductCode: "P-STATUS", ActorUID: "pm", Action: "product_requests:decide", IdempotencyKey: "decision-with-feedback"}
	input := RequestDecision{BizID: "00000000-0000-4000-8000-000000000001", ExpectedRevision: 1, ExpectedRequestRevision: 1, Status: "evaluating"}
	if _, err := DecideProductRequest(context.Background(), db, identity, permit, input); err == nil {
		t.Fatal("formal feedback decision accepted without trusted runtime identity")
	}
	var unchanged string
	if err := db.QueryRow(`SELECT decision_status FROM product_requests`).Scan(&unchanged); err != nil || unchanged != "submitted" {
		t.Fatal("outbox failure did not roll back decision")
	}

	if _, err := db.Exec(`CREATE TRIGGER fail_progress_freeze BEFORE INSERT ON integration_operation FOR EACH ROW BEGIN IF NEW.operation_code='aims.altoc.product-feedback.update-progress.v1' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected progress freeze failure'; END IF; END`); err != nil {
		t.Fatal(err)
	}
	if _, err := DecideProductRequest(context.Background(), db, identity, permit, input, trusted); err == nil {
		t.Fatal("progress freeze failure ignored")
	}
	if err := db.QueryRow(`SELECT decision_status FROM product_requests`).Scan(&unchanged); err != nil || unchanged != "submitted" {
		t.Fatal("progress failure did not roll back decision")
	}
	var afterFailure int
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation`).Scan(&afterFailure); err != nil || afterFailure != 1 {
		t.Fatal("progress failure left partial status outbox")
	}
	if _, err := db.Exec(`DROP TRIGGER fail_progress_freeze`); err != nil {
		t.Fatal(err)
	}
	if _, err := DecideProductRequest(context.Background(), db, identity, permit, input, trusted); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-status.v1' AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.decisionStatus'))='evaluating'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("decision did not freeze feedback event")
	}

	// Remove the earlier standalone helper fixture, then exercise real merge chains.
	if _, err := db.Exec(`DELETE FROM integration_operation WHERE JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.decisionStatus'))='accepted'`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"} {
		if _, err := db.Exec(`INSERT INTO product_requests(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(?,'P-STATUS','Target','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id); err != nil {
			t.Fatal(err)
		}
	}
	identity.Action = "product_requests:merge"
	identity.IdempotencyKey = "merge-first"
	merge := RequestMerge{BizID: input.BizID, TargetBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 2, ExpectedRequestRevision: 2, ExpectedTargetRevision: 1, Reason: "duplicate"}
	permit = workspacePermit(t, db, "P-STATUS", "pm", "decide")
	permit.Resource = "product_requests"
	if _, err := MergeProductRequest(context.Background(), db, identity, permit, merge, trusted); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "merge-second"
	merge.BizID = merge.TargetBizID
	merge.TargetBizID = "00000000-0000-4000-8000-000000000003"
	merge.ExpectedRevision = 3
	merge.ExpectedRequestRevision = 2
	permit = workspacePermit(t, db, "P-STATUS", "pm", "decide")
	permit.Resource = "product_requests"
	if _, err := MergeProductRequest(context.Background(), db, identity, permit, merge, trusted); err != nil {
		t.Fatal(err)
	}
	var canonical, original string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalRequestBizId')),JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.requestBizId')) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-status.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=4`).Scan(&canonical, &original); err != nil {
		t.Fatal(err)
	}
	if canonical != merge.TargetBizID || original != input.BizID {
		t.Fatal("merge chain lost original feedback or final canonical request")
	}

	var progressCanonical, progressDecision, progressOriginal string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalRequestBizId')),JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalDecisionStatus')),JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.requestBizId')) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=4`).Scan(&progressCanonical, &progressDecision, &progressOriginal); err != nil {
		t.Fatal(err)
	}
	if progressCanonical != merge.TargetBizID || progressOriginal != input.BizID || progressDecision != "submitted" {
		t.Fatal("merge failed to freeze canonical progress")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1'`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("expected decision plus two merge progress events: %d %v", count, err)
	}

	identity.Action = "product_requests:decide"
	identity.IdempotencyKey = "canonical-evaluation"
	permit = workspacePermit(t, db, "P-STATUS", "pm", "decide")
	permit.Resource = "product_requests"
	next := RequestDecision{BizID: merge.TargetBizID, ExpectedRevision: 4, ExpectedRequestRevision: 2, Status: "evaluating"}
	if _, err := DecideProductRequest(context.Background(), db, identity, permit, next, trusted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalDecisionStatus')),JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.decisionStatus')) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=5`).Scan(&progressDecision, &status); err != nil {
		t.Fatal(err)
	}
	if progressDecision != "evaluating" || status != "merged" {
		t.Fatal("canonical evaluation did not reach original merged feedback")
	}

}
