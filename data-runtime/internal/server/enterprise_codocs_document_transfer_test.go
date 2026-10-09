package server

import "testing"

func TestEnterpriseCodocsDocumentTransferContract(t *testing.T) {
	for _, action := range []string{"department", "project"} {
		route, ok := enterpriseCodocsDocumentTransferRoutes["/v1/enterprise/codocs/document-transfer:"+action]
		if !ok || route.Spec.Actions[action].PermitAction != action {
			t.Fatalf("action %s not registered exactly", action)
		}
		payload := map[string]any{"project_code": "P-1", "source_oss_path": "codocs/users/u/docs/a.md", "new_oss_path": "codocs/projects/P-1/docs/a.md"}
		if action == "department" {
			payload = map[string]any{"dept_code": "D-1", "message": "handoff"}
		}
		query, err := enterpriseCodocsDocumentTransferQuery(enterpriseDelegatedInput{Code: "doc-1", Payload: payload}, action, "owner-1")
		if err != nil || query.Get("current_user") != "owner-1" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("action=%s query=%v err=%v", action, query, err)
		}
	}
}

func TestEnterpriseCodocsDocumentTransferRejectsActorInjection(t *testing.T) {
	if _, err := enterpriseCodocsDocumentTransferQuery(enterpriseDelegatedInput{Code: "doc-1", Payload: map[string]any{"dept_code": "D-1", "actorUid": "victim"}}, "department", "owner-1"); err == nil {
		t.Fatal("actor injection accepted")
	}
}
