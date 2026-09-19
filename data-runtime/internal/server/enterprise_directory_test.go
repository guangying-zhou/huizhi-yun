package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseDirectoryAuthorizationBindingAndFreshness(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := func() enterpriseDirectoryInput {
		input := enterpriseDirectoryInput{}
		input.Authorization.ActorUID = "person-a"
		input.Authorization.Tenant = "tenant-a"
		input.Authorization.Deployment = "enterprise-test"
		input.Authorization.Resource = "products"
		input.Authorization.Action = "view"
		input.Authorization.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
		input.Authorization.Scope = map[string]string{"current_user_assets_object_access": "all"}
		return input
	}
	q, err := validateEnterpriseDirectoryAuthorization(valid(), verified, now)
	if err != nil || q.Get("current_user") != verified.ActorUID || q.Get("current_user_assets_permission_action") != "view" {
		t.Fatalf("valid scope rejected: %v", err)
	}
	cases := map[string]func(*enterpriseDirectoryInput){
		"actor":         func(i *enterpriseDirectoryInput) { i.Authorization.ActorUID = "other" },
		"tenant":        func(i *enterpriseDirectoryInput) { i.Authorization.Tenant = "tenant-b" },
		"deployment":    func(i *enterpriseDirectoryInput) { i.Authorization.Deployment = "assets-test" },
		"resource":      func(i *enterpriseDirectoryInput) { i.Authorization.Resource = "asset_items" },
		"action":        func(i *enterpriseDirectoryInput) { i.Authorization.Action = "edit" },
		"expired":       func(i *enterpriseDirectoryInput) { i.Authorization.ExpiresAt = now.UnixMilli() },
		"future":        func(i *enterpriseDirectoryInput) { i.Authorization.ExpiresAt = now.Add(time.Minute).UnixMilli() },
		"scope-actor":   func(i *enterpriseDirectoryInput) { i.Authorization.Scope["current_user"] = "other" },
		"scope-sql":     func(i *enterpriseDirectoryInput) { i.Authorization.Scope["where"] = "1=1" },
		"missing-scope": func(i *enterpriseDirectoryInput) { i.Authorization.Scope = nil },
		"empty-relation": func(i *enterpriseDirectoryInput) {
			i.Authorization.Scope = map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": "[{}]"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			input := valid()
			mutate(&input)
			if _, err := validateEnterpriseDirectoryAuthorization(input, verified, now); err == nil {
				t.Fatal("invalid authorization accepted")
			}
		})
	}
}
