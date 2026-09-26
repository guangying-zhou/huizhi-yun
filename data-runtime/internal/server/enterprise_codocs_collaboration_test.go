package server

import (
	"testing"
	"time"
)

func TestEnterpriseCodocsCollaborationRoutesAndTrustedAdminMarker(t *testing.T) {
	if len(enterpriseCodocsCollaborationRoutes) != 2 {
		t.Fatalf("routes=%d", len(enterpriseCodocsCollaborationRoutes))
	}
	for _, action := range []string{"list", "list-admin"} {
		route, ok := enterpriseCodocsCollaborationRoutes["/v1/enterprise/codocs/collab-documents:"+action]
		if !ok || route.Spec.Resource != "collab-documents" || route.Spec.Actions[action].Method != "GET" {
			t.Fatalf("%s route=%#v", action, route)
		}
		input := enterpriseCodocsReadInput()
		input.Authorization.Resource = "collab-documents"
		input.Authorization.Action = route.Spec.Actions[action].PermitAction
		input.Query = map[string]string{"category": "outside", "scope": "todo", "keyword": "notice"}
		query, err := enterpriseCodocsCollaborationQuery(input, action, "person-a")
		if err != nil || query.Get("current_user") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("%s query=%v err=%v", action, query, err)
		}
		if (query.Get("codocs_trusted_review_execution_admin") == "1") != (action == "list-admin") {
			t.Fatalf("%s admin marker=%q", action, query.Get("codocs_trusted_review_execution_admin"))
		}
		if err := validateEnterpriseDelegatedPermit(input, enterpriseCodocsReadVerified(), enterpriseCodocsCollaborationSpec, route.Spec.Actions[action], time.Now()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEnterpriseCodocsCollaborationRejectsInjectedOrInvalidScope(t *testing.T) {
	base := enterpriseCodocsReadInput()
	base.Authorization.Resource = "collab-documents"
	base.Authorization.Action = "read"
	for _, query := range []map[string]string{
		{"category": "project", "scope": "all"},
		{"category": "shared", "scope": "admin"},
		{"category": "shared", "scope": "all", "current_user": "victim"},
		{"category": "shared", "scope": "all", "codocs_trusted_review_execution_admin": "1"},
		{"category": "shared", "scope": "all", "keyword": "x\nforged"},
	} {
		input := base
		input.Query = query
		if _, err := enterpriseCodocsCollaborationQuery(input, "list", "person-a"); err == nil {
			t.Fatalf("accepted query %#v", query)
		}
	}
}
