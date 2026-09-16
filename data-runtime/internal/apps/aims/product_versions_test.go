package aims

import (
	"os"
	"strings"
	"testing"
)

func TestProjectNestedRestAllowsNestedSegments(t *testing.T) {
	projectID, rest, ok := projectNestedRest("/v1/aims/projects/42/releases/7/features/9", "/v1/aims/projects/", "/releases/")
	if !ok {
		t.Fatal("expected nested release route to match")
	}
	if projectID != "42" || rest != "7/features/9" {
		t.Fatalf("unexpected match: projectID=%q rest=%q", projectID, rest)
	}
}

func TestProjectNestedRestRejectsNestedProjectID(t *testing.T) {
	_, _, ok := projectNestedRest("/v1/aims/projects/42/extra/releases/7", "/v1/aims/projects/", "/releases/")
	if ok {
		t.Fatal("expected route with nested project id to be rejected")
	}
}

func TestProjectReleasesListQueryIncludesFeatureAggregate(t *testing.T) {
	sql := projectReleasesListQuery([]string{"pv.status = ?"})

	required := []string{
		"COALESCE(features.feature_count, 0) AS feature_count",
		"COALESCE(features.delivered_feature_count, 0) AS delivered_feature_count",
		"FROM product_version_features",
		") features ON features.version_id = pv.id",
		"WHERE pv.status = ?",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("project releases query missing %q:\n%s", fragment, sql)
		}
	}
	if strings.Index(sql, "FROM product_version_features") > strings.Index(sql, "WHERE pv.status = ?") {
		t.Fatalf("feature aggregate join must appear before WHERE clause:\n%s", sql)
	}
}

func TestCreateProjectAppliesPortfolioDefaultCategory(t *testing.T) {
	contentBytes, err := os.ReadFile("product_versions.go")
	if err != nil {
		t.Fatalf("read product_versions.go: %v", err)
	}
	content := string(contentBytes)

	// 项目集默认分类承载执行形态（V1.1 §1.4）：
	//   - routine 为强约束，显式指定其他分类必须被拒绝
	//   - 其余默认分类仅在调用方未指定 category 时生效
	requiredTokens := []string{
		"projectPortfolioDefaultCategory",
		"requestedCategory",
		`case defaultCategory == "routine":`,
		"routine_category_locked",
		`case defaultCategory != "" && requestedCategory == "":`,
		"resolveProjectTemplateVersionTx(ctx, tx, category, requestedTemplateVersionID)",
		"portfolioValue",
		"projectInitialLifecycleStatus(category)",
		"methodology, lifecycle_status",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("project create runtime must apply portfolio default category, missing %q", token)
		}
	}

	normalizeIndex := strings.Index(content, "projectPortfolioDefaultCategory")
	lockIndex := strings.Index(content, "routine_category_locked")
	templateIndex := strings.Index(content, "resolveProjectTemplateVersionTx(ctx, tx, category, requestedTemplateVersionID)")
	if normalizeIndex < 0 || lockIndex < normalizeIndex || templateIndex < lockIndex {
		t.Fatalf("project category must be normalized before resolving project template")
	}

	// 产品线项目集的既有行为由 default_category 承接：
	// default_category 为空但 is_product_line=1 的存量项目集仍归为 product_dev
	if !strings.Contains(content, `return "product_dev", nil`) {
		t.Fatal("legacy is_product_line portfolios must still resolve to product_dev")
	}
}
