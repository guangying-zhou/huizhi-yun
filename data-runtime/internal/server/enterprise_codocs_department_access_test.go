package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestEnterpriseCodocsDepartmentAccessRouteExact(t *testing.T) {
	want := map[string]struct{ target, permit, method string }{
		"department-access:resolve":          {"", "read", http.MethodGet},
		"department-documents:list":          {"/v1/codocs/documents", "read", http.MethodGet},
		"department-documents:trash":         {"/v1/codocs/documents/trash", "read", http.MethodGet},
		"department-documents:create":        {"/v1/codocs/documents", "create", http.MethodPost},
		"department-documents:view":          {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007", "read", http.MethodGet},
		"department-documents:download":      {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007", "export", http.MethodGet},
		"department-documents:readonly":      {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007", "edit", http.MethodPatch},
		"department-documents:recycle":       {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007", "edit", http.MethodDelete},
		"department-documents:edit-metadata": {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007", "edit", http.MethodPatch},
		"department-documents:restore-plan":  {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007/restore-plan", "edit", http.MethodPost},
		"department-documents:restore":       {"/v1/codocs/documents/00000000-0000-4000-8000-000000000007/restore", "edit", http.MethodPost},
		"department-folders:list":            {"/v1/codocs/folders", "read", http.MethodGet},
		"department-folders:create":          {"/v1/codocs/folders", "edit", http.MethodPost},
		"department-folders:update":          {"/v1/codocs/folders/7", "edit", http.MethodPatch},
		"department-folders:delete":          {"/v1/codocs/folders/7", "edit", http.MethodDelete},
		"department-folders:open":            {"/v1/codocs/folders/7/open", "edit", http.MethodPatch},
	}
	if len(enterpriseCodocsDepartmentAccessRoutes) != len(want) {
		t.Fatalf("route count=%d want=%d", len(enterpriseCodocsDepartmentAccessRoutes), len(want))
	}
	for name, expected := range want {
		route, ok := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/"+name]
		if !ok || route.Spec.Domain != "codocs" || route.Spec.Actions[route.Action].Method != expected.method || route.Spec.Actions[route.Action].PermitAction != expected.permit || route.Spec.Actions[route.Action].Target(enterpriseDelegatedInput{ObjectID: "7", SubID: "00000000-0000-4000-8000-000000000007"}) != expected.target {
			t.Fatalf("unexpected %s route: %#v", name, route)
		}
	}
}

func TestEnterpriseCodocsDepartmentManageDocumentRequiresExactUUIDSubID(t *testing.T) {
	for _, action := range []string{"view", "download", "readonly", "recycle", "edit-metadata", "restore-plan", "restore"} {
		route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/department-documents:"+action]
		for _, sub := range []string{"", "7", "../7", "00000000-0000-4000-8000-000000000007/other"} {
			if _, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Code: "D1", SubID: sub}, route.Spec, route.Spec.Actions[action], "actor"); err == nil {
				t.Fatalf("%s accepted subID %q", action, sub)
			}
		}
		if _, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Code: "D1", SubID: "00000000-0000-4000-8000-000000000007"}, route.Spec, route.Spec.Actions[action], "actor"); err != nil {
			t.Fatalf("%s rejected valid UUID: %v", action, err)
		}
	}
}

func TestEnterpriseCodocsDepartmentDownloadUsesTrustedRelationAndChecksDocument(t *testing.T) {
	route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/department-documents:download"]
	input := enterpriseDelegatedInput{Code: "D1", SubID: "00000000-0000-4000-8000-000000000007"}
	query, err := enterpriseCodocsDepartmentReadQuery(input, route, "actor-a")
	if err != nil {
		t.Fatal(err)
	}
	if query.Get("current_user") != "actor-a" || query.Get("trusted_department_read_dept_code") != "D1" || query.Get("page") != "" {
		t.Fatalf("download query=%v", query)
	}
	for _, forged := range []string{"current_user", "trusted_department_read_dept_code", "dept_code", "type"} {
		bad := input
		bad.Query = map[string]string{forged: "D2"}
		if _, err := enterpriseCodocsDepartmentReadQuery(bad, route, "actor-a"); err == nil {
			t.Errorf("accepted forged %s", forged)
		}
	}
	valid := map[string]any{"success": true, "data": map[string]any{"uuid": input.SubID, "doc_type": "department", "dept_code": "D1"}}
	if err := validateEnterpriseDepartmentDocumentResponse(valid, input); err != nil {
		t.Fatal(err)
	}
	for _, doc := range []map[string]any{
		{"uuid": input.SubID, "doc_type": "private", "dept_code": "D1"},
		{"uuid": input.SubID, "doc_type": "department", "dept_code": "D2"},
		{"uuid": "00000000-0000-4000-8000-000000000008", "doc_type": "department", "dept_code": "D1"},
	} {
		if err := validateEnterpriseDepartmentDocumentResponse(map[string]any{"success": true, "data": doc}, input); err == nil {
			t.Errorf("accepted wrong document %#v", doc)
		}
	}
}

func TestEnterpriseCodocsDepartmentReadQueryBindsActorDepartmentAndType(t *testing.T) {
	for _, name := range []string{"department-documents:list", "department-folders:list"} {
		route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/"+name]
		input := enterpriseDelegatedInput{Code: "D1"}
		query, err := enterpriseCodocsDepartmentReadQuery(input, route, "actor-a")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if query.Get("current_user") != "actor-a" || query.Get("operator_uid") != "actor-a" || query.Get("dept_code") != "D1" || query.Get("codocs_trusted_department_read_dept_code") != "D1" || query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("page") != "1" || query.Get("pageSize") != "20" {
			t.Fatalf("%s trusted query=%v", name, query)
		}
		if name == "department-documents:list" && query.Get("type") != "department" || name == "department-folders:list" && query.Get("folder_type") != "department" {
			t.Fatalf("%s type=%v", name, query)
		}
		for _, key := range []string{"current_user", "operator_uid", "owner", "viewer", "dept_code", "type", "folder_type", "codocs_trusted_department_read_dept_code", "hzy_runtime_actor_delegated"} {
			bad := input
			bad.Query = map[string]string{key: "D2"}
			if _, err := enterpriseCodocsDepartmentReadQuery(bad, route, "actor-a"); err == nil {
				t.Errorf("%s accepted forged %s", name, key)
			}
		}
	}
}

func TestEnterpriseCodocsDepartmentReadQueryRejectsInvalidFilters(t *testing.T) {
	for _, name := range []string{"department-documents:list", "department-folders:list"} {
		route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/"+name]
		for _, item := range []struct{ key, value string }{{"page", "0"}, {"pageSize", "201"}, {"page", "01"}, {"pageSize", "-1"}} {
			if _, err := enterpriseCodocsDepartmentReadQuery(enterpriseDelegatedInput{Code: "D1", Query: map[string]string{item.key: item.value}}, route, "actor-a"); err == nil {
				t.Errorf("%s accepted %s=%q", name, item.key, item.value)
			}
		}
	}
	for _, item := range []struct{ key, value string }{{"published_mode", "other"}, {"exclude_weekly_reports", "1"}, {"search", strings.Repeat("x", 101)}, {"folder_id", "../1"}, {"folder_id", "01"}} {
		route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/department-documents:list"]
		if _, err := enterpriseCodocsDepartmentReadQuery(enterpriseDelegatedInput{Code: "D1", Query: map[string]string{item.key: item.value}}, route, "actor-a"); err == nil {
			t.Errorf("document list accepted %s=%q", item.key, item.value)
		}
	}
	for _, parent := range []string{"0", "01", "../1", "9223372036854775808"} {
		route := enterpriseCodocsDepartmentAccessRoutes["/v1/enterprise/codocs/department-folders:list"]
		if _, err := enterpriseCodocsDepartmentReadQuery(enterpriseDelegatedInput{Code: "D1", Query: map[string]string{"parent_id": parent}}, route, "actor-a"); err == nil {
			t.Errorf("folder list accepted parent_id=%q", parent)
		}
	}
}
