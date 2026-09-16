package productcenter

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestMySQLProductListAuthorizesBeforeFilteringAndPagination(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	for n := 1; n <= 105; n++ {
		workspaceFixture(t, db, fmt.Sprintf("P-%03d", n))
	}
	refresh, err := StartCatalogRefresh(ctx, db, "pm", "catalog", catalogPermit("pm"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", refresh.BizID, catalogPermit("pm"), 1, catalogPage(1, 105, "epoch:1")); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", refresh.BizID, catalogPermit("pm"), 2, catalogPage(2, 105, "epoch:1")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) SELECT product_code,'reader','viewer','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_workspaces WHERE product_code>='P-003'`); err != nil {
		t.Fatal(err)
	}
	permit := ProductListPermit{ActorUID: "reader", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli(), DefaultMask: 6}
	query := ProductListQuery{Page: 2, PageSize: 100, ProductLine: "software"}
	result, err := ListProducts(ctx, db, "reader", permit, query)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 103 || len(result.Items) != 3 || result.Items[0].ProductCode != "P-103" || result.Generation == nil || *result.Generation != refresh.BizID {
		t.Fatalf("unexpected authorized page %#v", result)
	}
	query.Page = 1
	query.Keyword = "Product 1"
	filtered, err := ListProducts(ctx, db, "reader", permit, query)
	if err != nil || filtered.Total != 16 {
		t.Fatalf("filtered=%#v err=%v", filtered, err)
	}
	// One explicit product grant allows a non-member without widening all rows.
	permit.Overrides = []ProductScopeOverride{{ProductCode: "P-001", Mask: 7}}
	query.Keyword = ""
	query.PageSize = 1
	exact, err := ListProducts(ctx, db, "reader", permit, query)
	if err != nil || exact.Total != 104 || len(exact.Items) != 1 || exact.Items[0].ProductCode != "P-001" {
		t.Fatalf("override %#v %v", exact, err)
	}
	if _, err := db.Exec(`UPDATE product_members SET status='inactive' WHERE product_code='P-003'`); err != nil {
		t.Fatal(err)
	}
	after, err := ListProducts(ctx, db, "reader", permit, query)
	if err != nil || after.Total != 103 {
		t.Fatalf("revoked member still visible %#v %v", after, err)
	}
	deny := permit
	deny.DefaultMask = 0
	deny.Overrides = nil
	empty, err := ListProducts(ctx, db, "reader", deny, query)
	if err != nil || empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatalf("denied list %#v %v", empty, err)
	}
}
func TestMySQLProductListRelationshipsAndMissingCatalog(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	for _, code := range []string{"P-A", "P-B", "P-C"} {
		workspaceFixture(t, db, code)
	}
	if _, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,valid_until,created_by,updated_by,created_at,updated_at) VALUES
 ('P-A','u','manager','active',UTC_TIMESTAMP(3),NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
 ('P-B','u','manager','active',UTC_TIMESTAMP(3)+INTERVAL 1 DAY,NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
 ('P-C','u','manager','active',UTC_TIMESTAMP(3)-INTERVAL 2 DAY,UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	p := ProductListPermit{ActorUID: "u", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli(), DefaultMask: 4}
	q := ProductListQuery{Page: 1, PageSize: 20}
	r, err := ListProducts(ctx, db, "u", p, q)
	if err != nil || r.Total != 1 || r.Items[0].ProductCode != "P-A" || r.Items[0].ProductName != nil || r.Generation != nil {
		t.Fatalf("manager %#v %v", r, err)
	}
	if _, err := ListProducts(ctx, db, "other", p, q); err == nil {
		t.Fatal("actor mismatch accepted")
	}
	p.ExpiresAt = 1
	if _, err := ListProducts(ctx, db, "u", p, q); err == nil {
		t.Fatal("expired permit accepted")
	}
}

func TestMySQLProductListIncludesScopedPendingCatalogWithoutDuplicates(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	workspaceFixture(t, db, "P-001")
	workspaceFixture(t, db, "P-002")
	workspaceFixture(t, db, "P-OLD")
	if _, err := db.Exec("UPDATE product_workspaces SET status='archived' WHERE product_code='P-002'"); err != nil {
		t.Fatal(err)
	}
	refresh, err := StartCatalogRefresh(ctx, db, "pm", "unified", catalogPermit("pm"))
	if err != nil {
		t.Fatal(err)
	}
	for page := 1; page <= 2; page++ {
		if _, err := AppendCatalogPage(ctx, db, "pm", refresh.BizID, catalogPermit("pm"), uint64(page), catalogPage(page, 105, "epoch:1")); err != nil {
			t.Fatal(err)
		}
	}
	permit := ProductListPermit{ActorUID: "reader", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli(), DefaultMask: 1}
	query := ProductListQuery{Page: 2, PageSize: 100}
	result, err := ListProducts(ctx, db, "reader", permit, query)
	if err != nil || result.Total != 106 || len(result.Items) != 6 || result.Items[0].ProductCode != "P-101" {
		t.Fatalf("unified page %#v err=%v", result, err)
	}
	query.Page = 1
	query.Status = "not_enabled"
	result, err = ListProducts(ctx, db, "reader", permit, query)
	if err != nil || result.Total != 103 || result.Items[0].ProductCode != "P-003" || result.Items[0].BizID != "" || result.Items[0].Status != "not_enabled" {
		t.Fatalf("pending page %#v err=%v", result, err)
	}
	query.ProductLine = "software"
	query.Keyword = "Product 105"
	result, err = ListProducts(ctx, db, "reader", permit, query)
	if err != nil || result.Total != 1 || result.Items[0].ProductCode != "P-105" {
		t.Fatalf("filtered %#v err=%v", result, err)
	}
	query.Keyword = ""
	query.ProductLine = ""
	for status, total := range map[string]int{"active": 2, "archived": 1} {
		query.Status = status
		result, err = ListProducts(ctx, db, "reader", permit, query)
		if err != nil || result.Total != total {
			t.Fatalf("status %s %#v err=%v", status, result, err)
		}
	}
	query.Status = "not_enabled"
	permit.DefaultMask = 6
	result, err = ListProducts(ctx, db, "reader", permit, query)
	if err != nil || result.Total != 0 {
		t.Fatalf("member scope leaked pending %#v err=%v", result, err)
	}
	permit.Overrides = []ProductScopeOverride{{ProductCode: "P-105", Mask: 1}}
	result, err = ListProducts(ctx, db, "reader", permit, query)
	if err != nil || result.Total != 1 || result.Items[0].ProductCode != "P-105" {
		t.Fatalf("exact pending scope %#v err=%v", result, err)
	}
}
