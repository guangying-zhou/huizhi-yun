package people

import (
	"context"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unsafe"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func newPeopleSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	compatAdapter := &compat.Adapter{}
	dbField := reflect.ValueOf(compatAdapter).Elem().FieldByName("db")
	reflect.NewAt(dbField.Type(), unsafe.Pointer(dbField.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	return &Adapter{Adapter: compatAdapter}, mock, func() { _ = db.Close() }
}

func configurePeopleEmployeeSearchAdapter(t *testing.T, adapter *Adapter) {
	t.Helper()
	value := reflect.ValueOf(adapter.Adapter).Elem()
	for name, fieldValue := range map[string]any{
		"appCode": "people",
		"resources": []compat.ResourceSpec{{
			Path:             "employees",
			Table:            "people_employees",
			CodeColumn:       "employee_uid",
			SearchColumns:    []string{"employee_uid", "display_name"},
			DefaultOrderBy:   "`id` ASC",
			SoftDeleteColumn: "archived_at",
			OwnerColumn:      "employee_uid",
			DepartmentColumn: "dept_code",
			PageSizeMax:      500,
			ListInFilters:    map[string]string{"dept_codes": "dept_code", "employee_uids": "employee_uid"},
		}},
	} {
		field := value.FieldByName(name)
		reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(fieldValue))
	}
	cache := value.FieldByName("columnCache")
	reflect.NewAt(cache.Type(), unsafe.Pointer(cache.UnsafeAddr())).Elem().Set(reflect.MakeMap(cache.Type()))
}

func TestSelectEffectivePrimaryAssignmentsRejectsNewerRejectedAssignment(t *testing.T) {
	rows := []map[string]any{
		{
			"id":              2,
			"assignment_code": "ASN-REJECTED",
			"employee_uid":    "u1",
			"is_primary":      1,
			"approval_status": "rejected",
			"effective_from":  "2026-07-01",
			"effective_to":    nil,
		},
		{
			"id":              1,
			"assignment_code": "ASN-APPROVED",
			"employee_uid":    "u1",
			"is_primary":      1,
			"approval_status": "approved",
			"effective_from":  "2026-01-01",
			"effective_to":    nil,
		},
	}

	selected, err := selectEffectivePrimaryAssignments(rows, "2026-08-01")
	if err != nil {
		t.Fatalf("selectEffectivePrimaryAssignments: %v", err)
	}
	if got := cleanAnyString(selected["u1"]["assignment_code"]); got != "ASN-APPROVED" {
		t.Fatalf("newer rejected assignment must not override approved assignment, got %q", got)
	}
}

func TestAssignmentPeriodsOverlapUsesInclusiveBoundaries(t *testing.T) {
	if !assignmentPeriodsOverlap("2026-01-01", "2026-06-30", "2026-06-30", "2026-12-31") {
		t.Fatal("same-day boundaries must overlap")
	}
	if assignmentPeriodsOverlap("2026-01-01", "2026-06-29", "2026-06-30", "") {
		t.Fatal("adjacent non-overlapping periods must be allowed")
	}
}

func TestEffectivePrimaryAssignmentsByEmployeeQueriesOnlyEffectiveApprovedPrimaryRows(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*.*FROM people_assignments.*is_primary = 1.*approval_status IN \('none', 'approved'\).*effective_from <= \?.*effective_to >= \?`).
		WithArgs("u1", "2026-06-30", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "assignment_code", "employee_uid", "is_primary", "approval_status", "effective_from", "effective_to",
		}).
			AddRow(2, "ASN-REJECTED", "u1", 1, "rejected", "2026-06-01", nil).
			AddRow(1, "ASN-APPROVED", "u1", 1, "approved", "2026-01-01", nil))

	selected, err := adapter.effectivePrimaryAssignmentsByEmployee(context.Background(), []string{"u1"}, "2026-06-30")
	if err != nil {
		t.Fatalf("effectivePrimaryAssignmentsByEmployee: %v", err)
	}
	if got := cleanAnyString(selected["u1"]["assignment_code"]); got != "ASN-APPROVED" {
		t.Fatalf("expected approved assignment, got %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateCostSnapshotsFreezesAsOfAssignmentFields(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT employee_uid, employee_no, display_name.*FROM people_employees.*employee_uid IN \(\?\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"employee_uid", "employee_no", "display_name", "employment_status", "employment_type",
			"dept_code", "dept_name", "position_code", "position_name", "rank_code", "rank_name",
			"cost_center_code", "monthly_standard_cost",
		}).AddRow("u1", "E001", "Alice", "active", "full_time", "D-NOW", "Current Dept", "POS-NOW", "Current Role", "P6", "Professional P6", "CC1", 0))

	mock.ExpectQuery(`(?s)SELECT \*.*FROM people_assignments.*is_primary = 1.*approval_status IN \('none', 'approved'\)`).
		WithArgs("u1", "2026-06-30", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "assignment_code", "employee_uid", "is_primary", "approval_status", "effective_from", "effective_to",
			"dept_code", "dept_name", "position_code", "position_name", "rank_code", "rank_name",
		}).
			AddRow(2, "ASN-REJECTED", "u1", 1, "rejected", "2026-06-15", nil, "D-BAD", "Rejected Dept", "POS-BAD", "Rejected Role", "P9", "Professional P9").
			AddRow(1, "ASN-APPROVED", "u1", 1, "approved", "2026-01-01", nil, "D-ASOF", "As-of Dept", "POS-ASOF", "As-of Role", "P7", "Professional P7"))

	mock.ExpectQuery(`(?s)SELECT \*.*FROM people_standard_cost_rates.*effective_from <= \?.*effective_to >= \?`).
		WithArgs("2026-06-30", "2026-06-01").
		WillReturnRows(sqlmock.NewRows([]string{
			"rate_code", "rank_code", "rank_name", "rank_series", "rank_level", "rank_salary",
			"performance_salary_min", "performance_salary_max", "currency", "effective_from", "effective_to",
		}).AddRow("RATE-P7", "P7", "Professional P7", "P", 7, 1000.0, 0.0, 0.0, "CNY", "2026-01-01", nil))

	mock.ExpectExec(`(?s)INSERT INTO people_cost_snapshots.*assignment_code.*dept_code_snapshot.*position_code_snapshot.*rank_code_snapshot`).
		WithArgs(
			stableCostSnapshotCode("2026-06", "u1"), "u1", "2026-06", 9000.0, 9000.0, "CNY", "standard_rate",
			"RATE-P7", "ASN-APPROVED", "D-ASOF", "As-of Dept", "POS-ASOF", "As-of Role", "P7", "Professional P7",
			"rank_standard_cost", "RATE-P7", sqlmock.AnyArg(), "operator-1", "operator-1",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE people_employees.*monthly_standard_cost = \?`).
		WithArgs(9000.0, "operator-1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.generateCostSnapshots(context.Background(), url.Values{}, map[string]any{
		"period_month":  "2026-06",
		"employee_uids": []any{"u1"},
		"operator_uid":  "operator-1",
		"cost_parameters": map[string]any{
			"code":                       "FIN-1",
			"base_salary":                8000.0,
			"welfare_cost_rate":          0.0,
			"management_allocation_rate": 0.0,
			"resource_allocation_cost":   0.0,
			"currency":                   "CNY",
		},
	})
	if err != nil {
		t.Fatalf("generateCostSnapshots: %v", err)
	}
	if generated := int(float64FromAny(result["generated"])); generated != 1 {
		t.Fatalf("expected one generated snapshot, got %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStandardCostRateMatchesNonPrefixRankCode(t *testing.T) {
	employee := map[string]any{
		"rank_code":        "DEMO-P3P4-202607-P6",
		"employment_type":  "full_time",
		"cost_center_code": "CC1",
	}
	rate := map[string]any{
		"rank_code":        "DEMO-P3P4-202607-P6",
		"rank_series":      "P",
		"employment_type":  "full_time",
		"cost_center_code": "CC1",
	}

	if !standardCostRateMatches(employee, rate) {
		t.Fatal("an exact rank_code must match regardless of its naming convention")
	}
}

func TestPeopleRuntimeRequiresRankSeriesColumn(t *testing.T) {
	for _, column := range requiredColumns {
		if column == "people_ranks.rank_series" {
			return
		}
	}
	t.Fatalf("people_ranks.rank_series missing from runtime readiness columns: %#v", requiredColumns)
}

func TestPeopleSchemaStatusRejectsPartiallyFinalizedRankSeries(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT c.COLUMN_TYPE.*FROM information_schema.COLUMNS`).
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "null_rows", "index_columns"}).
			AddRow("enum('M','P')", "YES", nil, 1, ""))
	status, err := adapter.SchemaStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "schema_mismatch" {
		t.Fatalf("status = %#v", status)
	}
	for _, expected := range []string{
		"people_ranks.rank_series.not_null",
		"people_ranks.rank_series.default_p",
		"people_ranks.idx_people_rank_series_level",
	} {
		if !slices.Contains(status.MissingColumns, expected) {
			t.Fatalf("missing readiness marker %q in %#v", expected, status.MissingColumns)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRankRuntimeReportsSchemaMismatchWhenSeriesColumnIsMissing(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	value := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("requiredColumns")
	reflect.NewAt(value.Type(), unsafe.Pointer(value.UnsafeAddr())).Elem().Set(reflect.ValueOf([]string{"people_ranks.rank_series"}))

	mock.ExpectQuery(`(?s)SELECT TABLE_NAME, COLUMN_NAME.*information_schema.COLUMNS`).
		WithArgs("people_ranks").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"}))
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/people/ranks", url.Values{}, nil)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "schema_mismatch" || operation != "people.ranks.schema" {
		t.Fatalf("expected stable schema mismatch, got operation=%q err=%#v", operation, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRankMutationNormalizesSeries(t *testing.T) {
	for _, testCase := range []struct {
		name string
		body map[string]any
		want string
	}{
		{name: "omitted uses database default", body: map[string]any{"rankName": "Engineer"}, want: ""},
		{name: "management", body: map[string]any{"rankName": "Manager", "rankSeries": "m"}, want: "M"},
		{name: "professional", body: map[string]any{"rankName": "Engineer", "rank_series": " P "}, want: "P"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateRankMutation(http.MethodPost, "/v1/people/ranks", testCase.body); err != nil {
				t.Fatalf("validateRankMutation: %v", err)
			}
			if got := cleanAnyString(testCase.body["rank_series"]); got != testCase.want {
				t.Fatalf("rank_series = %q, want %q", got, testCase.want)
			}
			if _, exists := testCase.body["rankSeries"]; exists {
				t.Fatal("camelCase rankSeries must be normalized to one canonical field")
			}
		})
	}
}

func TestValidateRankMutationRejectsInvalidSeriesAndCodeUpdate(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		method   string
		path     string
		body     map[string]any
		wantCode string
	}{
		{name: "invalid series", method: http.MethodPost, path: "/v1/people/ranks", body: map[string]any{"rankSeries": "X"}, wantCode: "people_rank_series_invalid"},
		{name: "non string series", method: http.MethodPatch, path: "/v1/people/ranks/P6", body: map[string]any{"rank_series": 1}, wantCode: "people_rank_series_invalid"},
		{name: "conflicting aliases", method: http.MethodPatch, path: "/v1/people/ranks/P6", body: map[string]any{"rank_series": "M", "rankSeries": "P"}, wantCode: "people_rank_series_conflict"},
		{name: "snake case code", method: http.MethodPatch, path: "/v1/people/ranks/P6", body: map[string]any{"rank_code": "P7"}, wantCode: "people_rank_code_immutable"},
		{name: "camel case code", method: http.MethodPut, path: "/v1/people/ranks/P6", body: map[string]any{"rankCode": "P7"}, wantCode: "people_rank_code_immutable"},
		{name: "pascal case code", method: http.MethodPatch, path: "/v1/people/ranks/P6", body: map[string]any{"RankCode": "P7"}, wantCode: "people_rank_code_immutable"},
		{name: "separator series", method: http.MethodPatch, path: "/v1/people/ranks/P6", body: map[string]any{"rank-series": "X"}, wantCode: "people_rank_series_invalid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateRankMutation(testCase.method, testCase.path, testCase.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != testCase.wantCode {
				t.Fatalf("expected %s bad request, got %#v", testCase.wantCode, err)
			}
		})
	}
}

func TestValidateRankMutationRejectsInvalidDictionaryFields(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		body     map[string]any
		wantCode string
	}{
		{name: "missing name", body: map[string]any{"rankCode": "P6"}, wantCode: "people_rank_name_invalid"},
		{name: "blank name", body: map[string]any{"rankName": "  "}, wantCode: "people_rank_name_invalid"},
		{name: "blank code", body: map[string]any{"rankCode": " ", "rankName": "Engineer"}, wantCode: "people_rank_code_invalid"},
		{name: "negative level", body: map[string]any{"rankName": "Engineer", "rankLevel": -1}, wantCode: "people_rank_level_invalid"},
		{name: "fractional order", body: map[string]any{"rankName": "Engineer", "sortOrder": 1.5}, wantCode: "people_rank_sort_order_invalid"},
		{name: "invalid enabled", body: map[string]any{"rankName": "Engineer", "enabled": 2}, wantCode: "people_rank_enabled_invalid"},
		{name: "level exceeds mysql int", body: map[string]any{"rankName": "Engineer", "rankLevel": int64(2147483648)}, wantCode: "people_rank_level_invalid"},
		{name: "huge decimal level", body: map[string]any{"rankName": "Engineer", "rankLevel": "999999999999999999999999"}, wantCode: "people_rank_level_invalid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateRankMutation(http.MethodPost, "/v1/people/ranks", testCase.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != testCase.wantCode {
				t.Fatalf("expected %s bad request, got %#v", testCase.wantCode, err)
			}
		})
	}
}

func TestGenericEmployeeMutationCannotBypassAssignmentRankValidation(t *testing.T) {
	for _, body := range []map[string]any{
		{"rank_code": "P7"},
		{"RankName": "专业 P7"},
		{"rank-code": "P7"},
	} {
		err := rejectGenericEmployeeRankMutation(http.MethodPatch, "/v1/people/employees/u1", body)
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "people_employee_rank_requires_assignment_change" {
			t.Fatalf("expected assignment-only rank mutation error, got %#v", err)
		}
	}
}

func TestGenericAssignmentMutationCannotBypassRankDictionary(t *testing.T) {
	testCases := []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{name: "post snake case rank", method: http.MethodPost, path: "/v1/people/assignments", body: map[string]any{"rank_code": "P7"}},
		{name: "post camel case rank", method: http.MethodPost, path: "/v1/people/assignments", body: map[string]any{"rankName": "专业 P7"}},
		{name: "patch alias rank", method: http.MethodPatch, path: "/v1/people/assignments/ASN-1", body: map[string]any{"rank-code": "P7"}},
		{name: "patch rank change type", method: http.MethodPatch, path: "/v1/people/assignments/ASN-1", body: map[string]any{"changeType": "rank_change"}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			err := rejectGenericAssignmentRankMutation(testCase.method, testCase.path, testCase.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "people_assignment_rank_requires_assignment_change" {
				t.Fatalf("expected assignment change-only rank error, got %#v", err)
			}
		})
	}

	if err := rejectGenericAssignmentRankMutation(
		http.MethodPost,
		peopleAssignmentChangePath,
		map[string]any{"change_type": "rank_change", "rank_code": "P7"},
	); err != nil {
		t.Fatalf("assignments:change must remain the authoritative rank write path, got %v", err)
	}
}

func TestEmployeeSearchBodyUsesArraysWithoutURLLengthLimits(t *testing.T) {
	value, err := peopleSearchBodyValue("dept_codes", []any{"D1", "D2", ""})
	if err != nil {
		t.Fatal(err)
	}
	if value != "D1,D2" {
		t.Fatalf("dept_codes = %q", value)
	}
	if _, err := peopleSearchBodyValue("dept_codes", strings.Repeat("D", 64*1024+1)); err == nil {
		t.Fatal("oversized employee search filters must be rejected")
	}
}

func TestEmployeeSearchHandleRuntimeUsesBodyFiltersAndRedactsSensitiveFields(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	configurePeopleEmployeeSearchAdapter(t, adapter)

	mock.ExpectQuery(`(?s)SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE.*information_schema.COLUMNS`).
		WithArgs("people_employees").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE"}).
			AddRow("id", "bigint", "NO").
			AddRow("employee_uid", "varchar", "NO").
			AddRow("display_name", "varchar", "NO").
			AddRow("employment_status", "varchar", "NO").
			AddRow("dept_code", "varchar", "YES").
			AddRow("rank_code", "varchar", "YES").
			AddRow("monthly_standard_cost", "decimal", "YES").
			AddRow("archived_at", "datetime", "YES"))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM .*people_employees.*dept_code.*IN.*employment_status`).
		WithArgs("D1", "D2", "active").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`SELECT \* FROM .*people_employees.*dept_code.*IN.*employment_status.*ORDER BY`).
		WithArgs("D1", "D2", "active", 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "employee_uid", "display_name", "employment_status", "dept_code", "rank_code", "monthly_standard_cost"}).
			AddRow(1, "u1", "Alice", "active", "D2", "P6", 1000))

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		peopleEmployeeSearchPath,
		url.Values{
			"current_user":                 []string{"operator-1"},
			"current_user_employee_access": []string{"all"},
			"current_user_data_access":     []string{"all"},
		},
		map[string]any{"page": 1, "page_size": 20, "employment_status": "active", "dept_codes": []any{"D1", "D2"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if operation != "people.employees.search" {
		t.Fatalf("operation = %q", operation)
	}
	envelope := response.(map[string]any)
	data := envelope["data"].(map[string]any)
	item := data["items"].([]map[string]any)[0]
	if _, exists := item["monthly_standard_cost"]; exists {
		t.Fatalf("search response leaked standard cost: %#v", item)
	}
	if _, exists := item["rank_code"]; exists {
		t.Fatalf("search response leaked rank without cost access: %#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEmployeeSearchHandleRuntimeRequiresEmployeeReadAccess(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, peopleEmployeeSearchPath, url.Values{}, map[string]any{})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || operation != "people.employees.access" {
		t.Fatalf("expected employee read denial before database access, got operation=%q err=%#v", operation, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeRejectsAlternateRankMutationAliasesBeforeDatabaseAccess(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	for _, body := range []map[string]any{
		{"RankCode": "P7"},
		{"RankSeries": "X"},
	} {
		_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPatch, "/v1/people/ranks/P6", url.Values{}, body)
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusBadRequest {
			t.Fatalf("expected bad request before generic CRUD, got operation=%q error=%#v", operation, err)
		}
		if operation != "people.ranks.write" {
			t.Fatalf("unexpected operation %q", operation)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("rank validation must run before database access: %v", err)
	}
}

func TestWorkflowApprovalRejectsOverlappingPrimaryAssignment(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT assignment_code, employee_uid, is_primary, effective_from, effective_to.*FROM people_assignments`).
		WithArgs("ASN-NEW", "ASN-NEW").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "employee_uid", "is_primary", "effective_from", "effective_to"}).
			AddRow("ASN-NEW", "u1", 1, "2026-07-01", nil))
	mock.ExpectQuery(`(?s)SELECT assignment_code.*FROM people_assignments.*assignment_code <> \?.*is_primary = 1`).
		WithArgs("u1", "ASN-NEW", "9999-12-31", "2026-07-01").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code"}).AddRow("ASN-OLD"))

	err := adapter.ensureWorkflowApprovalPrimaryAssignmentConflictFree(context.Background(), "ASN-NEW")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "people_primary_assignment_overlap" {
		t.Fatalf("expected primary assignment overlap conflict, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUnauthorizedAssignmentPostDoesNotQueryOverlap(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	for _, access := range []string{"none", "self"} {
		query := url.Values{}
		query.Set("current_user_employee_access", access)
		query.Set("current_user", "u1")
		_, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/people/assignments", query, map[string]any{
			"employee_uid":   "u1",
			"effective_from": "2026-07-01",
		})
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
			t.Fatalf("access=%s: expected authorization failure before overlap lookup, got %#v", access, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unauthorized request must not query the database: %v", err)
	}
}

func TestAuthorizedAssignmentPostWithoutCodeRejectsOverlap(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT assignment_code.*FROM people_assignments.*assignment_code <> \?.*is_primary = 1`).
		WithArgs("u1", sqlmock.AnyArg(), "9999-12-31", "2026-07-01").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code"}).AddRow("ASN-OLD"))

	query := url.Values{}
	query.Set("current_user_employee_access", "all")
	query.Set("current_user_data_access", "all")
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/people/assignments", query, map[string]any{
		"employee_uid":   "u1",
		"effective_from": "2026-07-01",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "people_primary_assignment_overlap" {
		t.Fatalf("expected overlapping assignment POST to fail, got operation=%q error=%#v", operation, err)
	}
	if operation != "people.assignments.primary_period.write" {
		t.Fatalf("unexpected operation %q", operation)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
