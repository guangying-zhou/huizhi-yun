package server

import (
	"testing"
	"time"
)

func annotationInput(action string) enterpriseDelegatedInput {
	input := enterpriseDelegatedInput{
		Tenant: "tenant-a", Deployment: "enterprise-test", Code: "doc-1_A",
		Payload:       map[string]any{"content": "reply"},
		Authorization: enterpriseDelegatedPermit{ActorUID: "actor-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "document-annotations", Action: "edit", ExpiresAt: time.Now().Add(5 * time.Second).UnixMilli()},
	}
	if action == "list" {
		input.Payload = nil
		input.Authorization.Action = "read"
	}
	if action == "create" {
		input.Payload = map[string]any{"selected_text": "selected", "content": "note", "mentioned_users": []any{}}
		input.Authorization.Action = "create"
	}
	if action == "update" {
		input.ObjectID = "12"
		input.Payload = map[string]any{"status": "resolved"}
	}
	if action == "reply-create" {
		input.ObjectID = "12"
	}
	if action == "reply-delete" {
		input.ObjectID, input.SubID = "12", "13"
		input.Payload = nil
	}
	return input
}

func TestEnterpriseCodocsAnnotationsRoutesUseExplicitDocumentTargets(t *testing.T) {
	want := map[string]struct{}{
		"/v1/enterprise/codocs/document-annotations:list":         {},
		"/v1/enterprise/codocs/document-annotations:create":       {},
		"/v1/enterprise/codocs/document-annotations:update":       {},
		"/v1/enterprise/codocs/document-annotations:reply-create": {},
		"/v1/enterprise/codocs/document-annotations:reply-delete": {},
	}
	for path := range want {
		if _, ok := enterpriseCodocsAnnotationsRoutes[path]; !ok {
			t.Fatalf("missing annotation route %s", path)
		}
	}
	if got := enterpriseCodocsAnnotationsSpec.Actions["reply-delete"].Target(annotationInput("reply-delete")); got != "/v1/codocs/documents/doc-1_A/annotations/12/replies/13" {
		t.Fatalf("reply-delete target = %q", got)
	}
}

func TestEnterpriseCodocsAnnotationsQueryBindsActorAndRejectsIdentityInjection(t *testing.T) {
	for _, action := range []string{"list", "create", "update", "reply-create", "reply-delete"} {
		input := annotationInput(action)
		query, err := enterpriseCodocsAnnotationsQuery(input, action, "actor-a")
		if err != nil {
			t.Fatalf("%s valid input rejected: %v", action, err)
		}
		if query.Get("current_user") != "actor-a" || query.Get("operator_uid") != "actor-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("%s actor marker = %v", action, query)
		}
	}

	for _, key := range []string{"actorUid", "actor_uid", "author_id", "author_name", "current_user"} {
		input := annotationInput("create")
		input.Payload[key] = "forged"
		if _, err := enterpriseCodocsAnnotationsQuery(input, "create", "actor-a"); err == nil {
			t.Fatalf("forged identity field %q accepted", key)
		}
	}
}

func TestEnterpriseCodocsAnnotationsQueryRejectsInvalidPayloadAndPathIDs(t *testing.T) {
	invalid := []struct {
		action string
		mutate func(*enterpriseDelegatedInput)
	}{
		{"create", func(in *enterpriseDelegatedInput) { in.Payload = map[string]any{"selected_text": "", "content": "x"} }},
		{"update", func(in *enterpriseDelegatedInput) { in.Payload = map[string]any{"status": "pending"} }},
		{"reply-create", func(in *enterpriseDelegatedInput) { in.Payload = map[string]any{"content": ""} }},
		{"reply-delete", func(in *enterpriseDelegatedInput) { in.SubID = "0" }},
	}
	for _, tc := range invalid {
		input := annotationInput(tc.action)
		tc.mutate(&input)
		if _, err := enterpriseCodocsAnnotationsQuery(input, tc.action, "actor-a"); err == nil {
			t.Fatalf("invalid %s input accepted", tc.action)
		}
	}
}

func TestEnterpriseCodocsAnnotationsPermitUsesExactResourceAndAction(t *testing.T) {
	for path, route := range enterpriseCodocsAnnotationsRoutes {
		if route.Spec.Resource != "document-annotations" {
			t.Fatalf("%s resource = %q", path, route.Spec.Resource)
		}
		if route.Spec.Actions[route.Action].PermitAction == "" {
			t.Fatalf("%s has empty permit action", path)
		}
	}
}
