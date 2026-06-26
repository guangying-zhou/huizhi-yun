package aims

import (
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
