package server

import (
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func documentUpdateInput() enterpriseDelegatedInput {
	return enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test", Code: "doc-1", Payload: map[string]any{"title": "Title"}, Authorization: enterpriseDelegatedPermit{
		ActorUID: "user-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "personal-documents", Action: "edit", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(),
	}}
}

func TestEnterpriseDocumentUpdatePlanAndCommitUseExactEditAndBoundActor(t *testing.T) {
	verified := enterpriseRequestContext{ActorUID: "user-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	for _, name := range []string{"update-plan", "update"} {
		route, ok := enterpriseCodocsDocumentUpdateRoutes["/v1/enterprise/codocs/personal-documents:"+name]
		if !ok || route.Spec.Actions[name].PermitAction != "edit" || route.Spec.Domain != "codocs" || route.Spec.Resource != "personal-documents" {
			t.Fatalf("incorrect route: %#v", route)
		}
		input := documentUpdateInput()
		query, err := enterpriseCodocsDocumentUpdateQuery(input, name, "user-a")
		if err != nil || query.Get("current_user") != "user-a" {
			t.Fatalf("query=%v err=%v", query, err)
		}
		if err := validateEnterpriseDelegatedPermit(input, verified, route.Spec, route.Spec.Actions[name], time.Now()); err != nil {
			t.Fatal(err)
		}
		for _, mutate := range []func(*enterpriseDelegatedInput){
			func(v *enterpriseDelegatedInput) { v.Authorization.ActorUID = "other" },
			func(v *enterpriseDelegatedInput) { v.Tenant = "other" },
			func(v *enterpriseDelegatedInput) { v.Deployment = "other" },
			func(v *enterpriseDelegatedInput) { v.Authorization.Action = "read" },
			func(v *enterpriseDelegatedInput) { v.Authorization.Resource = "documents" },
			func(v *enterpriseDelegatedInput) {
				v.Authorization.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
			},
		} {
			invalid := documentUpdateInput()
			mutate(&invalid)
			if validateEnterpriseDelegatedPermit(invalid, verified, route.Spec, route.Spec.Actions[name], time.Now()) == nil {
				t.Fatalf("%s accepted invalid permit: %#v", name, invalid)
			}
		}
		for _, code := range []string{"", "../x", "doc?x", strings.Repeat("x", 65)} {
			invalid := documentUpdateInput()
			invalid.Code = code
			if _, err := enterpriseCodocsDocumentUpdateQuery(invalid, name, "user-a"); err == nil {
				t.Fatalf("accepted code %q", code)
			}
		}
		input.Query = map[string]string{"current_user": "other"}
		if _, err := enterpriseCodocsDocumentUpdateQuery(input, name, "user-a"); err == nil {
			t.Fatal("accepted actor query override")
		}
	}
}
