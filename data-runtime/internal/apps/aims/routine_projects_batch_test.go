package aims

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestRoutineProjectBatchRequiresTrustedSystemAdminFlag(t *testing.T) {
	adapter, _, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.batchCreateRoutineDepartmentProjects(
		context.Background(),
		url.Values{"current_user": {"admin"}},
		map[string]any{"year": float64(2026), "departments": []any{}},
	)
	if err == nil {
		t.Fatal("expected batch without trusted system admin flag to fail")
	}
	if httpErr, ok := err.(httperror.Error); !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("err = %#v, want 403 httperror", err)
	}
}

func TestRoutineProjectBatchCreatesPortfolioProjectAndDepartmentMembers(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	projectCode := routineDepartmentProjectCode(2026, "D-DEV")
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, status.*FROM project_portfolios.*default_category = 'routine'.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}))
	mock.ExpectExec(`(?s)INSERT INTO project_portfolios`).
		WithArgs("不立项的日常工作容器集合，按部门 × 年建立。其下项目分类固定为 routine，不使用 PIVR 阶段与里程碑。", "admin").
		WillReturnResult(sqlmock.NewResult(9, 1))
	mock.ExpectQuery(`(?s)SELECT id, project_code.*FROM aims_projects.*category = 'routine'.*dept_code = \?.*name = \?.*FOR UPDATE`).
		WithArgs("D-DEV", "研发部2026").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}))
	mock.ExpectQuery(`(?s)SELECT id, name, dept_code, category.*FROM aims_projects.*project_code = \?.*FOR UPDATE`).
		WithArgs(projectCode).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "dept_code", "category"}))
	mock.ExpectExec(`(?s)INSERT INTO aims_projects`).
		WithArgs(
			projectCode,
			"研发部2026",
			"研发部",
			"2026年度研发部日常事务项目",
			int64(9),
			"D-DEV",
			"u-manager",
			"2026-01-01",
			"2026-12-31",
			sqlmock.AnyArg(),
			"admin",
		).
		WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectExec(`INSERT INTO project_counters`).
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO project_lifecycle_events`).
		WithArgs(int64(42), "admin").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO aims_project_members`).
		WithArgs(
			int64(42), "u-1", "member",
			int64(42), "u-2", "member",
			int64(42), "u-manager", "manager",
		).
		WillReturnResult(sqlmock.NewResult(1, 3))
	mock.ExpectCommit()

	data, err := adapter.batchCreateRoutineDepartmentProjects(
		context.Background(),
		url.Values{
			"current_user":                  {"admin"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"year": float64(2026),
			"departments": []any{
				map[string]any{
					"deptCode":   "D-DEV",
					"name":       "研发部",
					"managerUid": "u-manager",
					"memberUids": []any{"u-2", "u-manager", "u-1", "u-1"},
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("batch create returned error: %v", err)
	}
	summary, _ := data["summary"].(map[string]any)
	if summary["created"] != 1 || summary["existing"] != 0 || summary["missingManager"] != 0 {
		t.Fatalf("summary = %#v", summary)
	}
	items, _ := data["items"].([]map[string]any)
	if len(items) != 1 || items[0]["projectCode"] != projectCode || items[0]["memberCount"] != 3 {
		t.Fatalf("items = %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRoutineProjectBatchSkipsExistingAndMissingManagerDepartments(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, status.*FROM project_portfolios.*default_category = 'routine'.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}).AddRow(int64(9), "active"))
	mock.ExpectQuery(`(?s)SELECT id, project_code.*FROM aims_projects.*category = 'routine'.*dept_code = \?.*name = \?.*FOR UPDATE`).
		WithArgs("D-A", "行政部2026").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}).AddRow(int64(51), "RT2026ADMIN"))
	mock.ExpectCommit()

	data, err := adapter.batchCreateRoutineDepartmentProjects(
		context.Background(),
		url.Values{
			"current_user":                  {"admin"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"year": float64(2026),
			"departments": []any{
				map[string]any{
					"deptCode":   "D-B",
					"name":       "财务部",
					"managerUid": nil,
					"memberUids": []any{},
				},
				map[string]any{
					"deptCode":   "D-A",
					"name":       "行政部",
					"managerUid": "u-admin",
					"memberUids": []any{"u-admin"},
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("batch create returned error: %v", err)
	}
	summary, _ := data["summary"].(map[string]any)
	if summary["created"] != 0 || summary["existing"] != 1 || summary["missingManager"] != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRoutineProjectBatchSkipsStableDepartmentYearCodeAfterDepartmentRename(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	projectCode := routineDepartmentProjectCode(2026, "D-DEV")
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, status.*FROM project_portfolios.*default_category = 'routine'.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}).AddRow(int64(9), "active"))
	mock.ExpectQuery(`(?s)SELECT id, project_code.*FROM aims_projects.*category = 'routine'.*dept_code = \?.*name = \?.*FOR UPDATE`).
		WithArgs("D-DEV", "研发中心2026").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}))
	mock.ExpectQuery(`(?s)SELECT id, name, dept_code, category.*FROM aims_projects.*project_code = \?.*FOR UPDATE`).
		WithArgs(projectCode).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "dept_code", "category"}).
			AddRow(int64(52), "研发部2026", "D-DEV", "routine"))
	mock.ExpectCommit()

	data, err := adapter.batchCreateRoutineDepartmentProjects(
		context.Background(),
		url.Values{
			"current_user":                  {"admin"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"year": float64(2026),
			"departments": []any{
				map[string]any{
					"deptCode":   "D-DEV",
					"name":       "研发中心",
					"managerUid": "u-manager",
					"memberUids": []any{"u-manager"},
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("batch create returned error: %v", err)
	}
	summary, _ := data["summary"].(map[string]any)
	if summary["created"] != 0 || summary["existing"] != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRoutineDepartmentProjectCodeIsStableAndBounded(t *testing.T) {
	first := routineDepartmentProjectCode(2026, "研发中心/平台组")
	second := routineDepartmentProjectCode(2026, "研发中心/平台组")
	if first != second {
		t.Fatalf("project code is not stable: %q != %q", first, second)
	}
	if len(first) > 50 {
		t.Fatalf("project code is too long: %q", first)
	}
}
