package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLRequestDecisionHistoryAndReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DECIDE")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-DECIDE", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	create, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-DECIDE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "create"}, permit("create"), RequestDraft{ExpectedRevision: 1, Title: "统一登录", ProblemStatement: "用户重复登录", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(create.Value, &record); err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-DECIDE", ActorUID: "pm", Action: "product_requests:decide", IdempotencyKey: "evaluate"}
	input := RequestDecision{BizID: record.BizID, ExpectedRevision: 2, ExpectedRequestRevision: 1, Status: "evaluating"}
	if _, err := DecideProductRequest(ctx, db, identity, permit("decide"), input); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "accept"
	input.ExpectedRevision = 3
	input.ExpectedRequestRevision = 2
	input.Status = "accepted"
	input.Reason = "问题明确，采纳"
	if _, err := DecideProductRequest(ctx, db, identity, permit("decide"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := DecideProductRequest(ctx, db, identity, permit("decide"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay %v %v", replay, err)
	}
	detail, err := ReadProductRequest(ctx, db, "P-DECIDE", "pm", record.BizID, permit("view"))
	if err != nil || detail.DecisionStatus != "accepted" || detail.Revision != 3 || detail.DecidedBy == nil || *detail.DecidedBy != "pm" || detail.DecidedAt == nil {
		t.Fatalf("decision %+v %v", detail, err)
	}
	input.ExpectedRevision = 4
	input.ExpectedRequestRevision = 3
	input.Status = "rejected"
	input.Reason = "发现替代方案"
	identity.IdempotencyKey = "reject"
	_, err = DecideProductRequest(ctx, db, identity, permit("decide"), input)
	requireProductRule(t, err, "product_request_impact_required")
	input.ImpactNote = "已规划范围保留，需单独复评"
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_decision_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := DecideProductRequest(ctx, db, identity, permit("decide"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	detail, err = ReadProductRequest(ctx, db, "P-DECIDE", "pm", record.BizID, permit("view"))
	if err != nil || detail.DecisionStatus != "accepted" || detail.Revision != 3 {
		t.Fatalf("rollback %+v %v", detail, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_decision_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err := DecideProductRequest(ctx, db, identity, permit("decide"), input); err != nil {
		t.Fatal(err)
	}
	var impact string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.impact_note')) FROM product_activity_logs WHERE action='decide' ORDER BY id DESC LIMIT 1`).Scan(&impact); err != nil || impact != input.ImpactNote {
		t.Fatalf("impact %s %v", impact, err)
	}
	for _, table := range []string{"product_activity_logs", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 4 {
			t.Fatalf("%s %d %v", table, n, err)
		}
	}
}
