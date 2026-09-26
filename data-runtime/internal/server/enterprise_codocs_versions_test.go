package server

import (
	"net/http"
	"testing"
	"time"
)

func TestEnterpriseCodocsVersionRoutesUseFixedCodocsTargets(t *testing.T) {
	for _, tc := range []struct {
		action string
		method string
		path   string
		permit string
	}{
		{"versions", http.MethodGet, "/v1/codocs/documents/doc-1/versions", "read"},
		{"version-view", http.MethodGet, "/v1/codocs/documents/doc-1/versions/7", "read"},
		{"version-delete", http.MethodDelete, "/v1/codocs/documents/doc-1/versions/7", "edit"},
	} {
		route, ok := enterpriseCodocsVersionRoutes["/v1/enterprise/codocs/personal-documents:"+tc.action]
		if !ok {
			t.Fatalf("missing version route %q", tc.action)
		}
		if got := route.Spec.Actions[tc.action]; got.Method != tc.method || got.PermitAction != tc.permit {
			t.Fatalf("route %q action = %#v", tc.action, got)
		}
		input := enterpriseDelegatedInput{Code: "doc-1", ObjectID: "7", Query: map[string]string{}, Authorization: enterpriseDelegatedPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "personal-documents", Action: tc.permit, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(),
		}}
		if tc.action == "versions" {
			input.ObjectID = ""
		}
		query, err := enterpriseCodocsVersionQuery(input, tc.action, "person-a")
		if err != nil {
			t.Fatalf("query %q: %v", tc.action, err)
		}
		if query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("query %q did not bind actor: %#v", tc.action, query)
		}
		if got := route.Spec.Actions[tc.action].Target(input); got != tc.path {
			t.Fatalf("target %q = %q, want %q", tc.action, got, tc.path)
		}
	}
}

func TestEnterpriseCodocsVersionQueryRejectsCallerFiltersAndInvalidVersionID(t *testing.T) {
	base := enterpriseDelegatedInput{Code: "doc-1", ObjectID: "7", Query: map[string]string{"current_user": "person-b"}}
	if _, err := enterpriseCodocsVersionQuery(base, "version-delete", "person-a"); err == nil {
		t.Fatal("expected caller query to be rejected")
	}
	base.Query = map[string]string{}
	base.ObjectID = "0"
	if _, err := enterpriseCodocsVersionQuery(base, "version-delete", "person-a"); err == nil {
		t.Fatal("expected invalid version id to be rejected")
	}
	base.ObjectID = "7"
	base.Query = map[string]string{"hzy_runtime_actor_delegated": "1"}
	if _, err := enterpriseCodocsVersionQuery(base, "version-delete", "person-a"); err == nil {
		t.Fatal("expected caller-supplied delegation marker to be rejected")
	}
}
