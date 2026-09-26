package server

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseProductDocumentRouteContract(t *testing.T) {
	if len(enterpriseProductDocumentActions) != 4 {
		t.Fatal("four exact read operations are required")
	}
	for path, action := range enterpriseProductDocumentActions {
		if path != "/v1/enterprise/aims/product-documents:"+action {
			t.Fatalf("unexpected route %s", path)
		}
	}
	valid := enterpriseProductDocumentInput{}
	valid.Query.Page, valid.Query.PageSize = 1, 20
	if !validProductDocumentQuery("list", valid) || !validProductDocumentQuery("requests", valid) {
		t.Fatal("valid read page rejected")
	}
	valid.Query.Search = "term"
	if !validProductDocumentQuery("search", valid) || validProductDocumentQuery("list", valid) {
		t.Fatal("search/list query crossed boundary")
	}
	valid = enterpriseProductDocumentInput{}
	valid.Query.BizID = "11111111-1111-1111-1111-111111111111"
	if !validProductDocumentQuery("content", valid) {
		t.Fatal("valid content query rejected")
	}
	valid.Query.BizID = "../../secrets"
	if validProductDocumentQuery("content", valid) {
		t.Fatal("invalid relation accepted")
	}
}

func TestEnterpriseProductDocumentPermitAndServiceIdentity(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	permit := pc.AuthorizationPermit{Resource: "product_documents", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	permit.Facts.ProductCode, permit.Facts.ActorUID = "P1", "person-a"
	if err := validateEnterpriseProductPermit("P1", "tenant-a", "enterprise-test", permit, "product_documents", "view", verified, now); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*pc.AuthorizationPermit){
		"missing-view":   func(p *pc.AuthorizationPermit) { p.Action = "edit" },
		"wrong-resource": func(p *pc.AuthorizationPermit) { p.Resource = "products" },
		"wrong-actor":    func(p *pc.AuthorizationPermit) { p.Facts.ActorUID = "other" },
		"expired":        func(p *pc.AuthorizationPermit) { p.ExpiresAt = now.UnixMilli() },
	} {
		t.Run(name, func(t *testing.T) {
			bad := permit
			mutate(&bad)
			if validateEnterpriseProductPermit("P1", "tenant-a", "enterprise-test", bad, "product_documents", "view", verified, now) == nil {
				t.Fatal("invalid permit accepted")
			}
		})
	}
	for name, mutate := range map[string]func(jwt.MapClaims){
		"correct":            func(c jwt.MapClaims) { c["scope"] = "aims:product-documents:read" },
		"missing-capability": func(c jwt.MapClaims) { c["scope"] = "aims:products:view" },
		"wrong-audience":     func(c jwt.MapClaims) { c["scope"] = "aims:product-documents:read"; c["aud"] = "other" },
		"wrong-source":       func(c jwt.MapClaims) { c["scope"] = "aims:product-documents:read"; c["source_app"] = "aims" },
		"wrong-tenant":       func(c jwt.MapClaims) { c["scope"] = "aims:product-documents:read"; c["tenant"] = "other" },
		"expired-token": func(c jwt.MapClaims) {
			c["scope"] = "aims:product-documents:read"
			c["exp"] = now.Add(-time.Minute).Unix()
		},
	} {
		t.Run(name, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, mutate, true)
			route.LogicalTarget, route.Capability = "aims", "aims:product-documents:read"
			_, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, identity auth.Context, capability string) (bool, error) {
				return capability == "aims:product-documents:read", nil
			})
			if (err == nil) != (name == "correct") {
				t.Fatalf("authorization mismatch: %v", err)
			}
		})
	}
}
