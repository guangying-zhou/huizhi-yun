package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func onboardingFixture(t *testing.T) (*sql.DB, *OnboardingService, e.Binding) {
	t.Helper()
	db, _, b := planningMySQLFixture(t)
	schema, err := os.ReadFile("../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"product_assets", "asset_category_groups"} {
		ddl := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `" + name + "` \\(.*?^\\) ENGINE=.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal(name)
		}
		if _, err = db.Exec(strings.Replace(ddl, "`"+name+"`", "`assets_"+name+"`", 1)); err != nil {
			t.Fatal(err)
		}
	}
	b.Domains["assets"] = e.DomainBinding{OwnerDeployment: "assets", Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups"}, Read: e.PathUnified, Write: e.PathDisabled, Scheduler: e.PathDisabled}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	service, err := NewOnboardingService(context.Background(), registry, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO product_catalog_control(id) VALUES(1)"); err != nil {
		t.Fatal(err)
	}
	return db, service, b
}
func TestMySQLCurrentAssetsOnboardingAtomicAndScoped(t *testing.T) {
	db, s, _ := onboardingFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO assets_asset_category_groups(category_scope,category_value,category_label) VALUES('product','L','Current line')")
	for _, code := range []string{"A", "B", "C"} {
		exec("INSERT INTO assets_product_assets(product_code,product_name,product_line,customer_domain,business_domain,status) VALUES(?,?,'L','test','test','mvp')", code, "Current "+code)
	}
	exec("UPDATE assets_product_assets SET status='retired' WHERE product_code='C'")
	// Contradictory projection is deliberately present; unified intake never uses it.
	exec("INSERT INTO product_catalog_refreshes(id,biz_id,created_by,created_at) VALUES(1,UUID(),'admin',UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_catalog_projection(generation,product_code,product_name,product_line,source_status,source_updated_at,synced_at) VALUES(1,'A','Historical hidden','OLD','retired',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	grant := func(all bool, codes ...string) catalogTestAuthorization {
		return func(_ context.Context, _ *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
			return e.DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: time.Now().Add(15 * time.Second), AllProducts: all, ProductCodes: codes}, nil
		}
	}
	permit := func(code string) pc.OnboardPermit {
		return pc.OnboardPermit{ProductCode: code, ActorUID: "admin", Resource: "products", Action: "onboard", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	directory := func() pc.MemberDirectoryEvidence {
		return pc.MemberDirectoryEvidence{ActiveUIDs: []string{"manager"}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	single, err := s.ProductCandidate(ctx, "admin", permit("A"), "A", grant(false, "A"))
	if err != nil || single.Item.ProductName != "Current A" || !single.Item.Onboardable {
		t.Fatal(single, err)
	}
	if _, err = s.ProductCandidate(ctx, "admin", permit("B"), "B", grant(false, "A")); err == nil {
		t.Fatal("hidden asset exposed")
	}

	page, err := s.ProductsCandidates(ctx, "admin", permit("*"), ProductCandidatesQuery{PageSize: 1}, grant(false, "A", "B"))
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ProductCode != "A" || page.NextPage == nil {
		t.Fatal("candidate page", page, err)
	}
	exec("UPDATE assets_product_assets SET product_name='hidden change' WHERE product_code='C'")
	page2, err := s.ProductsCandidates(ctx, "admin", permit("*"), ProductCandidatesQuery{Page: 2, PageSize: 1, Watermark: page.Watermark}, grant(false, "A", "B"))
	if err != nil || page2.Total != 2 || len(page2.Items) != 1 || page2.Items[0].ProductCode != "B" || page2.Watermark != page.Watermark {
		t.Fatal("hidden change affected visible pagination", page2, err)
	}
	if _, err = s.ProductsCandidates(ctx, "admin", permit("*"), ProductCandidatesQuery{Page: 2}, grant(true)); err == nil {
		t.Fatal("page without watermark")
	}
	empty, err := s.ProductsCandidates(ctx, "admin", permit("*"), ProductCandidatesQuery{}, grant(false))
	if err != nil || empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatal("empty scope", empty, err)
	}
	lineCode := pc.LineWorkspaceCode("L")
	if _, err = s.LineCandidates(ctx, "admin", permit(lineCode), "L", grant(false, "A")); err == nil {
		t.Fatal("partial scope enumerated full line")
	}
	candidates, err := s.LineCandidates(ctx, "admin", permit(lineCode), "L", grant(true))
	if err != nil || candidates.Total != 3 || candidates.Label != "Current line" {
		t.Fatal(candidates, err)
	}
	input := pc.LineOnboardInput{LineCode: "L", ExpectedWatermark: candidates.Watermark, ManagerUID: "manager", ProductCodes: []string{"A"}}
	id := pc.CommandIdentity{ProductCode: lineCode, ActorUID: "admin", Action: "products:onboard-line", IdempotencyKey: "line"}
	exec("UPDATE assets_product_assets SET product_name='Renamed A' WHERE product_code='A'")
	if _, err = s.ProductsCandidates(ctx, "admin", permit("*"), ProductCandidatesQuery{Page: 2, PageSize: 1, Watermark: page.Watermark}, grant(false, "A", "B")); err == nil {
		t.Fatal("visible rename accepted stale page")
	}

	if _, err = s.OnboardLine(ctx, id, permit(lineCode), directory(), input, grant(true)); err == nil {
		t.Fatal("stale current watermark accepted")
	}
	candidates, err = s.LineCandidates(ctx, "admin", permit(lineCode), "L", grant(true))
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedWatermark = candidates.Watermark
	exec("CREATE TRIGGER onboard_late_failure BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late failure'")
	if _, err = s.OnboardLine(ctx, id, permit(lineCode), directory(), input, grant(true)); err == nil {
		t.Fatal("late error accepted")
	}
	if _, err = s.Onboard(ctx, pc.CommandIdentity{ProductCode: "B", ActorUID: "admin", Action: "products:onboard", IdempotencyKey: "single-B"}, permit("B"), directory(), pc.OnboardInput{ManagerUID: "manager", Reason: "intake"}, grant(false, "B")); err == nil {
		t.Fatal("individual late error accepted")
	}
	var n int
	for _, table := range []string{"product_workspaces", "product_members", "product_components", "product_component_sources", "product_line_workspaces", "product_command_receipts"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatal("rollback", table, n, err)
		}
	}
	exec("DROP TRIGGER onboard_late_failure")
	if _, err = s.OnboardLine(ctx, id, permit(lineCode), directory(), input, grant(true)); err != nil {
		t.Fatal(err)
	}
	var name string
	if err = db.QueryRow("SELECT source_product_name FROM product_component_sources WHERE source_product_code='A'").Scan(&name); err != nil || name != "Renamed A" {
		t.Fatal(name, err)
	}
	source := pc.LineSourceEvidence{LineCode: "L", Watermark: candidates.Watermark, Total: candidates.Total, Items: candidates.Items, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	replay, err := pc.OnboardProductLine(ctx, db, id, permit(lineCode), source, directory(), input)
	if err != nil || !replay.Replayed {
		t.Fatal("old line replay", err)
	}
	individual := func(code string) (pc.CommandResult, error) {
		return s.Onboard(ctx, pc.CommandIdentity{ProductCode: code, ActorUID: "admin", Action: "products:onboard", IdempotencyKey: "single-" + code}, permit(code), directory(), pc.OnboardInput{ManagerUID: "manager", Reason: "intake"}, grant(false, code))
	}
	if _, err = individual("A"); err == nil {
		t.Fatal("line-owned source independently adopted")
	}
	if _, err = individual("C"); err == nil {
		t.Fatal("retired source adopted")
	}
	if _, err = individual("B"); err != nil {
		t.Fatal("unselected source denied", err)
	}

	singleB, err := s.ProductCandidate(ctx, "admin", permit("B"), "B", grant(false, "B"))
	if err != nil {
		t.Fatal(err)
	}
	oldSingle, err := pc.OnboardWorkspace(ctx, db, pc.CommandIdentity{ProductCode: "B", ActorUID: "admin", Action: "products:onboard", IdempotencyKey: "single-B"}, permit("B"), pc.OnboardSourceEvidence{ProductCode: "B", ProductLine: "L", Watermark: singleB.Watermark, Onboardable: true, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}, directory(), pc.OnboardInput{ManagerUID: "manager", Reason: "intake"})
	if err != nil || !oldSingle.Replayed {
		t.Fatal("old individual replay", err)
	}
	exec("INSERT INTO assets_product_assets(product_code,product_name,product_line,customer_domain,business_domain,status) VALUES('D','Race','R','test','test','mvp')")
	raceLine := pc.LineWorkspaceCode("R")
	raceCandidates, err := s.LineCandidates(ctx, "admin", permit(raceLine), "R", grant(true))
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() { <-start; _, err := individual("D"); results <- err }()
	go func() {
		<-start
		_, err := s.OnboardLine(ctx, pc.CommandIdentity{ProductCode: raceLine, ActorUID: "admin", Action: "products:onboard-line", IdempotencyKey: "race-line"}, permit(raceLine), directory(), pc.LineOnboardInput{LineCode: "R", ExpectedWatermark: raceCandidates.Watermark, ManagerUID: "manager", ProductCodes: []string{"D"}}, grant(true))
		results <- err
	}()
	close(start)
	wins := 0
	for range 2 {
		if <-results == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("concurrent owners", wins)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_workspaces WHERE product_code IN (?,?)", "D", raceLine).Scan(&n); err != nil || n != 1 {
		t.Fatal("duplicate ownership", n, err)
	}
	wrong := catalogTestAuthorization(func(_ context.Context, _ *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
		id.Key.Tenant = "other"
		return e.DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: time.Now().Add(15 * time.Second), AllProducts: true}, nil
	})
	if _, err = s.ProductCandidate(ctx, "admin", permit("B"), "B", wrong); err == nil {
		t.Fatal("wrong tenant")
	}
}
