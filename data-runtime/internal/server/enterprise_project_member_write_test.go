package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseProjectMemberPermitObjectTenantAndActor(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseProjectMemberInput{Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", Authorization: enterpriseProjectMemberPermit{ActorUID: "U1", Tenant: "T1", Deployment: "enterprise-test", Resource: "project-members", Action: "add", ProjectID: "1", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if err := validateEnterpriseProjectMemberPermit(valid, verified, "add", now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*enterpriseProjectMemberInput){func(v *enterpriseProjectMemberInput) { v.Tenant = "T2" }, func(v *enterpriseProjectMemberInput) { v.Deployment = "production" }, func(v *enterpriseProjectMemberInput) { v.Authorization.ActorUID = "U2" }, func(v *enterpriseProjectMemberInput) { v.ProjectID = "2" }, func(v *enterpriseProjectMemberInput) { v.Authorization.Action = "remove" }, func(v *enterpriseProjectMemberInput) { v.Authorization.Allowed = false }} {
		candidate := valid
		change(&candidate)
		if validateEnterpriseProjectMemberPermit(candidate, verified, "add", now) == nil {
			t.Fatal("invalid permit accepted")
		}
	}
}

func TestProjectWriteConditionalPermitCannotChangeBindingOrLifetime(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "host"}}
	input := enterpriseProjectMemberInput{Tenant: "T1", Deployment: "host", ProjectID: "1", Authorization: enterpriseProjectMemberPermit{ActorUID: "U1", Tenant: "T1", Deployment: "host", Resource: "project-members", Action: "add", ProjectID: "1", Mode: "static-or-project-manager", Allowed: false, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if err := validateEnterpriseProjectMemberPermit(input, verified, "add", now); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*enterpriseProjectMemberInput){"expired": func(v *enterpriseProjectMemberInput) { v.Authorization.ExpiresAt = now.UnixMilli() }, "long-lived": func(v *enterpriseProjectMemberInput) {
		v.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	}, "mode": func(v *enterpriseProjectMemberInput) { v.Authorization.Mode = "manager" }, "other-project": func(v *enterpriseProjectMemberInput) { v.Authorization.ProjectID = "2" }, "actor": func(v *enterpriseProjectMemberInput) { v.Authorization.ActorUID = "U2" }} {
		candidate := input
		change(&candidate)
		if err := validateEnterpriseProjectMemberPermit(candidate, verified, "add", now); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
}
