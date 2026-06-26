package altoc

import (
	"net/http"
	"net/url"
	"reflect"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAltocRequireOwnerWriteAllowsOwner(t *testing.T) {
	err := altocRequireOwnerWrite(map[string]any{
		"current_user": "u1",
	}, "opportunity", "u1")
	if err != nil {
		t.Fatalf("expected owner write to pass, got %v", err)
	}
}

func TestAltocRequireOwnerWriteRejectsNonOwner(t *testing.T) {
	err := altocRequireOwnerWrite(map[string]any{
		"current_user": "u2",
	}, "opportunity", "u1")
	if err == nil {
		t.Fatal("expected non-owner write to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "owner_scope_required" {
		t.Fatalf("expected owner_scope_required 403, got %#v", err)
	}
}

func TestAltocRequireOwnerWriteAllowsResourceAdmin(t *testing.T) {
	err := altocRequireOwnerWrite(map[string]any{
		"current_user":        "manager",
		"current_user_scopes": []any{"altoc:opportunity:admin"},
	}, "opportunity", "u1")
	if err != nil {
		t.Fatalf("expected opportunity admin to pass, got %v", err)
	}
}

func TestAltocRequireRecordWriteAllowsOwner(t *testing.T) {
	err := altocRequireRecordWrite(
		map[string]any{"current_user": "u1"},
		"opportunity",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D1"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("expected owner write to pass, got %v", err)
	}
}

func TestAltocRequireRecordWriteAllowsDepartmentScope(t *testing.T) {
	err := altocRequireRecordWrite(
		map[string]any{"current_user": "u2", "current_user_dept_codes": []string{"D1", "D2"}},
		"opportunity",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("expected department-scoped write to pass, got %v", err)
	}
}

func TestAltocRequireRecordWriteRejectsOutOfScopeUser(t *testing.T) {
	err := altocRequireRecordWrite(
		map[string]any{"current_user": "u2", "current_user_dept_codes": []string{"D3"}},
		"opportunity",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err == nil {
		t.Fatal("expected out-of-scope write to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "write_scope_required" {
		t.Fatalf("expected write_scope_required 403, got %#v", err)
	}
}

func TestAltocRequireRecordWriteAllowsResourceAdmin(t *testing.T) {
	err := altocRequireRecordWrite(
		map[string]any{"current_user": "manager", "current_user_scopes": []string{"altoc:opportunity:admin"}},
		"opportunity",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("expected resource admin write to pass, got %v", err)
	}
}

func TestAltocRequireRecordWriteHonorsExplicitDataAccessBeforeAdminScope(t *testing.T) {
	err := altocRequireRecordWrite(
		map[string]any{
			"current_user":             "manager",
			"current_user_scopes":      []string{"altoc:opportunity:admin"},
			"current_user_data_access": "self",
		},
		"opportunity",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err == nil {
		t.Fatal("expected scoped admin to respect explicit self data access")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "write_scope_required" {
		t.Fatalf("expected write_scope_required 403, got %#v", err)
	}
}

func TestAltocRequireRecordWriteAppliesDataAccessModes(t *testing.T) {
	record := map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"}

	if err := altocRequireRecordWrite(
		map[string]any{"current_user": "manager", "current_user_data_access": "all"},
		"opportunity",
		record,
		"owner_user_id",
		"owner_dept_code",
	); err != nil {
		t.Fatalf("expected all data access write to pass, got %v", err)
	}

	err := altocRequireRecordWrite(
		map[string]any{"current_user": "u2", "current_user_data_access": "self", "current_user_dept_codes": []string{"D2"}},
		"opportunity",
		record,
		"owner_user_id",
		"owner_dept_code",
	)
	if err == nil {
		t.Fatal("expected self data access to reject department-only match")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "write_scope_required" {
		t.Fatalf("expected write_scope_required 403, got %#v", err)
	}

	if err := altocRequireRecordWrite(
		map[string]any{
			"current_user":                 "u2",
			"current_user_data_access":     "dept",
			"current_user_data_dept_codes": []string{"D2"},
			"current_user_dept_codes":      []string{"D9"},
		},
		"opportunity",
		record,
		"owner_user_id",
		"owner_dept_code",
	); err != nil {
		t.Fatalf("expected explicit dept data access write to pass, got %v", err)
	}

	err = altocRequireRecordWrite(
		map[string]any{"current_user": "u1", "current_user_data_access": "none"},
		"opportunity",
		record,
		"owner_user_id",
		"owner_dept_code",
	)
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "data_scope_denied" {
		t.Fatalf("expected data_scope_denied 403, got %#v", err)
	}
}

func TestAltocRequireActionScopeAllowsLocalBodiesWithoutScopes(t *testing.T) {
	if err := altocRequireActionScope(map[string]any{"current_user": "u1"}, "lead", "convert"); err != nil {
		t.Fatalf("expected local body without scopes to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsExactAction(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"altoc:lead:convert"}},
		"lead",
		"convert",
	)
	if err != nil {
		t.Fatalf("expected exact action scope to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsAudiencePrefixedExactAction(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"tenant-runtime:altoc:opportunity:view"}},
		"opportunity",
		"view",
	)
	if err != nil {
		t.Fatalf("expected audience-prefixed exact action scope to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsEditForCrudCreate(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"altoc:lead:edit"}},
		"lead",
		"create",
	)
	if err != nil {
		t.Fatalf("expected edit scope to cover CRUD create, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsEditForView(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"altoc:opportunity:edit"}},
		"opportunity",
		"view",
	)
	if err != nil {
		t.Fatalf("expected edit scope to cover view, got %v", err)
	}
}

func TestAltocRequireActionScopeRejectsEditForDomainActions(t *testing.T) {
	for _, tc := range []struct {
		name     string
		resource string
		action   string
		scope    string
	}{
		{name: "lead convert", resource: "lead", action: "convert", scope: "altoc:lead:edit"},
		{name: "lead assign", resource: "lead", action: "assign", scope: "altoc:lead:edit"},
		{name: "lead disqualify", resource: "lead", action: "disqualify", scope: "altoc:lead:edit"},
		{name: "lead activity", resource: "lead", action: "activity", scope: "altoc:lead:edit"},
		{name: "opportunity assign", resource: "opportunity", action: "assign", scope: "altoc:opportunity:edit"},
		{name: "opportunity transition", resource: "opportunity", action: "transition", scope: "altoc:opportunity:edit"},
		{name: "opportunity activity", resource: "opportunity", action: "activity", scope: "altoc:opportunity:edit"},
		{name: "quotation approve", resource: "quotation", action: "approve", scope: "altoc:quotation:edit"},
		{name: "contract admin", resource: "contract", action: "admin", scope: "altoc:contract:edit"},
		{name: "contract finance sync", resource: "contract", action: "finance-summary:sync", scope: "altoc:contract:edit"},
		{name: "receivable confirm", resource: "receivable", action: "confirm", scope: "altoc:receivable:edit"},
		{name: "receivable mark billable", resource: "receivable", action: "mark-billable", scope: "altoc:receivable:edit"},
		{name: "service ticket delivery sync", resource: "service_ticket", action: "delivery-result:sync", scope: "altoc:service_ticket:edit"},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			err := altocRequireActionScope(
				map[string]any{"current_user": "u1", "current_user_scopes": []string{tc.scope}},
				tc.resource,
				tc.action,
			)
			if err == nil {
				t.Fatalf("expected %s not to cover %s:%s", tc.scope, tc.resource, tc.action)
			}
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
				t.Fatalf("expected permission_scope_required 403, got %#v", err)
			}
		})
	}
}

func TestAltocRequireActionScopeRejectsBroadTransportScopeOnly(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"altoc.write"}},
		"lead",
		"convert",
	)
	if err == nil {
		t.Fatal("expected broad transport scope without resource action to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestAltocRequireActionScopeRejectsAudiencePrefixedBroadTransportScopeOnly(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"tenant-runtime:altoc:write"}},
		"lead",
		"convert",
	)
	if err == nil {
		t.Fatal("expected audience-prefixed broad transport scope without resource action to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestAltocRequireActionScopeAllowsResourceAdmin(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "manager", "current_user_scopes": []string{"altoc:lead:admin"}},
		"lead",
		"convert",
	)
	if err != nil {
		t.Fatalf("expected resource admin to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsAudiencePrefixedResourceAdmin(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "manager", "current_user_scopes": []string{"tenant-runtime:altoc:lead:admin"}},
		"lead",
		"convert",
	)
	if err != nil {
		t.Fatalf("expected audience-prefixed resource admin to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsConfirmAction(t *testing.T) {
	err := altocRequireActionScope(
		map[string]any{"current_user": "u1", "current_user_scopes": []string{"altoc:receivable:confirm"}},
		"receivable",
		"confirm",
	)
	if err != nil {
		t.Fatalf("expected confirm action scope to pass, got %v", err)
	}
}

func TestAltocRequireActionScopeAllowsServiceCommandActions(t *testing.T) {
	for _, tc := range []struct {
		name     string
		resource string
		action   string
		scope    string
	}{
		{name: "receivable mark billable", resource: "receivable", action: "mark-billable", scope: "altoc:receivable:mark-billable"},
		{name: "contract finance summary sync", resource: "contract", action: "finance-summary:sync", scope: "altoc:contract:finance-summary:sync"},
		{name: "contract delivery asset status sync", resource: "contract", action: "delivery-asset-status:sync", scope: "altoc:contract:delivery-asset-status:sync"},
		{name: "service ticket delivery result sync", resource: "service_ticket", action: "delivery-result:sync", scope: "altoc:service_ticket:delivery-result:sync"},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			err := altocRequireActionScope(
				map[string]any{"current_user": "service-client", "current_user_scopes": []string{tc.scope}},
				tc.resource,
				tc.action,
			)
			if err != nil {
				t.Fatalf("expected %s to allow %s:%s, got %v", tc.scope, tc.resource, tc.action, err)
			}
		})
	}
}

func TestAltocActorHasAdminScopeSupportsAppAdmin(t *testing.T) {
	if !altocActorHasAdminScope(map[string]any{
		"current_user_scopes": []string{"altoc.admin"},
	}, "lead") {
		t.Fatal("expected altoc.admin to grant admin access")
	}
}

func TestAltocActorHasAdminScopeSupportsAudiencePrefixedAppAdmin(t *testing.T) {
	if !altocActorHasAdminScope(map[string]any{
		"current_user_scopes": []string{"tenant-runtime:altoc:admin"},
	}, "lead") {
		t.Fatal("expected audience-prefixed altoc admin to grant admin access")
	}
	if !altocActorHasAdminScope(map[string]any{
		"current_user_scopes": []string{"tenant-runtime:altoc:*"},
	}, "lead") {
		t.Fatal("expected audience-prefixed altoc wildcard to grant admin access")
	}
}

func TestAltocNormalizeDuplicateMatchFields(t *testing.T) {
	if actual := altocNormalizeEntityName(" 汇智云 （上海） "); actual != "汇智云(上海)" {
		t.Fatalf("unexpected normalized name %q", actual)
	}
	if actual := altocNormalizeMobile("+86 138-0000-0000"); actual != "8613800000000" {
		t.Fatalf("unexpected normalized mobile %q", actual)
	}
	if actual := altocNormalizeEmail(" User@Example.COM "); actual != "user@example.com" {
		t.Fatalf("unexpected normalized email %q", actual)
	}
	if actual := altocNormalizeDomain("https://www.example.com/path"); actual != "example.com" {
		t.Fatalf("unexpected normalized domain %q", actual)
	}
}

func TestAltocRuntimeBodyFromQuery(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read altoc:lead:admin")
	query.Set("current_user_dept_codes", "D1,D2")
	body := altocRuntimeBodyFromQuery(query)
	if body["current_user"] != "u1" {
		t.Fatalf("unexpected current_user %#v", body["current_user"])
	}
	scopes, ok := body["current_user_scopes"].([]string)
	if !ok || len(scopes) != 2 || scopes[1] != "altoc:lead:admin" {
		t.Fatalf("unexpected scopes %#v", body["current_user_scopes"])
	}
	if body["current_user_dept_codes"] != "D1,D2" {
		t.Fatalf("unexpected current_user_dept_codes %#v", body["current_user_dept_codes"])
	}
	if got := altocActorDeptCode(body); got != "D1" {
		t.Fatalf("unexpected actor dept code %q", got)
	}
}

func TestAltocRuntimeBodyFromRequestMergesBodyAuthContext(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "query-user")
	body := altocRuntimeBodyFromRequest(query, map[string]any{
		"current_user":            "body-user",
		"current_user_scopes":     []string{"altoc:customer:admin"},
		"current_user_dept_codes": []any{"D1", "D2"},
	})
	if body["current_user"] != "body-user" {
		t.Fatalf("unexpected current_user %#v", body["current_user"])
	}
	if !altocActorHasAdminScope(body, "customer") {
		t.Fatal("expected merged body scopes to grant customer admin")
	}
	if got := altocActorDeptCodes(body); !reflect.DeepEqual(got, []string{"D1", "D2"}) {
		t.Fatalf("unexpected dept codes %#v", got)
	}
}

func TestAltocCommandBodyFromRequestKeepsBusinessFieldsAndQueryDataScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "query-user")
	query.Set("current_user_data_access", "dept")
	query.Set("current_user_data_dept_codes", "D1,D2")

	body := altocCommandBodyFromRequest(query, map[string]any{
		"current_user":  "body-user",
		"owner_user_id": "assignee",
		"staleDays":     14,
	})
	if body["owner_user_id"] != "assignee" || body["staleDays"] != 14 {
		t.Fatalf("expected business fields to be preserved, got %#v", body)
	}
	if body["current_user"] != "body-user" {
		t.Fatalf("expected trusted body actor to win, got %#v", body["current_user"])
	}
	if body["current_user_data_access"] != "dept" || body["current_user_data_dept_codes"] != "D1,D2" {
		t.Fatalf("expected query data scope to be merged, got %#v", body)
	}
}

func TestAltocReadScopeWhereAddsOwnerAndDepartmentFilter(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")

	where, args, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		t.Fatalf("altocReadScopeWhere returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(op.owner_user_id = ? OR op.owner_dept_code IN (?,?))" {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestAltocReadScopeWhereSkipsAdmin(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc.admin")

	where, args, err := altocReadScopeWhere(query, "lead", "", "owner_user_id", "owner_dept_code")
	if err != nil {
		t.Fatalf("altocReadScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected admin scope to skip read filter, got where=%#v args=%#v", where, args)
	}
}

func TestAltocReadScopeWhereAppliesDataAccessModes(t *testing.T) {
	allQuery := url.Values{}
	allQuery.Set("current_user", "manager")
	allQuery.Set("current_user_data_access", "all")

	where, args, err := altocReadScopeWhere(allQuery, "opportunity", "op", "owner_user_id", "owner_dept_code")
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
	where, args, err = altocReadScopeWhere(selfQuery, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		t.Fatalf("self data access returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(op.owner_user_id = ?)" {
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
	where, args, err = altocReadScopeWhere(deptQuery, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		t.Fatalf("dept data access returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(op.owner_user_id = ? OR op.owner_dept_code IN (?,?))" {
		t.Fatalf("unexpected dept where %#v", where)
	}
	if !reflect.DeepEqual(args, []any{"u1", "D3", "D4"}) {
		t.Fatalf("unexpected dept args %#v", args)
	}

	noneQuery := url.Values{}
	noneQuery.Set("current_user", "u1")
	noneQuery.Set("current_user_data_access", "none")
	_, _, err = altocReadScopeWhere(noneQuery, "opportunity", "op", "owner_user_id", "owner_dept_code")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "data_scope_denied" {
		t.Fatalf("expected data_scope_denied 403, got %#v", err)
	}
}

func TestAltocReceivablePlanReadScopeWhereIncludesPlanAndContractScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")

	where, args, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		t.Fatalf("altocReceivablePlanReadScopeWhere returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(rp.owner_user_id = ? OR ct.owner_user_id = ? OR ct.owner_dept_code IN (?, ?))" {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"u1", "u1", "D1", "D2"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestAltocReceivablePlanReadScopeWhereSkipsPaymentAdmin(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc:payment:admin")

	where, args, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		t.Fatalf("altocReceivablePlanReadScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected admin scope to skip receivable plan filter, got where=%#v args=%#v", where, args)
	}
}

func TestAltocReceivablePlanReadScopeWhereSkipsReceivableAdmin(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc:receivable:admin")

	where, args, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		t.Fatalf("altocReceivablePlanReadScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected receivable admin scope to skip receivable plan filter, got where=%#v args=%#v", where, args)
	}
}

func TestAltocRecordMatchesReadScopeAllowsOwner(t *testing.T) {
	allowed, err := altocRecordMatchesReadScope(
		map[string]any{"current_user": "u1"},
		"customer",
		map[string]any{"owner_user_id": "u1", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("altocRecordMatchesReadScope returned error: %v", err)
	}
	if !allowed {
		t.Fatal("expected owner to match read scope")
	}
}

func TestAltocRecordMatchesReadScopeAllowsDepartment(t *testing.T) {
	allowed, err := altocRecordMatchesReadScope(
		map[string]any{"current_user": "u1", "current_user_dept_codes": "D1,D2"},
		"customer",
		map[string]any{"owner_user_id": "u2", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("altocRecordMatchesReadScope returned error: %v", err)
	}
	if !allowed {
		t.Fatal("expected department to match read scope")
	}
}

func TestAltocRecordMatchesReadScopeRejectsOtherOwnerAndDepartment(t *testing.T) {
	allowed, err := altocRecordMatchesReadScope(
		map[string]any{"current_user": "u1", "current_user_dept_codes": "D1"},
		"customer",
		map[string]any{"owner_user_id": "u2", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("altocRecordMatchesReadScope returned error: %v", err)
	}
	if allowed {
		t.Fatal("expected other owner and department to be rejected")
	}
}

func TestAltocRecordMatchesReadScopeAllowsAdmin(t *testing.T) {
	allowed, err := altocRecordMatchesReadScope(
		map[string]any{"current_user_scopes": []string{"altoc:customer:admin"}},
		"customer",
		map[string]any{"owner_user_id": "u2", "owner_dept_code": "D2"},
		"owner_user_id",
		"owner_dept_code",
	)
	if err != nil {
		t.Fatalf("altocRecordMatchesReadScope returned error: %v", err)
	}
	if !allowed {
		t.Fatal("expected admin to match read scope")
	}
}

func TestAltocContactCandidateScopeWhereIncludesContactAndCustomerOwnership(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")

	where, args, err := altocContactCandidateScopeWhere(
		query,
		map[string]bool{"owner_user_id": true},
		map[string]bool{"owner_user_id": true, "owner_dept_code": true},
	)
	if err != nil {
		t.Fatalf("altocContactCandidateScopeWhere returned error: %v", err)
	}
	if len(where) != 1 || where[0] != "(ct.owner_user_id = ? OR cu.owner_user_id = ? OR cu.owner_dept_code IN (?, ?))" {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"u1", "u1", "D1", "D2"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestAltocContactCandidateScopeWhereSkipsCustomerAdmin(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "manager")
	query.Set("current_user_scopes", "altoc:customer:admin")

	where, args, err := altocContactCandidateScopeWhere(
		query,
		map[string]bool{"owner_user_id": true},
		map[string]bool{"owner_user_id": true, "owner_dept_code": true},
	)
	if err != nil {
		t.Fatalf("altocContactCandidateScopeWhere returned error: %v", err)
	}
	if len(where) != 0 || len(args) != 0 {
		t.Fatalf("expected admin scope to skip contact candidate filter, got where=%#v args=%#v", where, args)
	}
}

func TestSalesTaskDuplicateWhereBuildsOpenTaskFilter(t *testing.T) {
	where, args, ok := salesTaskDuplicateWhere(map[string]bool{
		"related_type":     true,
		"related_id":       true,
		"name":             true,
		"assignee_user_id": true,
		"due_at":           true,
		"status":           true,
		"deleted_at":       true,
	}, " opportunity ", int64(10), " 约方案会 ", "2026-06-25 00:00:00", " u1 ")
	if !ok {
		t.Fatal("expected duplicate filter to be available")
	}
	expectedWhere := []string{
		"related_type = ?",
		"related_id = ?",
		"name = ?",
		"assignee_user_id = ?",
		"due_at <=> ?",
		"(status IS NULL OR status IN ('todo', 'doing', 'overdue'))",
		"deleted_at IS NULL",
	}
	if !reflect.DeepEqual(where, expectedWhere) {
		t.Fatalf("unexpected where %#v", where)
	}
	expectedArgs := []any{"opportunity", int64(10), "约方案会", "u1", "2026-06-25 00:00:00"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args %#v", args)
	}
}

func TestSalesTaskDuplicateWhereSkipsWhenRequiredColumnsMissing(t *testing.T) {
	where, args, ok := salesTaskDuplicateWhere(map[string]bool{
		"related_type": true,
		"related_id":   true,
		"name":         true,
	}, "opportunity", int64(10), "约方案会", nil, "u1")
	if ok || where != nil || args != nil {
		t.Fatalf("expected missing assignee column to skip duplicate filter, got ok=%v where=%#v args=%#v", ok, where, args)
	}
}

func TestSalesTaskDuplicateWhereSkipsBlankOrMissingEntity(t *testing.T) {
	columns := map[string]bool{
		"related_type":     true,
		"related_id":       true,
		"name":             true,
		"assignee_user_id": true,
	}

	if _, _, ok := salesTaskDuplicateWhere(columns, "opportunity", nil, "约方案会", nil, "u1"); ok {
		t.Fatal("expected missing related id to skip duplicate filter")
	}
	if _, _, ok := salesTaskDuplicateWhere(columns, "opportunity", int64(10), " ", nil, "u1"); ok {
		t.Fatal("expected blank task name to skip duplicate filter")
	}
}
