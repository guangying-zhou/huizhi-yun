package server

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseProjectProductRoutesAuthenticateWithDomainCapabilityAndActionPermit(t *testing.T) {
	s := Server{cfg: config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}, Enterprise: config.EnterpriseConfig{Environment: "test"}}}
	for _, tc := range []struct {
		operation, capability, permission string
	}{
		{"list", "aims:enterprise-host:execute", "view"},
		{"link", "aims:enterprise-host:execute", "edit"},
	} {
		t.Run(tc.operation, func(t *testing.T) {
			route, permission := s.enterpriseProjectProductRoute(tc.operation)
			if enterpriseHostDomainCapability(route.LogicalTarget) != tc.capability || permission != tc.permission {
				t.Fatalf("incorrect production route: %#v, permission=%s", route, permission)
			}
			a, request, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = tc.capability }, true)
			_, err := authenticateEnterpriseRequest(request, a, route, func(_ context.Context, _ auth.Context, capability string) (bool, error) {
				return capability == tc.capability, nil
			})
			if err != nil {
				t.Fatalf("production route rejected a correctly scoped identity: %v", err)
			}
		})
	}
}

func TestEnterpriseProjectProductPermitMatrix(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	input := enterpriseProjectProductInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12"}
	permit := enterpriseProjectProductPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "edit", ProjectID: "12", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	if err := validateEnterpriseProjectProductPermit(input, permit, "edit", verified, now); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*enterpriseProjectProductPermit){
		"wrong-actor":      func(p *enterpriseProjectProductPermit) { p.ActorUID = "other" },
		"wrong-project":    func(p *enterpriseProjectProductPermit) { p.ProjectID = "13" },
		"wrong-action":     func(p *enterpriseProjectProductPermit) { p.Action = "view" },
		"wrong-tenant":     func(p *enterpriseProjectProductPermit) { p.Tenant = "other" },
		"wrong-deployment": func(p *enterpriseProjectProductPermit) { p.Deployment = "other" },
		"denied":           func(p *enterpriseProjectProductPermit) { p.Allowed = false },
		"expired":          func(p *enterpriseProjectProductPermit) { p.ExpiresAt = now.UnixMilli() },
	} {
		t.Run(name, func(t *testing.T) {
			bad := permit
			change(&bad)
			if validateEnterpriseProjectProductPermit(input, bad, "edit", verified, now) == nil {
				t.Fatal("invalid permit accepted")
			}
		})
	}
	if err := validateEnterpriseProjectProductPermit(input, permit, "view", verified, now); err == nil {
		t.Fatal("write permit accepted for read operation")
	}
}

func TestEnterpriseProjectProductLinkRequiresBoundProjectScope(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	input := enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12"}
	act := enterpriseDelegatedAction{ScopeResource: "projects"}
	if err := validateDelegatedProjectWritePermit(input, verified, act, now); err == nil {
		t.Fatal("unscoped project product link accepted")
	}
	input.ProjectWriteAuthorization = &enterpriseDelegatedProjectWritePermit{enterpriseWorkItemWritePermit: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "edit", ProjectID: "12", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash27", PolicyRevision: &revision}}
	if err := validateDelegatedProjectWritePermit(input, verified, act, now); err != nil {
		t.Fatal(err)
	}
	input.ProjectID = "13"
	if err := validateDelegatedProjectWritePermit(input, verified, act, now); err == nil {
		t.Fatal("another project's permit accepted")
	}
}

func TestEnterpriseAssociationServiceIdentityMatrix(t *testing.T) {
	for _, operation := range []string{"product-document-create", "project-product-read", "project-product-create"} {
		capability := "aims:enterprise-host:execute"
		for name, mutate := range map[string]func(jwt.MapClaims){
			"correct":        func(c jwt.MapClaims) { c["scope"] = capability },
			"wrong-domain":   func(c jwt.MapClaims) { c["scope"] = "assets:enterprise-host:execute" },
			"wrong-audience": func(c jwt.MapClaims) { c["scope"] = capability; c["aud"] = "other" },
			"wrong-source":   func(c jwt.MapClaims) { c["scope"] = capability; c["source_app"] = "codocs" },
			"wrong-tenant":   func(c jwt.MapClaims) { c["scope"] = capability; c["tenant"] = "other" },
			"expired":        func(c jwt.MapClaims) { c["scope"] = capability; c["exp"] = time.Now().Add(-time.Minute).Unix() },
		} {
			t.Run(operation+"/"+name, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, mutate, true)
				route.LogicalTarget = "aims"
				if operation != "project-product-read" {
					r.Method = http.MethodPost
					bearer := r.Header.Get("Authorization")[7:]
					r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
				}
				_, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, _ auth.Context, cap string) (bool, error) { return cap == capability, nil })
				if (err == nil) != (name == "correct") {
					t.Fatalf("identity mismatch: %v", err)
				}
			})
		}
	}
}
