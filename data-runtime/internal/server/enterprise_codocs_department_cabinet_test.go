package server

import (
	"net/http"
	"testing"
)

func TestEnterpriseDepartmentCabinetExactActionsAndPermit(t *testing.T) {
	want := map[string]struct{ method, action string }{
		"folders": {http.MethodGet, "read"}, "list": {http.MethodGet, "read"}, "view": {http.MethodGet, "read"},
		"converted-info": {http.MethodGet, "read"}, "download": {http.MethodGet, "export"},
		"upload-plan": {http.MethodPost, "edit"}, "upload": {http.MethodPost, "edit"},
		"update": {http.MethodPatch, "edit"}, "delete": {http.MethodDelete, "edit"},
		"folder-create": {http.MethodPost, "edit"}, "folder-update": {http.MethodPatch, "edit"}, "folder-delete": {http.MethodDelete, "edit"},
		"conversion-plan": {http.MethodPost, "edit"}, "convert": {http.MethodPost, "edit"}, "publish-record": {http.MethodPost, "publish"},
	}
	if len(enterpriseCodocsDepartmentCabinetRoutes) != len(want) {
		t.Fatalf("routes=%d want=%d", len(enterpriseCodocsDepartmentCabinetRoutes), len(want))
	}
	for name, expected := range want {
		route, ok := enterpriseCodocsDepartmentCabinetRoutes["/v1/enterprise/codocs/department-cabinet:"+name]
		if !ok || route.Spec.Resource != "department-cabinet" || route.Spec.Actions[name].Method != expected.method || route.Spec.Actions[name].PermitAction != expected.action {
			t.Fatalf("bad route %s: %+v", name, route)
		}
	}
	for _, path := range []string{"/v1/enterprise/codocs/department-cabinet:preview", "/v1/enterprise/codocs/department-cabinet:raw-proxy", "/v1/enterprise/codocs/department-cabinet:quick-publish"} {
		if _, ok := enterpriseCodocsDepartmentCabinetRoutes[path]; ok {
			t.Fatalf("unexpected route %s", path)
		}
	}
}

func TestEnterpriseDepartmentCabinetRejectsForgedScopeAndUnboundedPage(t *testing.T) {
	route := enterpriseCodocsDepartmentCabinetRoutes["/v1/enterprise/codocs/department-cabinet:list"]
	for _, query := range []map[string]string{
		{"dept_code": "D2"}, {"owner_uid": "victim"}, {"current_user": "victim"},
		{"pageSize": "201"}, {"page": "0"}, {"folder_id": "../7"},
	} {
		input := enterpriseDelegatedInput{Code: "D1", Query: query}
		if _, err := departmentCabinetQuery(input, route, "actor-1"); err == nil {
			t.Fatalf("forged query accepted: %v", query)
		}
	}
}
