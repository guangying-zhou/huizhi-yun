package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseRequestAuthorizationBindings(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "user-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "host-a"}}
	input := enterpriseRequestCreateInput{ProductCode: "P1", Tenant: "tenant-a", Deployment: "host-a", Authorization: productcenter.AuthorizationPermit{Resource: "product_requests", Action: "create", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	input.Authorization.Facts.ProductCode, input.Authorization.Facts.ActorUID = "P1", "user-a"
	if err := validateEnterpriseRequestCreate(input, verified, now); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*enterpriseRequestCreateInput){
		"tenant":     func(i *enterpriseRequestCreateInput) { i.Tenant = "other" },
		"deployment": func(i *enterpriseRequestCreateInput) { i.Deployment = "other" },
		"actor":      func(i *enterpriseRequestCreateInput) { i.Authorization.Facts.ActorUID = "other" },
		"object":     func(i *enterpriseRequestCreateInput) { i.ProductCode = "P2" },
		"resource":   func(i *enterpriseRequestCreateInput) { i.Authorization.Resource = "products" },
		"action":     func(i *enterpriseRequestCreateInput) { i.Authorization.Action = "view" },
		"expired":    func(i *enterpriseRequestCreateInput) { i.Authorization.ExpiresAt = now.UnixMilli() },
		"future":     func(i *enterpriseRequestCreateInput) { i.Authorization.ExpiresAt = now.Add(time.Minute).UnixMilli() },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			bad := input
			mutate(&bad)
			if err := validateEnterpriseRequestCreate(bad, verified, now); err == nil {
				t.Fatal("invalid authorization accepted")
			}
		})
	}
}
