package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLRequestReadsScopedFilteredAndWithoutWrites(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-READ")
	workspaceFixture(t, db, "P-OTHER")
	ctx := context.Background()
	permit := func(code, action string) AuthorizationPermit {
		p := workspacePermit(t, db, code, "pm", action)
		p.Resource = "product_requests"
		return p
	}
	var ids []string
	for i, title := range []string{"导出100%_数据", "统一登录"} {
		result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-READ", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: title}, permit("P-READ", "create"), RequestDraft{ExpectedRevision: uint64(i + 1), Title: title, ProblemStatement: "客户问题", SourceType: "customer", UrgencyLevel: "P2"})
		if err != nil {
			t.Fatal(err)
		}
		var value struct {
			BizID string `json:"biz_id"`
		}
		if err := json.Unmarshal(result.Value, &value); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, value.BizID)
	}
	p := permit("P-READ", "view")
	page, err := ListProductRequests(ctx, db, "P-READ", "pm", p, RequestPageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].BizID != ids[1] || page.WorkspaceRevision != 3 {
		t.Fatalf("page: %+v %v", page, err)
	}
	page, err = ListProductRequests(ctx, db, "P-READ", "pm", p, RequestPageQuery{Page: 2, PageSize: 1})
	if err != nil || len(page.Items) != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("second page: %+v %v", page, err)
	}
	page, err = ListProductRequests(ctx, db, "P-READ", "pm", p, RequestPageQuery{Page: 1, PageSize: 20, Keyword: "%_", DecisionStatus: "submitted", SourceType: "customer", UrgencyLevel: "P2"})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("literal search: %+v %v", page, err)
	}
	page, err = ListProductRequests(ctx, db, "P-READ", "pm", p, RequestPageQuery{Page: 1, PageSize: 20, DecisionStatus: "accepted"})
	if err != nil || page.Total != 0 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty: %+v %v", page, err)
	}
	detail, err := ReadProductRequest(ctx, db, "P-READ", "pm", ids[0], p)
	if err != nil || detail.DecisionReason != nil || detail.DecidedAt != nil || detail.ProblemStatement == nil || detail.Title != "导出100%_数据" {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	_, err = ReadProductRequest(ctx, db, "P-OTHER", "pm", ids[0], permit("P-OTHER", "view"))
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-product read: %v", err)
	}
	wrong := p
	wrong.Action = "create"
	_, err = ListProductRequests(ctx, db, "P-READ", "pm", wrong, RequestPageQuery{Page: 1, PageSize: 20})
	requireProductRule(t, err, "product_authorization_invalid")
	for _, table := range []string{"product_requests", "product_activity_logs", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 2 {
			t.Fatalf("read mutated %s: %d %v", table, n, err)
		}
	}
}
