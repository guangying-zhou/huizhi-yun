package aims

import (
	"context"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestProjectReleasesPaginationRejectsInvisibleProjectBeforeCount(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery(`(?s)SELECT p.id, p.project_code, p.name, p.category, p.leader_uid, m.role.*FROM aims_projects p`).
		WithArgs("u1", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "name", "category", "leader_uid", "role"}).AddRow(int64(42), "PRJ-1", "项目", "product_dev", "person-b", nil))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM aims_projects p.*WHERE p.id = \?`).
		WithArgs(int64(42), "u1", "u1", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))
	_, err := adapter.listProjectReleases(context.Background(), "42", url.Values{"current_user": {"u1"}, "page": {"1"}})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden {
		t.Fatalf("invisible project result = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectReleasesOptionalPaginationPreservesLegacyShape(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		query    url.Values
		count    bool
		listArgs []driver.Value
		total    int64
		rows     *sqlmock.Rows
	}{
		{
			name: "legacy full list", query: url.Values{"current_user": {"u1"}},
			listArgs: []driver.Value{int64(42), int64(42), int64(42)},
			rows:     sqlmock.NewRows([]string{"id", "version_code"}).AddRow(int64(9), "v1"),
		},
		{
			name: "first page", query: url.Values{"current_user": {"u1"}, "page": {"1"}, "pageSize": {"2"}, "status": {"released"}}, count: true, total: 3,
			listArgs: []driver.Value{int64(42), int64(42), int64(42), "released", int64(2), int64(0)},
			rows:     sqlmock.NewRows([]string{"id", "version_code"}).AddRow(int64(9), "v1"),
		},
		{
			name: "out of range", query: url.Values{"current_user": {"u1"}, "page": {"3"}, "pageSize": {"2"}, "status": {"released"}}, count: true, total: 3,
			listArgs: []driver.Value{int64(42), int64(42), int64(42), "released", int64(2), int64(4)},
			rows:     sqlmock.NewRows([]string{"id", "version_code"}),
		},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			adapter, mock, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			mock.ExpectQuery(`(?s)SELECT p.id, p.project_code, p.name, p.category, p.leader_uid, m.role.*FROM aims_projects p`).
				WithArgs("u1", int64(42)).
				WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "name", "category", "leader_uid", "role"}).AddRow(int64(42), "PRJ-1", "项目", "product_dev", "u1", nil))
			if scenario.count {
				mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM product_versions pv.*WHERE.*EXISTS.*pv.status = \?`).
					WithArgs(int64(42), int64(42), int64(42), "released").
					WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(scenario.total))
			}
			mock.ExpectQuery(`(?s)SELECT.*FROM product_versions pv.*ORDER BY pv.product_code ASC, pv.sort_order ASC, pv.created_at DESC, pv.id DESC`).
				WithArgs(scenario.listArgs...).WillReturnRows(scenario.rows)
			result, err := adapter.listProjectReleases(context.Background(), "42", scenario.query)
			if err != nil {
				t.Fatal(err)
			}
			items := result["items"].([]map[string]any)
			if scenario.count {
				if result["total"] != scenario.total || result["page"] == nil || result["pageSize"] != int64(2) {
					t.Fatalf("paginated result = %#v", result)
				}
				if scenario.name == "out of range" && len(items) != 0 {
					t.Fatalf("out-of-range items = %#v", items)
				}
			} else if len(result) != 1 || len(items) != 1 || items[0]["id"] != int64(9) {
				t.Fatalf("legacy result = %#v", result)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

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
