package compat

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestNormalizeBodyValueConvertsBlankNullableStringToNil(t *testing.T) {
	value := normalizeBodyValue("   ", columnInfo{Nullable: true})
	if value != nil {
		t.Fatalf("expected nullable blank string to normalize to nil, got %#v", value)
	}
}

func TestNormalizeBodyValueKeepsBlankRequiredString(t *testing.T) {
	value := normalizeBodyValue("   ", columnInfo{Nullable: false})
	if value != "   " {
		t.Fatalf("expected required blank string to be preserved, got %#v", value)
	}
}

func TestNormalizeBodyValueSerializesObject(t *testing.T) {
	value := normalizeBodyValue(map[string]any{"enabled": true}, columnInfo{DataType: "json", Nullable: true})
	text, ok := value.(string)
	if !ok {
		t.Fatalf("expected JSON object to normalize to string, got %#v", value)
	}

	var decoded map[string]bool
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		t.Fatalf("normalized JSON is invalid: %v", err)
	}
	if !decoded["enabled"] {
		t.Fatalf("expected normalized JSON to include enabled=true, got %s", text)
	}
}

func TestShouldSkipCreateColumnAllowsExplicitUuidIDColumn(t *testing.T) {
	columns := map[string]columnInfo{
		"id":   {},
		"uuid": {},
	}

	if shouldSkipCreateColumn(columns, "uuid", "uuid") {
		t.Fatal("expected uuid IDColumn to be writable on create")
	}
}

func TestShouldSkipCreateColumnSkipsAutoIncrementID(t *testing.T) {
	columns := map[string]columnInfo{
		"id":   {},
		"uuid": {},
	}

	if !shouldSkipCreateColumn(columns, "id", "id") {
		t.Fatal("expected id IDColumn to be skipped on create")
	}
}

func TestRuntimeActorHasAdminScopeSupportsAppAdminForms(t *testing.T) {
	cases := [][]string{
		{"*"},
		{"altoc.*"},
		{"altoc.admin"},
		{"altoc:opportunity:admin"},
		{"altoc:admin:admin"},
	}
	for _, scopes := range cases {
		if !runtimeActorHasAdminScope("altoc", "opportunity", scopes) {
			t.Fatalf("expected scopes %v to grant admin access", scopes)
		}
	}
}

func TestRuntimeActorHasAdminScopeRejectsOwnerEditScope(t *testing.T) {
	if runtimeActorHasAdminScope("altoc", "opportunity", []string{"altoc.write", "altoc:opportunity:edit"}) {
		t.Fatal("expected edit/write scopes not to grant owner-bypass admin access")
	}
}

func TestResourceScopeNameSingularizesRuntimeResourcePath(t *testing.T) {
	cases := map[string]string{
		"leads":                   "lead",
		"opportunities":           "opportunity",
		"quotes":                  "quotation",
		"renewal-opportunities":   "renewal_opportunity",
		"customers/{id}/contacts": "customer",
	}
	for path, expected := range cases {
		if actual := resourceScopeName(path); actual != expected {
			t.Fatalf("resourceScopeName(%q) = %q, expected %q", path, actual, expected)
		}
	}
}

func TestScopeStringsNormalizesStringAndSliceValues(t *testing.T) {
	fromString := scopeStrings("altoc.write altoc:opportunity:admin")
	if len(fromString) != 2 || fromString[1] != "altoc:opportunity:admin" {
		t.Fatalf("unexpected string scopes: %#v", fromString)
	}

	fromAny := scopeStrings([]any{"altoc.write", " altoc.admin "})
	if len(fromAny) != 2 || fromAny[1] != "altoc.admin" {
		t.Fatalf("unexpected []any scopes: %#v", fromAny)
	}
}

func TestRuntimeActorDeptCodesParsesAliasesAndDedupes(t *testing.T) {
	query := url.Values{}
	query.Add("current_user_dept_codes", "D1,D2")
	query.Add("currentUserDeptCode", "D2")
	body := map[string]any{
		"current_user_department_codes": []any{"D3", " D1 "},
	}

	actual := runtimeActorDeptCodes(query, body)
	expected := []string{"D3", "D1", "D2"}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("runtimeActorDeptCodes() = %#v, expected %#v", actual, expected)
	}
}

func TestReadScopeWhereAddsOwnerAndDepartmentFilter(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")

	where, args, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path:             "opportunities",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
		},
	}, map[string]columnInfo{
		"owner_user_id":   {},
		"owner_dept_code": {},
	}, query, nil)
	if err != nil {
		t.Fatalf("readScopeWhere returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(`owner_user_id` = ? OR `owner_dept_code` IN (?,?))" {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestReadScopeWhereSkipsFilterForAdminScope(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc:opportunity:admin")

	where, args, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path:        "opportunities",
			OwnerColumn: "owner_user_id",
		},
	}, map[string]columnInfo{
		"owner_user_id": {},
	}, query, nil)
	if err != nil {
		t.Fatalf("readScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected admin scope to skip read filter, got where=%#v args=%#v", where, args)
	}
}

func TestReadScopeWhereAppliesDataAccessModes(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	columns := map[string]columnInfo{
		"owner_user_id":   {},
		"owner_dept_code": {},
	}
	match := resourceMatch{
		spec: ResourceSpec{
			Path:             "opportunities",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
		},
	}

	allQuery := url.Values{}
	allQuery.Set("current_user", "manager")
	allQuery.Set("current_user_data_access", "all")
	where, args, err := adapter.readScopeWhere(match, columns, allQuery, nil)
	if err != nil {
		t.Fatalf("all data access returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected all data access to skip filter, got where=%#v args=%#v", where, args)
	}

	selfQuery := url.Values{}
	selfQuery.Set("current_user", "u1")
	selfQuery.Set("current_user_data_access", "self")
	selfQuery.Set("current_user_dept_codes", "D1,D2")
	where, args, err = adapter.readScopeWhere(match, columns, selfQuery, nil)
	if err != nil {
		t.Fatalf("self data access returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(`owner_user_id` = ?)" {
		t.Fatalf("unexpected self where %#v", where)
	}
	if !reflect.DeepEqual(args, []any{"u1"}) {
		t.Fatalf("unexpected self args %#v", args)
	}

	deptQuery := url.Values{}
	deptQuery.Set("current_user", "u1")
	deptQuery.Set("current_user_data_access", "dept")
	deptQuery.Set("current_user_dept_codes", "D1,D2")
	deptQuery.Set("current_user_data_dept_codes", "D3,D4")
	where, args, err = adapter.readScopeWhere(match, columns, deptQuery, nil)
	if err != nil {
		t.Fatalf("dept data access returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(`owner_user_id` = ? OR `owner_dept_code` IN (?,?))" {
		t.Fatalf("unexpected dept where %#v", where)
	}
	if !reflect.DeepEqual(args, []any{"u1", "D3", "D4"}) {
		t.Fatalf("unexpected dept args %#v", args)
	}

	noneQuery := url.Values{}
	noneQuery.Set("current_user", "u1")
	noneQuery.Set("current_user_data_access", "none")
	_, _, err = adapter.readScopeWhere(match, columns, noneQuery, nil)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "data_scope_denied" {
		t.Fatalf("expected data_scope_denied 403, got %#v", err)
	}
}

func TestReadScopeWhereAddsParentScopeFilter(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")

	where, args, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path: "service-entitlements",
			ParentScope: &ParentScopeSpec{
				Table:            "maintenance_contract",
				LocalColumn:      "maintenance_contract_id",
				Resource:         "maintenance_contract",
				OwnerColumn:      "owner_user_id",
				DepartmentColumn: "owner_dept_code",
				SoftDeleteColumn: "deleted_at",
			},
		},
	}, map[string]columnInfo{
		"maintenance_contract_id": {},
	}, query, nil)
	if err != nil {
		t.Fatalf("readScopeWhere returned error: %v", err)
	}
	expectedWhere := "(EXISTS (SELECT 1 FROM `maintenance_contract` scope_parent WHERE scope_parent.`id` = `maintenance_contract_id` AND scope_parent.`deleted_at` IS NULL AND (scope_parent.`owner_user_id` = ? OR scope_parent.`owner_dept_code` IN (?,?))))"
	if len(where) != 1 || where[0] != expectedWhere {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestReadScopeWhereSkipsParentFilterForParentAdminScope(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc:maintenance_contract:admin")

	where, args, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path: "service-entitlements",
			ParentScope: &ParentScopeSpec{
				Table:       "maintenance_contract",
				LocalColumn: "maintenance_contract_id",
				Resource:    "maintenance_contract",
				OwnerColumn: "owner_user_id",
			},
		},
	}, map[string]columnInfo{
		"maintenance_contract_id": {},
	}, query, nil)
	if err != nil {
		t.Fatalf("readScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected parent admin scope to skip read filter, got where=%#v args=%#v", where, args)
	}
}

func TestReadScopeWhereRejectsParentScopeMissingLocalColumn(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	query := url.Values{}
	query.Set("current_user", "u1")

	_, _, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path: "service-entitlements",
			ParentScope: &ParentScopeSpec{
				Table:       "maintenance_contract",
				LocalColumn: "maintenance_contract_id",
				Resource:    "maintenance_contract",
				OwnerColumn: "owner_user_id",
			},
		},
	}, map[string]columnInfo{}, query, nil)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusInternalServerError || httpErr.Code != "schema_mismatch" {
		t.Fatalf("expected schema_mismatch 500, got %#v", err)
	}
}

func TestReadScopeWhereRequiresCurrentUser(t *testing.T) {
	adapter := &Adapter{appCode: "altoc"}
	_, _, err := adapter.readScopeWhere(resourceMatch{
		spec: ResourceSpec{
			Path:        "leads",
			OwnerColumn: "owner_user_id",
		},
	}, map[string]columnInfo{
		"owner_user_id": {},
	}, url.Values{}, nil)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusUnauthorized || httpErr.Code != "missing_current_user" {
		t.Fatalf("expected missing_current_user 401, got %#v", err)
	}
}

func TestRuntimeActorCanWriteScopedRecordAllowsOwner(t *testing.T) {
	allowed := runtimeActorCanWriteScopedRecord(
		"u1",
		nil,
		sql.NullString{String: "u1", Valid: true},
		true,
		sql.NullString{},
		false,
	)
	if !allowed {
		t.Fatal("expected owner to allow scoped write")
	}
}

func TestRuntimeActorCanWriteScopedRecordAllowsDepartment(t *testing.T) {
	allowed := runtimeActorCanWriteScopedRecord(
		"u1",
		[]string{"D1", "D2"},
		sql.NullString{String: "u2", Valid: true},
		true,
		sql.NullString{String: "D2", Valid: true},
		true,
	)
	if !allowed {
		t.Fatal("expected matching department to allow scoped write")
	}
}

func TestRuntimeActorCanWriteScopedRecordAllowsUnscopedRecord(t *testing.T) {
	allowed := runtimeActorCanWriteScopedRecord(
		"u1",
		[]string{"D1"},
		sql.NullString{},
		true,
		sql.NullString{String: " ", Valid: true},
		true,
	)
	if !allowed {
		t.Fatal("expected blank owner and department to preserve unscoped write compatibility")
	}
}

func TestRuntimeActorCanWriteScopedRecordRejectsOutOfScope(t *testing.T) {
	allowed := runtimeActorCanWriteScopedRecord(
		"u1",
		[]string{"D1"},
		sql.NullString{String: "u2", Valid: true},
		true,
		sql.NullString{String: "D2", Valid: true},
		true,
	)
	if allowed {
		t.Fatal("expected non-owner and non-department actor to be rejected")
	}
}

func TestApplyRuntimeScopeCreateDefaultsFillsOwnerAndDepartment(t *testing.T) {
	fields := map[string]any{"name": "new lead"}
	applyRuntimeScopeCreateDefaults(fields, ResourceSpec{
		OwnerColumn:      "owner_user_id",
		DepartmentColumn: "owner_dept_code",
	}, map[string]columnInfo{
		"owner_user_id":   {},
		"owner_dept_code": {},
	}, "u1", []string{"D1", "D2"})

	if fields["owner_user_id"] != "u1" {
		t.Fatalf("owner_user_id = %#v, want u1", fields["owner_user_id"])
	}
	if fields["owner_dept_code"] != "D1" {
		t.Fatalf("owner_dept_code = %#v, want D1", fields["owner_dept_code"])
	}
}

func TestApplyRuntimeScopeCreateDefaultsKeepsExplicitOwnerAndDepartment(t *testing.T) {
	fields := map[string]any{
		"owner_user_id":   "explicit-owner",
		"owner_dept_code": "explicit-dept",
	}
	applyRuntimeScopeCreateDefaults(fields, ResourceSpec{
		OwnerColumn:      "owner_user_id",
		DepartmentColumn: "owner_dept_code",
	}, map[string]columnInfo{
		"owner_user_id":   {},
		"owner_dept_code": {},
	}, "u1", []string{"D1"})

	if fields["owner_user_id"] != "explicit-owner" {
		t.Fatalf("owner_user_id = %#v, want explicit-owner", fields["owner_user_id"])
	}
	if fields["owner_dept_code"] != "explicit-dept" {
		t.Fatalf("owner_dept_code = %#v, want explicit-dept", fields["owner_dept_code"])
	}
}

func TestApplyRuntimeScopeCreateDefaultsTreatsBlankAsMissing(t *testing.T) {
	fields := map[string]any{
		"owner_user_id":   " ",
		"owner_dept_code": nil,
	}
	applyRuntimeScopeCreateDefaults(fields, ResourceSpec{
		OwnerColumn:      "owner_user_id",
		DepartmentColumn: "owner_dept_code",
	}, map[string]columnInfo{
		"owner_user_id":   {},
		"owner_dept_code": {},
	}, "u1", []string{"D1"})

	if fields["owner_user_id"] != "u1" {
		t.Fatalf("owner_user_id = %#v, want u1", fields["owner_user_id"])
	}
	if fields["owner_dept_code"] != "D1" {
		t.Fatalf("owner_dept_code = %#v, want D1", fields["owner_dept_code"])
	}
}
