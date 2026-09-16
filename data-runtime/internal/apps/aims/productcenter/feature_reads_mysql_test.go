package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLFeatureReadsScopedFilteredAndWithoutWrites(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-READ")
	workspaceFixture(t, db, "P-OTHER")
	ctx := context.Background()
	permit := func(code, action string) AuthorizationPermit {
		p := workspacePermit(t, db, code, "pm", action)
		p.Resource = "product_features"
		return p
	}
	var ids []string
	for i, title := range []string{"导出100%_数据", "统一登录"} {
		result, err := CreateProductFeature(ctx, db, CommandIdentity{ProductCode: "P-READ", ActorUID: "pm", Action: "product_features:create", IdempotencyKey: title}, permit("P-READ", "edit"), FeatureDraft{ExpectedRevision: uint64(i + 1), Title: title, Description: "客户问题"})
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
	page, err := ListProductFeatures(ctx, db, "P-READ", "pm", p, FeaturePageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].BizID != ids[1] || page.WorkspaceRevision != 3 {
		t.Fatalf("page: %+v %v", page, err)
	}
	page, err = ListProductFeatures(ctx, db, "P-READ", "pm", p, FeaturePageQuery{Page: 2, PageSize: 1})
	if err != nil || len(page.Items) != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("second page: %+v %v", page, err)
	}
	page, err = ListProductFeatures(ctx, db, "P-READ", "pm", p, FeaturePageQuery{Page: 1, PageSize: 20, Keyword: "%_", Lifecycle: "candidate"})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("literal search: %+v %v", page, err)
	}
	page, err = ListProductFeatures(ctx, db, "P-READ", "pm", p, FeaturePageQuery{Page: 1, PageSize: 20, Lifecycle: "active"})
	if err != nil || page.Total != 0 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty: %+v %v", page, err)
	}
	detail, err := ReadProductFeature(ctx, db, "P-READ", "pm", ids[0], p)
	if err != nil || detail.LifecycleEvidence != nil || detail.Lifecycle != "candidate" || detail.Description == nil || detail.Title != "导出100%_数据" {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	_, err = ReadProductFeature(ctx, db, "P-OTHER", "pm", ids[0], permit("P-OTHER", "view"))
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-product read: %v", err)
	}
	wrong := p
	wrong.Action = "create"
	_, err = ListProductFeatures(ctx, db, "P-READ", "pm", wrong, FeaturePageQuery{Page: 1, PageSize: 20})
	requireProductRule(t, err, "product_authorization_invalid")
	for _, table := range []string{"product_features", "product_activity_logs", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 2 {
			t.Fatalf("read mutated %s: %d %v", table, n, err)
		}
	}
}
