package server

import "testing"

func TestEnterpriseCodocsDocumentShareContract(t *testing.T) {
	want := map[string]string{"list": "read", "mark-read": "mark-read", "create": "create", "update": "edit", "delete": "delete"}
	if len(enterpriseCodocsDocumentShareRoutes) != len(want) {
		t.Fatalf("routes=%d", len(enterpriseCodocsDocumentShareRoutes))
	}
	for action, permit := range want {
		route, ok := enterpriseCodocsDocumentShareRoutes["/v1/enterprise/codocs/document-shares:"+action]
		if !ok || route.Spec.Actions[action].PermitAction != permit {
			t.Fatalf("action %s not registered exactly", action)
		}
		code := "doc-1"
		if action == "update" || action == "delete" {
			code += "/42"
		}
		payload := map[string]any{}
		if action == "create" {
			payload = map[string]any{"sharedToUid": "u-2", "permission": "read"}
		}
		if action == "update" {
			payload = map[string]any{"permission": "write"}
		}
		query, err := enterpriseCodocsDocumentShareQuery(enterpriseDelegatedInput{Code: code, Payload: payload}, action, "u-1")
		if err != nil || query.Get("current_user") != "u-1" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("action %s query=%v err=%v", action, query, err)
		}
		if action != "list" && action != "mark-read" && payload["actorUid"] != "u-1" {
			t.Fatalf("action %s actor not injected", action)
		}
	}
}

func TestEnterpriseCodocsDocumentShareRejectsInjection(t *testing.T) {
	for _, tc := range []struct {
		action, code string
		payload      map[string]any
	}{
		{"create", "doc-1", map[string]any{"sharedToUid": "u-2", "permission": "admin"}},
		{"create", "doc-1", map[string]any{"sharedToUid": "u-2", "permission": "read", "actorUid": "victim"}},
		{"update", "doc-1/42", map[string]any{"permission": "write", "ownerUid": "victim"}},
		{"delete", "doc-1/42", map[string]any{"actorUid": "victim"}},
	} {
		if _, err := enterpriseCodocsDocumentShareQuery(enterpriseDelegatedInput{Code: tc.code, Payload: tc.payload}, tc.action, "u-1"); err == nil {
			t.Fatalf("accepted %#v", tc)
		}
	}
}
