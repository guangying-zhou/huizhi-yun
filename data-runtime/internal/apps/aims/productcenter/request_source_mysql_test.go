package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLManualSourceIsUnverifiedAndAtomic(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-SOURCE")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SOURCE", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	created, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-SOURCE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "create"}, permit("create"), RequestDraft{ExpectedRevision: 1, Title: "统一登录", ProblemStatement: "重复登录", SourceType: "customer", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		ID    int64  `json:"id"`
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(created.Value, &request); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES (UUID(),'P-SOURCE','登录规划','OIDC','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) SELECT 'P-SOURCE',id,?,'pm',UTC_TIMESTAMP(3) FROM product_planning_items`, request.ID); err != nil {
		t.Fatal(err)
	}
	date := "2026-09-07"
	input := ManualRequestSource{BizID: request.BizID, ExpectedRevision: 2, ExpectedRequestRevision: 1, Note: "访谈中用户表示现有登录方式可接受", EvidenceDate: &date, Kind: "fact", Direction: "opposing"}
	identity := CommandIdentity{ProductCode: "P-SOURCE", ActorUID: "pm", Action: "product_requests:source-create", IdempotencyKey: "source"}
	if _, err := AddManualRequestSource(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := AddManualRequestSource(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay %v %v", replay, err)
	}
	var status, kind, direction, day string
	var app, biz *string
	if err := db.QueryRow(`SELECT verification_status,evidence_kind,direction,DATE_FORMAT(evidence_date,'%Y-%m-%d'),source_app,source_biz_id FROM product_request_sources`).Scan(&status, &kind, &direction, &day, &app, &biz); err != nil || status != "unverified" || kind != "fact" || direction != "opposing" || day != date || app != nil || biz != nil {
		t.Fatalf("source trust %s %s %s %s %v", status, kind, direction, day, err)
	}
	var revision int
	if err := db.QueryRow(`SELECT evidence_revision FROM product_planning_items`).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("evidence %d %v", revision, err)
	}
	input.ExpectedRevision = 3
	input.ExpectedRequestRevision = 2
	identity.IdempotencyKey = "failure"
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_source_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := AddManualRequestSource(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	for table, want := range map[string]int{"product_request_sources": 1, "product_activity_logs": 2, "product_command_receipts": 2} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != want {
			t.Fatalf("%s %d %v", table, n, err)
		}
	}
	if err := db.QueryRow(`SELECT evidence_revision FROM product_planning_items`).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("rollback evidence %d %v", revision, err)
	}
	page, err := ListRequestSources(ctx, db, "P-SOURCE", "pm", permit("view"), RequestSourcePageQuery{BizID: request.BizID, Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].Note != input.Note || page.Items[0].VerificationStatus != "unverified" || page.RequestRevision != 2 || page.WorkspaceRevision != 3 {
		t.Fatalf("source page %+v %v", page, err)
	}
	page, err = ListRequestSources(ctx, db, "P-SOURCE", "pm", permit("view"), RequestSourcePageQuery{BizID: request.BizID, Page: 2, PageSize: 1})
	if err != nil || page.Total != 1 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty page %+v %v", page, err)
	}
	workspaceFixture(t, db, "P-OTHER-SOURCE")
	other := workspacePermit(t, db, "P-OTHER-SOURCE", "pm", "view")
	other.Resource = "product_requests"
	_, err = ListRequestSources(ctx, db, "P-OTHER-SOURCE", "pm", other, RequestSourcePageQuery{BizID: request.BizID, Page: 1, PageSize: 20})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-product source read: %v", err)
	}
	_, err = ListRequestSources(ctx, db, "P-SOURCE", "pm", permit("edit"), RequestSourcePageQuery{BizID: request.BizID, Page: 1, PageSize: 20})
	requireProductRule(t, err, "product_authorization_invalid")

}
