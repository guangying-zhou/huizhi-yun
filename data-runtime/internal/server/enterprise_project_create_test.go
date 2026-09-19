package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseProjectCreatePermitRejectsTenantActorAndScope(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseProjectCreateInput{Tenant: "tenant-a", Deployment: "enterprise-test", Input: map[string]any{"projectCode": "P1"}, Authorization: enterpriseProjectCreatePermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "create", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if validateEnterpriseProjectCreatePermit(valid, verified, now) != nil {
		t.Fatal("valid rejected")
	}
	checks := []func(*enterpriseProjectCreateInput){func(v *enterpriseProjectCreateInput) { v.Tenant = "tenant-b" }, func(v *enterpriseProjectCreateInput) { v.Authorization.ActorUID = "person-b" }, func(v *enterpriseProjectCreateInput) { v.Authorization.Allowed = false }}
	for _, change := range checks {
		candidate := valid
		change(&candidate)
		if validateEnterpriseProjectCreatePermit(candidate, verified, now) == nil {
			t.Fatal("invalid permit accepted")
		}
	}
}
