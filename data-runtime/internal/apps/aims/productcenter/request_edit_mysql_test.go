package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLRequestEditPreservesDecisionsAndInvalidatesEvidence(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-EDIT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-EDIT", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	draft := RequestDraft{ExpectedRevision: 1, Title: "统一登录", ProblemStatement: "重复登录", SourceType: "internal", UrgencyLevel: "P2"}
	result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-EDIT", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "create"}, permit("create"), draft)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		ID    int64  `json:"id"`
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(result.Value, &created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_requests SET decision_status='accepted',decision_reason='评审采纳',decided_by='reviewer',decided_at=UTC_TIMESTAMP(3) WHERE id=?`, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES (UUID(),'P-EDIT','登录规划','OIDC','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) SELECT 'P-EDIT',id,?,'pm',UTC_TIMESTAMP(3) FROM product_planning_items`, created.ID); err != nil {
		t.Fatal(err)
	}
	draft.ExpectedRevision = 2
	draft.ProblemStatement = "跨应用重复登录"
	input := RequestEdit{RequestDraft: draft, BizID: created.BizID, ExpectedRequestRevision: 1, Reason: "补充使用场景"}
	identity := CommandIdentity{ProductCode: "P-EDIT", ActorUID: "pm", Action: "product_requests:edit", IdempotencyKey: "edit"}
	if _, err := EditProductRequest(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := EditProductRequest(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %v %v", replay, err)
	}
	detail, err := ReadProductRequest(ctx, db, "P-EDIT", "pm", created.BizID, permit("view"))
	if err != nil || detail.Revision != 2 || detail.DecisionStatus != "accepted" || detail.DecisionReason == nil || *detail.DecisionReason != "评审采纳" || detail.DecidedBy == nil || *detail.DecidedBy != "reviewer" || *detail.ProblemStatement != draft.ProblemStatement {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	var evidence, revision int
	if err := db.QueryRow(`SELECT evidence_revision,revision FROM product_planning_items`).Scan(&evidence, &revision); err != nil || evidence != 2 || revision != 2 {
		t.Fatalf("evidence: %d %d %v", evidence, revision, err)
	}
	input.ExpectedRevision = 3
	identity.IdempotencyKey = "stale"
	_, err = EditProductRequest(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_request_revision_conflict")
	input.ExpectedRequestRevision = 2
	identity.IdempotencyKey = "rollback"
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_edit_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	input.Title = "不应保存"
	if _, err := EditProductRequest(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	if err := db.QueryRow(`SELECT evidence_revision,revision FROM product_planning_items`).Scan(&evidence, &revision); err != nil || evidence != 2 || revision != 2 {
		t.Fatalf("rollback evidence: %d %d %v", evidence, revision, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_edit_audit`); err != nil {
		t.Fatal(err)
	}
	detail, err = ReadProductRequest(ctx, db, "P-EDIT", "pm", created.BizID, permit("view"))
	if err != nil || detail.Title == input.Title || detail.Revision != 2 {
		t.Fatalf("rollback: %+v %v", detail, err)
	}
	if _, err := db.Exec(`UPDATE product_requests SET decision_status='merged' WHERE id=?`, created.ID); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "merged"
	_, err = EditProductRequest(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_request_merged_readonly")
}
