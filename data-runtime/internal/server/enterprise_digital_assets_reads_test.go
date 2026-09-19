package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseDigitalAssetReadScopeBindsIdentityAndResource(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := func() enterpriseDirectoryAuthorization {
		return enterpriseDirectoryAuthorization{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "digital_assets", Action: "view",
			ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
			Scope:     map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`},
		}
	}
	q, err := enterpriseDigitalAssetReadScope(valid(), verified, now)
	if err != nil || q.Get("current_user") != "person-a" || q.Get("current_user_assets_permission_action") != "view" {
		t.Fatalf("valid digital-assets authorization rejected: %v", err)
	}
	cases := map[string]func(*enterpriseDirectoryAuthorization){
		"actor":        func(p *enterpriseDirectoryAuthorization) { p.ActorUID = "forged" },
		"tenant":       func(p *enterpriseDirectoryAuthorization) { p.Tenant = "other" },
		"deployment":   func(p *enterpriseDirectoryAuthorization) { p.Deployment = "other" },
		"resource":     func(p *enterpriseDirectoryAuthorization) { p.Resource = "asset_items" },
		"action":       func(p *enterpriseDirectoryAuthorization) { p.Action = "edit" },
		"expired":      func(p *enterpriseDirectoryAuthorization) { p.ExpiresAt = now.UnixMilli() },
		"scope-inject": func(p *enterpriseDirectoryAuthorization) { p.Scope["current_user"] = "forged" },
		"scope-none": func(p *enterpriseDirectoryAuthorization) {
			p.Scope = map[string]string{"current_user_assets_object_access": "none"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			permit := valid()
			mutate(&permit)
			if _, err := enterpriseDigitalAssetReadScope(permit, verified, now); err == nil {
				t.Fatal("invalid digital-assets authorization accepted")
			}
		})
	}
}
