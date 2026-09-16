package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLManualSourceDeleteAuditReplayAndRollback(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DEL-SRC")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-DEL-SRC", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-DEL-SRC", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "create"}, permit("create"), RequestDraft{ExpectedRevision: 1, Title: "登录", ProblemStatement: "重复登录", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(result.Value, &request); err != nil {
		t.Fatal(err)
	}
	result, err = AddManualRequestSource(ctx, db, CommandIdentity{ProductCode: "P-DEL-SRC", ActorUID: "pm", Action: "product_requests:source-create", IdempotencyKey: "add"}, permit("edit"), ManualRequestSource{BizID: request.BizID, ExpectedRevision: 2, ExpectedRequestRevision: 1, Note: "待纠正原话", Kind: "assumption", Direction: "neutral"})
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		Source struct {
			ID int64 `json:"id"`
		} `json:"source"`
	}
	if err := json.Unmarshal(result.Value, &source); err != nil {
		t.Fatal(err)
	}
	input := RequestSourceDelete{BizID: request.BizID, SourceID: source.Source.ID, ExpectedRevision: 3, ExpectedRequestRevision: 2, ExpectedSourceRevision: 1, Reason: "访谈归属错误"}
	identity := CommandIdentity{ProductCode: "P-DEL-SRC", ActorUID: "pm", Action: "product_requests:source-delete", IdempotencyKey: "delete"}
	_, err = DeleteManualRequestSource(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_source_delete BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := DeleteManualRequestSource(ctx, db, identity, permit("delete"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count, revision int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_request_sources`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-DEL-SRC'`).Scan(&revision); err != nil || revision != 3 {
		t.Fatalf("root rollback %d %v", revision, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_source_delete`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_request_sources SET verification_status='verified'`); err != nil {
		t.Fatal(err)
	}
	_, err = DeleteManualRequestSource(ctx, db, identity, permit("delete"), input)
	requireProductRule(t, err, "product_source_external_contract_required")
	if _, err := db.Exec(`UPDATE product_request_sources SET verification_status='unverified'`); err != nil {
		t.Fatal(err)
	}
	if _, err := DeleteManualRequestSource(ctx, db, identity, permit("delete"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := DeleteManualRequestSource(ctx, db, identity, permit("delete"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay %v %v", replay, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_request_sources`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("not deleted %d %v", count, err)
	}
	var note, reason string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.before.source_note')),JSON_UNQUOTE(JSON_EXTRACT(changes,'$.reason')) FROM product_activity_logs WHERE action='delete'`).Scan(&note, &reason); err != nil || note != "待纠正原话" || reason != input.Reason {
		t.Fatalf("audit %s %s %v", note, reason, err)
	}
}
