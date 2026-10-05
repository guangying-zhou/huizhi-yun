package enterpriseviews

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseassets"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
)

// caller is one call of enterprise.VerifyCompatibilityViews(Tx): the file it is
// in (relative to internal/), the domain argument and the names argument as
// written in the source.
type caller struct{ file, domain, names string }

func (c caller) key() string { return c.file + "|" + c.domain + "|" + c.names }

// registry lists the names each caller requires. A new caller, or a caller
// whose argument changes, fails TestEveryCompatibilityViewCallerIsRegistered
// until it is added here, and TestCallerNamesAreInstalled then requires its
// names to be part of the installed view family (Aims()/Assets()).
var registry = map[string][]string{
	"apps/workflow/enterprise_binding.go|\"workflow\"|EnterpriseViewNames()":                           workflow.EnterpriseViewNames(),
	"enterprisescheduler/service.go|\"aims\"|viewNames":                                                append(enterprisescheduler.CompletionViewNames(), "work_item_completion_requests"),
	"enterpriseplanning/features.go|\"aims\"|views":                                                    enterpriseplanning.FeatureViewNames(),
	"enterpriseplanning/handoff.go|\"aims\"|views":                                                     enterpriseplanning.HandoffViewNames(),
	"enterpriseplanning/requests.go|\"aims\"|views":                                                    enterpriseplanning.RequestViewNames(),
	"enterpriseplanning/catalog.go|\"aims\"|CatalogViewNames()":                                        enterpriseplanning.CatalogViewNames(),
	"enterpriseplanning/onboarding.go|\"aims\"|OnboardingViewNames()":                                  enterpriseplanning.OnboardingViewNames(),
	"enterpriseplanning/components.go|\"aims\"|ComponentViewNames()":                                   enterpriseplanning.ComponentViewNames(),
	"enterpriseplanning/planning.go|\"aims\"|PlanningViewNames()":                                      enterpriseplanning.PlanningViewNames(),
	"enterpriseplanning/versions.go|\"aims\"|VersionViewNames()":                                       enterpriseplanning.VersionViewNames(),
	"enterprisecontracts/milestone_receivable.go|\"aims\"|MilestoneReceivableAimsViews()":              enterprisecontracts.MilestoneReceivableAimsViews(),
	"enterprisecontracts/activation.go|\"aims\"|ActivationAimsViews()":                                 enterprisecontracts.ActivationAimsViews(),
	"enterpriseassets/products.go|\"assets\"|ProductViewNames()":                                       enterpriseassets.ProductViewNames(),
	"apps/aims/enterprise_write_transaction.go|\"aims\"|names":                                         aims.EnterpriseWriteViewNames(),
	"apps/aims/enterprise_due_notifications.go|\"aims\"|EnterpriseDueNotificationViewNames()":          aims.EnterpriseDueNotificationViewNames(),
	"apps/aims/enterprise_work_item_delete.go|\"aims\"|EnterpriseWorkItemDeleteViewNames()":            aims.EnterpriseWorkItemDeleteViewNames(),
	"apps/aims/enterprise_work_item_completion.go|\"aims\"|EnterpriseCompletionArtifactViewNames()":    aims.EnterpriseCompletionArtifactViewNames(),
	"apps/aims/enterprise_work_item_completion.go|\"aims\"|EnterpriseCompletionTransactionViewNames()": aims.EnterpriseCompletionTransactionViewNames(),
	"apps/aims/work_item_completion_callback.go|\"aims\"|EnterpriseCompletionTransactionViewNames()":   aims.EnterpriseCompletionTransactionViewNames(),
	"apps/aims/enterprise_milestone_rollover.go|\"aims\"|EnterpriseMilestoneRolloverViewNames()":       aims.EnterpriseMilestoneRolloverViewNames(),
	"apps/assets/enterprise_due_notifications.go|\"assets\"|EnterpriseDueNotificationViewNames()":      assets.EnterpriseDueNotificationViewNames(),
	"apps/assets/enterprise_product_adoption.go|\"assets\"|EnterpriseProductAdoptionViewNames()":       assets.EnterpriseProductAdoptionViewNames(),
	"apps/assets/adapter.go|\"assets\"|EnterpriseAdapterViewNames()":                                   assets.EnterpriseAdapterViewNames(),
	// Domains installed by their own tools: their families are not part of Sets().
	"enterprisecontracts/milestone_receivable.go|\"altoc\"|ActivationAltocViews()": nil,
	"enterprisecontracts/activation.go|\"altoc\"|ActivationAltocViews()":           nil,
	"enterprise/domaininstall/install.go|x.domain|logical":                         nil,
}

func render(fset *token.FileSet, expr ast.Expr) string {
	var b bytes.Buffer
	_ = printer.Fprint(&b, fset, expr)
	return b.String()
}

func scanCallers(t *testing.T) []caller {
	t.Helper()
	var found []caller
	err := filepath.WalkDir("..", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		rel, _ := filepath.Rel("..", path)
		if rel == "enterprise/compatibility_views.go" {
			return nil
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != "VerifyCompatibilityViews" && sel.Sel.Name != "VerifyCompatibilityViewsTx") {
				return true
			}
			if len(call.Args) != 5 {
				t.Errorf("%s: unexpected argument count", rel)
				return true
			}
			found = append(found, caller{file: filepath.ToSlash(rel), domain: render(fset, call.Args[3]), names: render(fset, call.Args[4])})
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

func TestEveryCompatibilityViewCallerIsRegistered(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range scanCallers(t) {
		seen[c.key()] = true
		if _, ok := registry[c.key()]; !ok {
			t.Errorf("unregistered VerifyCompatibilityViews caller %q: export its names, add them to Aims()/Assets() and register it", c.key())
		}
	}
	for key := range registry {
		if !seen[key] {
			t.Errorf("registry entry %q no longer matches a caller", key)
		}
	}
}

func loadBinding(t *testing.T, name string, domains ...string) e.Binding {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var mapping map[string]map[string]string
	if err = json.Unmarshal(raw, &mapping); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Domains: map[string]e.DomainBinding{}}
	for domain, tables := range mapping {
		if len(domains) > 0 {
			keep := false
			for _, want := range domains {
				keep = keep || want == domain
			}
			if !keep {
				continue
			}
		}
		b.Domains[domain] = e.DomainBinding{Tables: tables}
	}
	return b
}

func viewNames(t *testing.T, name string) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, line := range strings.Fields(string(raw)) {
		out[line] = true
	}
	return out
}

// Every caller's names must be part of the family derived from the real
// mappings (or need no view because the physical table has the same name).
func TestCallerNamesAreInstalled(t *testing.T) {
	for _, fixture := range []string{"r3-mapping.json", "hzy0-mapping.json"} {
		b := PruneExclusive(loadBinding(t, fixture))
		b.Domains["workflow"] = workflowTestDomain()

		family, err := Install(b)
		if err != nil {
			t.Fatalf("%s: %v", fixture, err)
		}
		for key, names := range registry {
			domain := strings.Trim(strings.Split(key, "|")[1], "\"")
			if _, installed := family[domain]; !installed {
				if names != nil {
					t.Errorf("%s: a domain outside InstalledDomains must be registered with nil names", key)
				}
				continue
			}
			if len(names) == 0 {
				t.Errorf("%s: no names registered", key)
			}
			have := map[string]bool{}
			for _, name := range family[domain] {
				have[name] = true
			}
			for _, name := range names {
				if physical, mapped := b.Domains[domain].Tables[name]; !have[name] && !(mapped && physical == name) {
					t.Errorf("%s: %s requires view %q which the derived family would not create", fixture, key, name)
				}
			}
		}
	}
}

// hzy0 runs the unified store the reference way: its views are the renamed,
// non-shared mapping entries of Aims, Assets and Altoc. It also still carries a
// legacy service_command_receipt view (created before that name was declared
// shared); new environments must not get it.
func TestDeriveMatchesTheReferenceEnvironment(t *testing.T) {
	b := PruneExclusive(loadBinding(t, "hzy0-mapping.json"))
	want := viewNames(t, "hzy0-views.txt")
	delete(want, "service_command_receipt")
	got := map[string]bool{}
	for _, domain := range []string{"aims", "assets", "altoc"} {
		names, err := Derive(b, domain)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			got[name] = true
		}
	}
	for name := range want {
		if !got[name] {
			t.Errorf("reference environment has view %q which Derive would not create", name)
		}
	}
	for name := range got {
		if !want[name] {
			t.Errorf("Derive would create %q which the reference environment does not have", name)
		}
	}
	family, err := Install(b)
	if err != nil {
		t.Fatal(err)
	}
	r3, err := Install(PruneExclusive(loadBinding(t, "r3-mapping.json")))
	if err != nil {
		t.Fatal(err)
	}
	if len(family["aims"]) != len(r3["aims"]) || len(family["assets"]) != len(r3["assets"]) {
		t.Errorf("hzy0 family %d/%d differs in size from the R3 mapping family %d/%d", len(family["aims"]), len(family["assets"]), len(r3["aims"]), len(r3["assets"]))
	}
	for domain := range family {
		for i, name := range family[domain] {
			if r3[domain][i] != name {
				t.Errorf("%s family differs from the R3 family at %q", domain, name)
				break
			}
		}
	}
	t.Logf("production family: aims=%d assets=%d", len(r3["aims"]), len(r3["assets"]))
}

// The exclusion must not depend on which domains a configuration enables, and
// an unreviewed cross-domain name must stop the installer.
func TestSharedNamesAreExcludedWhateverIsConfigured(t *testing.T) {
	shared := map[string]bool{}
	for _, name := range SharedPhysicalNames {
		shared[name] = true
	}
	for _, fixture := range []string{"r3-mapping.json", "hzy0-mapping.json"} {
		full := loadBinding(t, fixture)
		for _, name := range CrossDomainNames(full) {
			if _, exclusive := ExclusiveOwners[name]; !shared[name] && !exclusive {
				t.Errorf("%s: cross-domain name %q is neither shared nor exclusive", fixture, name)
			}
		}
	}
	// The raw plan maps system_parameters in Aims and Assets: without pruning, Derive refuses.
	if _, err := Derive(loadBinding(t, "r3-mapping.json"), "assets"); err == nil {
		t.Error("an unpruned exclusive name must be an error")
	}
	pruned := PruneExclusive(loadBinding(t, "r3-mapping.json"))
	if _, ok := pruned.Domains["aims"].Tables["system_parameters"]; ok {
		t.Error("aims must not map system_parameters after pruning")
	}
	if _, ok := pruned.Domains["assets"].Tables["system_parameters"]; !ok {
		t.Error("assets must keep system_parameters")
	}
	assetViews, err := Derive(pruned, "assets")
	if err != nil {
		t.Fatal(err)
	}
	foundDictionary := false
	for _, name := range assetViews {
		foundDictionary = foundDictionary || name == "system_parameters"
	}
	if !foundDictionary {
		t.Error("the Assets dictionary table system_parameters needs its view")
	}
	// Only Aims configured: the names Assets would also map still get no view.
	only := loadBinding(t, "r3-mapping.json", "aims")
	if len(CrossDomainNames(only)) != 0 {
		t.Fatal("test setup: a single domain has no cross-domain names")
	}
	names, err := Derive(only, "aims")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if shared[name] {
			t.Errorf("shared name %q received a view when only aims is configured", name)
		}
	}
	// No caller may depend on a shared name having a view.
	for key, names := range registry {
		for _, name := range names {
			if shared[name] {
				t.Errorf("%s requires shared name %q, which can never have a view", key, name)
			}
		}
	}
	// A new collision that nobody classified is refused.
	b := PruneExclusive(loadBinding(t, "r3-mapping.json"))
	b.Domains["aims"].Tables["brand_new_collision"] = "aims_brand_new_collision"
	b.Domains["assets"].Tables["brand_new_collision"] = "assets_brand_new_collision"
	if _, err := Derive(b, "aims"); err == nil {
		t.Error("an unclassified cross-domain name must be an error")
	}
}

func TestMappingHashTracksTheMapping(t *testing.T) {
	a := loadBinding(t, "r3-mapping.json")
	b := loadBinding(t, "r3-mapping.json")
	if MappingHash(a) != MappingHash(b) {
		t.Fatal("hash must be stable")
	}
	b.Domains["assets"].Tables["digital_assets"] = "assets_digital_assets_other"
	if MappingHash(a) == MappingHash(b) {
		t.Fatal("hash must change with the mapping")
	}
	c := loadBinding(t, "hzy0-mapping.json")
	delete(c.Domains, "altoc")
	if MappingHash(c) != MappingHash(loadBinding(t, "hzy0-mapping.json")) {
		t.Fatal("altoc is not part of the installed mapping")
	}
}

func TestRequiredListsAreSortedAndUnique(t *testing.T) {
	for domain, names := range RequiredByAdapters() {
		if !sort.StringsAreSorted(names) {
			t.Errorf("%s list is not sorted", domain)
		}
		for i := 1; i < len(names); i++ {
			if names[i] == names[i-1] {
				t.Errorf("%s list repeats %q", domain, names[i])
			}
		}
	}
	for _, name := range aims.EnterpriseWriteViewNames() {
		found := false
		for _, have := range Aims() {
			found = found || have == name
		}
		if !found {
			t.Errorf("Aims() is missing the write-path view %q", name)
		}
	}
}

func TestSeparatelyInstalledAltocViewsJoinTheFamilyOnlyWhenConfigured(t *testing.T) {
	b := loadBinding(t, "hzy0-mapping.json")
	names := SeparatelyInstalled(b)
	have := map[string]bool{}
	for _, name := range names {
		have[name] = true
	}
	for _, name := range []string{"customer", "contract", "opportunity", "quotation"} {
		if !have[name] {
			t.Fatalf("altoc view %q missing from %v", name, names)
		}
	}
	installed, err := Install(PruneExclusive(b))
	if err != nil {
		t.Fatal(err)
	}
	for _, list := range installed {
		for _, name := range list {
			if have[name] {
				t.Fatalf("%q must not be installed by the compatibility tool", name)
			}
		}
	}
	delete(b.Domains, "altoc")
	if got := SeparatelyInstalled(b); len(got) != 0 {
		t.Fatalf("no altoc domain must accept nothing: %v", got)
	}
}
