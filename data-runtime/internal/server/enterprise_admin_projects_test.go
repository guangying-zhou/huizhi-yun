package server

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseAdminProjectServiceDomainCapabilityIsExact(t *testing.T) {
	for _, tc := range []struct {
		name, scope, audience string
		allowed               bool
	}{
		{"list", "aims:enterprise-host:execute", "data-runtime", true},
		{"other-domain", "assets:enterprise-host:execute", "data-runtime", false},
		{"personnel-admin-is-not-service-capability", "aims:admin:admin", "data-runtime", false},
		{"wrong-audience", "aims:enterprise-host:execute", "aims", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(claims jwt.MapClaims) { claims["scope"] = tc.scope; claims["aud"] = tc.audience }, true)
			route.LogicalTarget = "aims"
			_, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, _ auth.Context, cap string) (bool, error) {
				if cap != "aims:enterprise-host:execute" {
					t.Fatal(cap)
				}
				return true, nil
			})
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%t err=%v", tc.allowed, err)
			}
		})
	}
}

func TestEnterpriseAdminProjectPermitsAreRouteBound(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	permit := enterpriseAdminProjectPermit{ActorUID: "U1", Tenant: "T1", Deployment: "enterprise-test", Resource: "admin", Action: "admin", Mode: "admin-static", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	if err := validateEnterpriseAdminProjectPermit("T1", "enterprise-test", permit, verified, now); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*enterpriseAdminProjectPermit){
		"project-edit-mode":     func(p *enterpriseAdminProjectPermit) { p.Mode = "static-or-project-manager" },
		"project-edit-resource": func(p *enterpriseAdminProjectPermit) { p.Resource = "projects"; p.Action = "edit" },
		"other-actor":           func(p *enterpriseAdminProjectPermit) { p.ActorUID = "U2" },
		"other-deployment":      func(p *enterpriseAdminProjectPermit) { p.Deployment = "other" },
		"expired":               func(p *enterpriseAdminProjectPermit) { p.ExpiresAt = now.UnixMilli() },
		"long-lived":            func(p *enterpriseAdminProjectPermit) { p.ExpiresAt = now.Add(16 * time.Second).UnixMilli() },
	} {
		candidate := permit
		change(&candidate)
		if err := validateEnterpriseAdminProjectPermit("T1", "enterprise-test", candidate, verified, now); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	if err := validateEnterpriseAdminProjectPermit("other", "enterprise-test", permit, verified, now); err == nil {
		t.Fatal("accepted other tenant")
	}
	editPermit := struct {
		ActorUID   string `json:"actorUid"`
		Tenant     string `json:"tenant"`
		Deployment string `json:"deployment"`
		Resource   string `json:"resource"`
		Action     string `json:"action"`
		ProjectID  string `json:"projectId"`
		Mode       string `json:"mode"`
		Allowed    bool   `json:"allowed"`
		ExpiresAt  int64  `json:"expiresAt"`
	}{"U1", "T1", "enterprise-test", "admin", "admin", "7", "admin-static", true, permit.ExpiresAt}
	if err := validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", editPermit, verified, now, true); err != nil {
		t.Fatal(err)
	}
	if err := validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", editPermit, verified, now, false); err == nil {
		t.Fatal("admin permit crossed into project edit")
	}
}

func TestEnterpriseRoutineBatchUsesTheSameClosedAdminPermit(t *testing.T) {
	if enterpriseAdminRoutineBatchPath != "/v1/enterprise/aims/admin-projects:routine-batch" {
		t.Fatal("route drift")
	}
	// The same validator is called by list and batch. None of these claims may
	// be substituted by a project relation or a different service identity.
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "host"}}
	permit := enterpriseAdminProjectPermit{ActorUID: "U1", Tenant: "T1", Deployment: "host", Resource: "admin", Action: "admin", Mode: "admin-static", Allowed: true, ExpiresAt: now.Add(time.Second).UnixMilli()}
	for _, field := range []string{"tenant", "deployment", "actor", "mode", "resource", "action", "allowed", "expires"} {
		p := permit
		switch field {
		case "tenant":
			p.Tenant = "other"
		case "deployment":
			p.Deployment = "other"
		case "actor":
			p.ActorUID = "other"
		case "mode":
			p.Mode = "project-manager"
		case "resource":
			p.Resource = "projects"
		case "action":
			p.Action = "edit"
		case "allowed":
			p.Allowed = false
		case "expires":
			p.ExpiresAt = now.UnixMilli()
		}
		if err := validateEnterpriseAdminProjectPermit("T1", "host", p, verified, now); err == nil {
			t.Fatal("accepted", field)
		}
	}
	if !enterpriseDelegatedRequiresIdempotencyKey("project-portfolios", "create") {
		t.Fatal("portfolio intent key optional")
	}
	if enterpriseDelegatedRequiresIdempotencyKey("project-portfolios", "list") {
		t.Fatal("read contract changed")
	}
}
