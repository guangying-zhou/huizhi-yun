package server

import (
	"net/http"
	"testing"
)

func TestEnterpriseCodocsDepartmentSharesExactDelegatedActions(t *testing.T) {
	for _, tc := range []struct {
		name, method, permit string
		object, payload      bool
	}{
		{"list", http.MethodGet, "read", false, false},
		{"decide", http.MethodPatch, "edit", true, true},
	} {
		route, ok := enterpriseCodocsDepartmentSharesRoutes["/v1/enterprise/codocs/department-shares:"+tc.name]
		if !ok || route.Spec.Resource != "department-shares" || route.Spec.Actions[tc.name].Method != tc.method || route.Spec.Actions[tc.name].PermitAction != tc.permit || route.Spec.Actions[tc.name].NeedsObject != tc.object || route.Spec.Actions[tc.name].AllowPayload != tc.payload {
			t.Fatalf("bad route %s: %+v", tc.name, route)
		}
	}
	for _, path := range []string{"/v1/enterprise/codocs/department-shares:update", "/v1/enterprise/codocs/department-shares:delete"} {
		if _, ok := enterpriseCodocsDepartmentSharesRoutes[path]; ok {
			t.Fatal("unexpected route", path)
		}
	}
}
