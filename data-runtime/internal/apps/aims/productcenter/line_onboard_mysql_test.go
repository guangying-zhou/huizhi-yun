package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"
)

func lineFixture(t *testing.T, db *sql.DB, n int) (CommandIdentity, OnboardPermit, LineSourceEvidence, MemberDirectoryEvidence, LineOnboardInput) {
	t.Helper()
	ctx := context.Background()
	r, err := StartCatalogRefresh(ctx, db, "admin", "catalog", catalogPermit("admin"))
	if err != nil {
		t.Fatal(err)
	}
	source := LineSourceEvidence{Total: n, LineCode: "software", Watermark: "epoch:1", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	for page := 1; page <= (n+99)/100; page++ {
		p := catalogPage(page, n, "epoch:1")
		source.Items = append(source.Items, p.Items...)
		if _, err = AppendCatalogPage(ctx, db, "admin", r.BizID, catalogPermit("admin"), uint64(page), p); err != nil {
			t.Fatal(err)
		}
	}
	id, permit, _, d, _ := onboardFixture(LineWorkspaceCode("software"), "line")
	id.Action = "products:onboard-line"
	input := LineOnboardInput{LineCode: "software", ExpectedWatermark: "epoch:1", ManagerUID: "manager", ProductCodes: lineProductCodes(source)}
	return id, permit, source, d, input
}
func lineProductCodes(source LineSourceEvidence) []string {
	codes := make([]string, 0, len(source.Items))
	for _, item := range source.Items {
		codes = append(codes, item.ProductCode)
	}
	return codes
}
func treePermit(uid string, mask int, onboard bool) ProductListPermit {
	return ProductListPermit{ActorUID: uid, Resource: "products", Action: "view", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli(), DefaultMask: mask, CanOnboard: onboard}
}
func TestMySQLLineOnboardAtomicTreePaginationAndReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, input := lineFixture(t, db, 105)
	tree, err := ListProducts(ctx, db, "admin", treePermit("admin", 1, true), ProductListQuery{Page: 1, PageSize: 20, Tree: true})
	if err != nil || tree.Total != 1 || len(tree.Groups) != 1 || tree.Groups[0].Total != 105 || !tree.Groups[0].CanUnify {
		t.Fatalf("tree %#v %v", tree, err)
	}
	result, err := OnboardProductLine(ctx, db, id, p, s, d, input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := OnboardProductLine(ctx, db, id, p, s, d, input)
	var firstValue, replayValue map[string]any
	json.Unmarshal(result.Value, &firstValue)
	json.Unmarshal(replay.Value, &replayValue)
	if err != nil || !replay.Replayed || !reflect.DeepEqual(firstValue, replayValue) {
		t.Fatalf("replay %v %v", replay, err)
	}
	for table, want := range map[string]int{"product_workspaces": 1, "product_line_workspaces": 1, "product_components": 105, "product_component_sources": 105, "product_members": 1} {
		var got int
		if err = db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&got); err != nil || got != want {
			t.Fatalf("%s=%d %v", table, got, err)
		}
	}
	// Manager scope on the actual line root authorizes its source modules, never unrelated products.
	tree, err = ListProducts(ctx, db, "manager", treePermit("manager", 4, false), ProductListQuery{Page: 1, PageSize: 20, Tree: true})
	if err != nil || len(tree.Groups) != 1 || tree.Groups[0].ManagementProductCode == nil || *tree.Groups[0].ManagementProductCode != id.ProductCode || tree.Groups[0].CanUnify {
		t.Fatalf("managed %#v %v", tree, err)
	}
	line := "software"
	children, err := ListProducts(ctx, db, "manager", treePermit("manager", 4, false), ProductListQuery{Page: 6, PageSize: 20, Tree: true, ChildLine: &line})
	if err != nil || children.Total != 105 || len(children.Items) != 5 || children.Items[0].ProductCode != "P-101" || children.Items[0].ManagementProductCode == nil || children.Items[0].ComponentID == nil {
		t.Fatalf("children %#v %v", children, err)
	}
	hidden, err := ListProducts(ctx, db, "outsider", treePermit("outsider", 4, false), ProductListQuery{Page: 1, PageSize: 20, Tree: true, ChildLine: &line})
	if err != nil || hidden.Total != 0 {
		t.Fatalf("leak %#v %v", hidden, err)
	}
	flat, err := ListProducts(ctx, db, "manager", treePermit("manager", 4, false), ProductListQuery{Page: 1, PageSize: 20})
	if err != nil || flat.Total != 1 || flat.Items[0].ProductName == nil || *flat.Items[0].ProductName != "software" {
		t.Fatalf("flat %#v %v", flat, err)
	}
	detail, err := ReadWorkspace(ctx, db, id.ProductCode, "manager", workspacePermit(t, db, id.ProductCode, "manager", "view"))
	if err != nil || detail.ProductName == nil || *detail.ProductName != "software" {
		t.Fatalf("detail %#v %v", detail, err)
	}
	single, sp, ss, sd, si := onboardFixture("P-001", "single")
	if _, err = OnboardWorkspace(ctx, db, single, sp, ss, sd, si); err == nil {
		t.Fatal("source independently onboarded")
	}
	// A product the unified line never took in keeps its own onboarding path.
	single, sp, ss, sd, si = onboardFixture("P-NEW", "new")
	ss.ProductLine = "software"
	if _, err = OnboardWorkspace(ctx, db, single, sp, ss, sd, si); err != nil {
		t.Fatalf("product outside the unified modules rejected: %v", err)
	}
	var own int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_workspaces WHERE product_code='P-NEW'`).Scan(&own); err != nil || own != 1 {
		t.Fatalf("independent space missing %d %v", own, err)
	}
	p.ExpiresAt = 1
	if _, err = OnboardProductLine(ctx, db, id, p, s, d, input); err == nil {
		t.Fatal("expired replay")
	}
}
func TestMySQLLineUnifiesRemainingProductsAroundManagedOnes(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, i := lineFixture(t, db, 3)
	workspaceFixture(t, db, "P-002")
	if _, err := db.Exec(`UPDATE product_workspaces SET status='archived' WHERE product_code='P-002'`); err != nil {
		t.Fatal(err)
	}
	// A managed product no longer blocks the whole line, but eligibility still
	// must not be derived from a filtered child page.
	r, err := ListProducts(ctx, db, "admin", treePermit("admin", 1, true), ProductListQuery{Page: 1, PageSize: 1, Tree: true, Keyword: "Product 1", Status: "not_enabled"})
	if err != nil || len(r.Groups) != 1 || !r.Groups[0].CanUnify {
		t.Fatalf("remaining products not unifiable %#v %v", r, err)
	}
	if _, err = OnboardProductLine(ctx, db, id, p, s, d, i); err == nil {
		t.Fatal("existing archived space merged")
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_line_workspaces`).Scan(&n); err != nil || n != 0 {
		t.Fatal("partial line")
	}
	i.ProductCodes = []string{"P-001", "P-003"}
	if _, err = OnboardProductLine(ctx, db, id, p, s, d, i); err != nil {
		t.Fatalf("remaining products rejected: %v", err)
	}
	for table, want := range map[string]int{"product_line_workspaces": 1, "product_components": 2, "product_component_sources": 2} {
		if err = db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != want {
			t.Fatalf("%s=%d %v", table, n, err)
		}
	}
	// The independently managed product keeps its own space and is not a module.
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_component_sources WHERE source_product_code='P-002'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("managed product merged %d %v", n, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_workspaces WHERE product_code='P-002'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("managed workspace lost %d %v", n, err)
	}
	r, err = ListProducts(ctx, db, "admin", treePermit("admin", 1, true), ProductListQuery{Page: 1, PageSize: 20, Tree: true})
	if err != nil || len(r.Groups) != 1 || r.Groups[0].ManagementProductCode == nil || r.Groups[0].CanUnify {
		t.Fatalf("line still unifiable %#v %v", r, err)
	}
}
func TestMySQLLineUnifiesAroundNonOnboardableProducts(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, i := lineFixture(t, db, 3)
	s.Items[1].Onboardable = false
	i.ProductCodes = []string{"P-001", "P-002"}
	if _, err := OnboardProductLine(ctx, db, id, p, s, d, i); err == nil {
		t.Fatal("non-onboardable product accepted")
	}
	// The blocked product only stops itself, not the rest of the line.
	i.ProductCodes = []string{"P-001", "P-003"}
	if _, err := OnboardProductLine(ctx, db, id, p, s, d, i); err != nil {
		t.Fatalf("remaining products rejected: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_component_sources`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("components=%d %v", n, err)
	}
	// The product left out of the unified space can still be onboarded on its own.
	single, sp, ss, sd, si := onboardFixture("P-002", "left-out")
	ss.ProductLine = "software"
	if _, err := OnboardWorkspace(ctx, db, single, sp, ss, sd, si); err != nil {
		t.Fatalf("left out product rejected: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_workspaces WHERE product_code='P-002'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("left out space missing %d %v", n, err)
	}
}
func TestMySQLLineOnboardAuditRollbackAndEvidence(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, i := lineFixture(t, db, 2)
	for _, kind := range []string{"actor", "directory", "expired", "watermark", "line", "duplicate", "lifecycle", "truncated"} {
		p2, d2, s2 := p, d, s
		s2.Items = append([]CatalogSourceItem{}, s.Items...)
		switch kind {
		case "actor":
			p2.ActorUID = "other"
		case "directory":
			d2.ActiveUIDs = []string{"other"}
		case "expired":
			s2.ExpiresAt = 1
		case "watermark":
			s2.Watermark = "changed"
		case "line":
			s2.Items[0].ProductLine = "other"
		case "duplicate":
			s2.Items[1] = s2.Items[0]
		case "truncated":
			s2.Total++
		case "lifecycle":
			s2.Items[0].Onboardable = false
		}
		if _, err := OnboardProductLine(ctx, db, id, p2, s2, d2, i); err == nil {
			t.Fatalf("accepted %s", kind)
		}
	}
	if _, err := db.Exec(`CREATE TRIGGER line_audit_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err := OnboardProductLine(ctx, db, id, p, s, d, i); err == nil {
		t.Fatal("audit failure ignored")
	}
	for _, table := range []string{"product_workspaces", "product_members", "product_components", "product_line_workspaces", "product_component_sources", "product_command_receipts"} {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s partial %d %v", table, n, err)
		}
	}
}
func TestMySQLLineAndIndividualConcurrentOnboard(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, i := lineFixture(t, db, 2)
	single, sp, ss, sd, si := onboardFixture("P-001", "single")
	ss.ProductLine = "software"
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); _, err := OnboardProductLine(ctx, db, id, p, s, d, i); errs <- err }()
	go func() { defer wg.Done(); _, err := OnboardWorkspace(ctx, db, single, sp, ss, sd, si); errs <- err }()
	wg.Wait()
	close(errs)
	success := 0
	for err := range errs {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("success=%d", success)
	}
}
func TestLineIdentityAndInput(t *testing.T) {
	if LineWorkspaceCode("a") == LineWorkspaceCode("A") || len(LineWorkspaceCode("产品线")) > 64 {
		t.Fatal("identity collision")
	}
	id := LineWorkspaceCode("a")
	encoded, _ := json.Marshal(id)
	if len(encoded) == 0 {
		t.Fatal("identity not serializable")
	}
}

func TestMySQLLineOnboardConcurrentReplayAndDifferentPayload(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, i := lineFixture(t, db, 2)
	var wg sync.WaitGroup
	results := make(chan CommandResult, 2)
	errs := make(chan error, 2)
	wg.Add(2)
	for range 2 {
		go func() { defer wg.Done(); r, e := OnboardProductLine(ctx, db, id, p, s, d, i); results <- r; errs <- e }()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	replayed := 0
	for r := range results {
		if r.Replayed {
			replayed++
		}
	}
	if replayed != 1 {
		t.Fatalf("replays=%d", replayed)
	}
	i.ProductCodes = i.ProductCodes[:1]
	if _, e := OnboardProductLine(ctx, db, id, p, s, d, i); e == nil {
		t.Fatal("different payload replayed")
	}
	id.IdempotencyKey = "another"
	if _, e := OnboardProductLine(ctx, db, id, p, s, d, i); e == nil {
		t.Fatal("another onboarding accepted")
	}
}

// A line onboarded before Assets had labels must follow each activated catalog,
// including root-only member scopes and keyword filtering, without renaming identities.
func TestMySQLLineDisplayTracksActiveCatalog(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	id, p, s, d, input := lineFixture(t, db, 2)
	if _, err := OnboardProductLine(ctx, db, id, p, s, d, input); err != nil {
		t.Fatal(err)
	}
	for i, label := range []string{"软件产品线", "软件与服务", ""} {
		key := fmt.Sprintf("rename-%d", i)
		batch, err := StartCatalogRefresh(ctx, db, "admin", key, catalogPermit("admin"))
		if err != nil {
			t.Fatal(err)
		}
		page := catalogPage(1, 2, key)
		for j := range page.Items {
			page.Items[j].ProductLineLabel = &label
		}
		if _, err = AppendCatalogPage(ctx, db, "admin", batch.BizID, catalogPermit("admin"), 1, page); err != nil {
			t.Fatal(err)
		}
		want := label
		if want == "" {
			want = "software"
		}
		// A root-only explicit scope cannot rely on visible child rows to recover the label.
		permit := treePermit("reader", 0, false)
		permit.Overrides = []ProductScopeOverride{{ProductCode: id.ProductCode, Mask: 1}}
		tree, err := ListProducts(ctx, db, "reader", permit, ProductListQuery{Page: 1, PageSize: 20, Tree: true, Keyword: want})
		if err != nil || len(tree.Groups) != 1 || tree.Groups[0].Label != want {
			t.Fatalf("tree %q %#v %v", want, tree, err)
		}
		flat, err := ListProducts(ctx, db, "reader", permit, ProductListQuery{Page: 1, PageSize: 20, Keyword: want})
		if err != nil || len(flat.Items) != 1 || flat.Items[0].ProductName == nil || *flat.Items[0].ProductName != want {
			t.Fatalf("flat %q %#v %v", want, flat, err)
		}
		detail, err := ReadWorkspace(ctx, db, id.ProductCode, "manager", workspacePermit(t, db, id.ProductCode, "manager", "view"))
		if err != nil || detail.ProductName == nil || *detail.ProductName != want || detail.ProductLineLabel == nil || *detail.ProductLineLabel != want {
			t.Fatalf("detail %q %#v %v", want, detail, err)
		}
		hidden, err := ListProducts(ctx, db, "outsider", treePermit("outsider", 0, false), ProductListQuery{Page: 1, PageSize: 20, Tree: true, Keyword: want})
		if err != nil || hidden.Total != 0 {
			t.Fatalf("label search leaks %#v %v", hidden, err)
		}
	}
	var saved string
	if err := db.QueryRow(`SELECT line_label FROM product_line_workspaces WHERE product_code=?`, id.ProductCode).Scan(&saved); err != nil || saved != "software" {
		t.Fatalf("historical identity changed %q %v", saved, err)
	}
}
