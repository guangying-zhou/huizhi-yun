package aims

import (
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestDirectRequirementCollectionRoutesBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	routeIndex := strings.Index(content, `a.directRequirementCollectionList(ctx, path, query)`)
	genericIndex := strings.Index(content, `a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)`)
	if routeIndex == -1 {
		t.Fatal("missing direct requirement collection route")
	}
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime fallback")
	}
	if routeIndex > genericIndex {
		t.Fatal("direct requirement collection route must run before generic runtime fallback")
	}
}

func TestDirectRequirementListWhereUsesProjectVisibility(t *testing.T) {
	query := url.Values{
		"current_user":                []string{"u1"},
		"project_code":                []string{"PRJ-001"},
		"status":                      []string{"draft"},
		"q":                           []string{"checkout"},
		"current_user_dept_codes":     []string{"dept-rd"},
		"project_admin_project_codes": []string{"PRJ-ADMIN"},
	}

	where, args := directRequirementListWhere(query, directRequirementListConfigs["/v1/aims/requirements"], "u1")
	joined := strings.Join(where, " AND ")
	for _, expected := range []string{
		"p.project_code = ?",
		"r.status = ?",
		"r.req_code LIKE ?",
		"r.title LIKE ?",
		"EXISTS (SELECT 1 FROM aims_project_members pam",
		"p.project_code IN (?)",
		"p.dept_code IN (?)",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("where clause missing %q in %s", expected, joined)
		}
	}
	if len(args) == 0 {
		t.Fatal("expected scoped requirement list args")
	}
}

func TestDirectRequirementListConfigsCoverTopLevelCollections(t *testing.T) {
	for _, path := range []string{
		"/v1/aims/requirements",
		"/v1/aims/requirement-contents",
		"/v1/aims/requirement-reviews",
	} {
		cfg, ok := directRequirementListConfigs[path]
		if !ok {
			t.Fatalf("missing config for %s", path)
		}
		if cfg.table == "" || cfg.alias == "" || cfg.orderBy == "" {
			t.Fatalf("incomplete config for %s: %#v", path, cfg)
		}
		if cfg.exactFilters["project_code"] == "" || cfg.exactFilters["projectCode"] == "" {
			t.Fatalf("%s must support project code filters", path)
		}
	}
}
