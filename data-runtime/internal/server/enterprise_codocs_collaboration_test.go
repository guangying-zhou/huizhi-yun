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

func TestEnterpriseCodocsCollaborationPaginationBounds(t *testing.T) {
	base := enterpriseCodocsReadInput()
	base.Query = map[string]string{"category": "shared", "scope": "all", "sharedTab": "received", "page": "2", "pageSize": "100"}
	query, err := enterpriseCodocsCollaborationQuery(base, "list", "person-a")
	if err != nil || query.Get("page") != "2" || query.Get("sharedTab") != "received" {
		t.Fatal(query, err)
	}
	for _, pair := range [][2]string{{"page", "01"}, {"page", "0"}, {"page", "1.5"}, {"page", ""}, {"pageSize", "101"}, {"sharedTab", "invalid"}, {"category", "outside"}} {
		input := base
		input.Query = map[string]string{}
		for k, v := range base.Query {
			input.Query[k] = v
		}
		input.Query[pair[0]] = pair[1]
		if _, err := enterpriseCodocsCollaborationQuery(input, "list", "person-a"); err == nil {
			t.Fatal("accepted", pair)
		}
	}
}
