package enterpriseplanning

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

type catalogTestAuthorization func(context.Context, *sql.Tx, e.DirectoryIdentity) (e.DirectoryGrant, error)

func (f catalogTestAuthorization) AssetsProductsView(ctx context.Context, tx *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
	return f(ctx, tx, id)
}
func TestMySQLCurrentCatalogScopeNamesAndSnapshot(t *testing.T) {
	db, _, binding := planningMySQLFixture(t)
	ctx := context.Background()
	schema, err := os.ReadFile("../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"product_assets", "asset_category_groups"} {
		pattern := "(?ms)^CREATE TABLE IF NOT EXISTS `" + name + "` \\(.*?^\\) ENGINE=.*?;"
		ddl := regexp.MustCompile(pattern).FindString(string(schema))
		if ddl == "" {
			t.Fatal("missing assets schema", name)
		}
		exec(strings.Replace(ddl, "`"+name+"`", "`assets_"+name+"`", 1))
	}
	binding.Domains["assets"] = e.DomainBinding{OwnerDeployment: "assets", Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups"}, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	service, err := NewCatalogService(ctx, registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"L1", "L2", "SECRET"} {
		exec("INSERT INTO assets_asset_category_groups(category_scope,category_value,category_label,sort_order) VALUES('product',?,?,1)", line, "Current "+line)
	}
	for _, item := range [][2]string{{"A", "L2"}, {"B", "L1"}, {"C", "L1"}, {"D", "L2"}, {"H", "L1"}, {"H2", "SECRET"}, {"E", "SECRET"}} {
		exec("INSERT INTO assets_product_assets(product_code,product_name,product_line,customer_domain,business_domain) VALUES(?,?,?,'test','test')", item[0], "Current "+item[0], item[1])
	}
	for _, code := range []string{"A", "M", "N", "W"} {
		exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", code, uuid.NewString())
	}
	exec("INSERT INTO product_line_workspaces(line_code,product_code,line_label,source_watermark) VALUES('L1','M','Historical line secret','old'),('SECRET','N','Hidden management label','old')")
	for _, pair := range [][2]string{{"B", "M"}, {"H", "M"}, {"H2", "N"}} {
		result, err := db.Exec("INSERT INTO product_components(biz_id,product_code,parent_id,name,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,NULL,'component',0,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString(), pair[1])
		if err != nil {
			t.Fatal(err)
		}
		component, _ := result.LastInsertId()
		exec("INSERT INTO product_component_sources(source_product_code,product_code,component_id,source_product_name) VALUES(?,?,?,'Historical source secret')", pair[0], pair[1], component)
	}
	exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('M','reader','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	permit := func() pc.ProductListPermit {
		return pc.ProductListPermit{ActorUID: "reader", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli(), DefaultMask: 7, CanOnboard: true}
	}
	grant := func(all bool, codes ...string) catalogTestAuthorization {
		return func(_ context.Context, _ *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
			return e.DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: time.Now().Add(15 * time.Second), AllProducts: all, ProductCodes: codes}, nil
		}
	}
	visible := grant(false, "A", "B", "C", "D")
	list := func(p pc.ProductListPermit, q pc.ProductListQuery, a AssetsCatalogAuthorizer) pc.ProductListPage {
		t.Helper()
		out, err := service.List(ctx, "reader", p, q, a)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	child := "L1"
	q := pc.ProductListQuery{Page: 1, PageSize: 1, Tree: true, ChildLine: &child}
	page := list(permit(), q, visible)
	if page.Total != 2 || len(page.Items) != 1 || page.Items[0].ProductCode != "B" {
		t.Fatalf("wrong authorized child page %+v", page)
	}
	if page.Items[0].ProductName == nil || *page.Items[0].ProductName != "Current B" || page.Items[0].ManagementProductCode == nil || *page.Items[0].ManagementProductCode != "M" {
		t.Fatal("visible binding/current name missing", page)
	}
	q.Page = 2
	page = list(permit(), q, visible)
	if page.Total != 2 || len(page.Items) != 1 || page.Items[0].ProductCode != "C" {
		t.Fatal("page count diverged", page)
	}
	groups := list(permit(), pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true}, visible)
	for _, group := range groups.Groups {
		if group.LineCode == "SECRET" || strings.Contains(group.Label, "Historical") || group.CanUnify {
			t.Fatal("hidden or partially scoped line hint leaked", group)
		}
		if group.LineCode == "L1" && (group.Total != 2 || group.Label != "Current L1") {
			t.Fatal("hidden child inflated count", group)
		}
	}
	for _, keyword := range []string{"Historical source secret", "Historical line secret", "Current H", "Hidden management label"} {
		out := list(permit(), pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true, Keyword: keyword}, visible)
		if out.Total != 0 {
			t.Fatal("hidden/history keyword leaked", keyword, out)
		}
	}
	global := list(permit(), pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true, ProductLine: "L2", Keyword: "A"}, grant(true))
	if len(global.Groups) != 1 || !global.Groups[0].CanUnify {
		t.Fatal("partial onboarding must assess complete unfiltered line", global)
	}
	scoped := list(permit(), pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true, ProductLine: "L2"}, grant(false, "A"))
	if len(scoped.Groups) != 1 || scoped.Groups[0].CanUnify {
		t.Fatal("partial Assets scope inferred whole-line eligibility", scoped)
	}
	deniedAssets := list(permit(), pc.ProductListQuery{Page: 1, PageSize: 20}, grant(false))
	for _, item := range deniedAssets.Items {
		if item.ProductName != nil || item.ProductLine != nil || item.ProductLineLabel != nil || item.ManagementProductCode != nil {
			t.Fatal("Aims-only workspace leaked Assets association", item)
		}
	}
	manager := permit()
	manager.DefaultMask = 4
	managed := list(manager, pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true}, visible)
	if len(managed.Groups) != 1 || managed.Groups[0].Total != 1 {
		t.Fatal("live membership scope lost", managed)
	}
	exec("UPDATE product_members SET status='inactive' WHERE product_code='M'")
	if revoked := list(manager, pc.ProductListQuery{Page: 1, PageSize: 20, Tree: true}, visible); revoked.Total != 0 {
		t.Fatal("revoked manager retained list scope", revoked)
	}
	exec("UPDATE assets_product_assets SET product_name='Renamed B' WHERE product_code='B'")
	exec("UPDATE assets_asset_category_groups SET category_label='Renamed line' WHERE category_value='L1'")
	q.Page = 1
	renamed := list(permit(), q, visible)
	if *renamed.Items[0].ProductName != "Renamed B" || *renamed.Items[0].ProductLineLabel != "Renamed line" {
		t.Fatal("current rename not reflected", renamed)
	}
	var historical string
	if err = db.QueryRow("SELECT source_product_name FROM product_component_sources WHERE source_product_code='B'").Scan(&historical); err != nil || historical != "Historical source secret" {
		t.Fatal("history overwritten", err)
	}
	// The authorizer's first non-locking scope read establishes RR snapshot.
	// A separate physical connection commits a rename and insert before count/page.
	concurrent := catalogTestAuthorization(func(ctx context.Context, tx *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
		var before int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM assets_product_assets").Scan(&before); err != nil {
			return e.DirectoryGrant{}, err
		}
		exec("UPDATE assets_product_assets SET product_name='After snapshot' WHERE product_code='B'")
		exec("INSERT INTO assets_product_assets(product_code,product_name,product_line,customer_domain,business_domain) VALUES('B2','New after snapshot','L1','test','test')")
		return grant(true)(ctx, tx, id)
	})
	q.PageSize = 20
	snapshot := list(permit(), q, concurrent)
	if snapshot.Total != 3 || len(snapshot.Items) != 3 || *snapshot.Items[0].ProductName != "Renamed B" {
		t.Fatal("scope/count/page mixed snapshots", snapshot)
	}
	latest := list(permit(), q, grant(true))
	if latest.Total != 4 || *latest.Items[0].ProductName != "After snapshot" {
		t.Fatal("next snapshot missing committed change", latest)
	}
	wrong := catalogTestAuthorization(func(ctx context.Context, tx *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
		g, _ := grant(true)(ctx, tx, id)
		g.Key.Tenant = "other"
		return g, nil
	})
	if _, err = service.List(ctx, "reader", permit(), q, wrong); err == nil {
		t.Fatal("wrong tenant grant accepted")
	}
	encoded, _ := json.Marshal(deniedAssets)
	if strings.Contains(string(encoded), "Historical") {
		t.Fatal("historical label leak")
	}

	t.Run("workspace-current-identity", func(t *testing.T) {
		permitFor := func(code string) pc.AuthorizationPermit {
			facts, err := pc.LoadAuthorizationFacts(ctx, db, code, "reader")
			if err != nil {
				t.Fatal(err)
			}
			return pc.AuthorizationPermit{Resource: "products", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		}
		read := func(code string, auth AssetsCatalogAuthorizer) pc.WorkspaceDetail {
			t.Helper()
			out, err := service.ReadWorkspace(ctx, code, "reader", permitFor(code), auth)
			if err != nil {
				t.Fatal(err)
			}
			return out
		}
		direct := read("A", grant(false, "A"))
		if direct.ManagementKind != "product" || direct.ProductName == nil || *direct.ProductName != "Current A" || *direct.ProductLineLabel != "Current L2" {
			t.Fatal("workspace current identity missing", direct)
		}
		exec("UPDATE assets_product_assets SET product_name='Workspace renamed' WHERE product_code='A'")
		if direct = read("A", grant(false, "A")); *direct.ProductName != "Workspace renamed" {
			t.Fatal("workspace rename stale", direct)
		}
		managed := read("M", grant(false, "B"))
		if managed.ManagementKind != "product_line" || managed.ProductName == nil || *managed.ProductName != "Renamed line" {
			t.Fatal("line workspace current identity missing", managed)
		}
		for _, auth := range []AssetsCatalogAuthorizer{grant(false), grant(false, "C")} {
			detail := read("M", auth)
			if detail.ManagementKind != "product_line" || detail.ProductName != nil || detail.ProductLine != nil || detail.ProductLineLabel != nil {
				t.Fatal("unbound/hidden Assets leaked line snapshot", detail)
			}
		}
		exec("UPDATE product_workspaces SET positioning='Aims positioning' WHERE product_code='W'")
		own := read("W", grant(false))
		if own.Positioning == nil || *own.Positioning != "Aims positioning" || own.ProductName != nil {
			t.Fatal("Aims-only workspace fields lost", own)
		}
		stale := permitFor("M")
		exec("UPDATE product_members SET status='active' WHERE product_code='M'")
		if _, err = service.ReadWorkspace(ctx, "M", "reader", stale, grant(true)); err == nil {
			t.Fatal("changed Aims membership accepted stale workspace permit")
		}
		if _, err = service.ReadWorkspace(ctx, "A", "reader", permitFor("A"), wrong); err == nil {
			t.Fatal("wrong Assets tenant workspace grant accepted")
		}
	})
	t.Log("current Assets names, independent scopes, hidden sources/counts, whole-line hints, live membership and concurrent snapshot verified")
}
