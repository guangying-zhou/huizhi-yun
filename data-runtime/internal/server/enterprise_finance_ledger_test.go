package server

import (
	"context"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"strings"
	"testing"
	"time"
)

func TestFinanceLedgerCredentialMatrix(t *testing.T) {
	cases := []struct {
		name   string
		change func(jwt.MapClaims)
		active bool
	}{
		{"correct", nil, true},
		{"missing capability", func(c jwt.MapClaims) { c["scope"] = "finance:read" }, true},
		{"wrong audience", func(c jwt.MapClaims) { c["aud"] = "finance" }, true},
		{"wrong source", func(c jwt.MapClaims) { c["source_app"] = "workflow" }, true},
		{"wrong tenant", func(c jwt.MapClaims) { c["tenant"] = "other" }, true},
		{"wrong deployment", func(c jwt.MapClaims) { c["deployment"] = "other" }, true},
		{"wrong client", func(c jwt.MapClaims) { c["client_id"] = "finance.runtime"; c["sub"] = "client:finance.runtime" }, true},
		{"expired", func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }, true},
		{"user token", func(c jwt.MapClaims) { c["token_use"] = "access" }, true},
		{"revoked", nil, false},
	}
	for _, channel := range []string{"user"} {
		for _, tc := range cases {
			t.Run(channel+"/"+tc.name, func(t *testing.T) {
				scope := "finance:enterprise-host:execute"
				if channel == "system" {
					scope = "finance:scheduler:execute"
				}
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
					c["scope"] = scope
					if tc.change != nil {
						tc.change(c)
					}
				}, true)
				verify := func(context.Context, auth.Context, string) (bool, error) { return tc.active, nil }
				var e error
				if channel == "user" {
					route.LogicalTarget = "finance"
					_, e = authenticateEnterpriseRequest(r, a, route, verify)
				} else {
					for k := range r.Header {
						if strings.HasPrefix(strings.ToLower(k), "x-hzy-actor-") {
							r.Header.Del(k)
						}
					}
					_, e = authenticateEnterpriseSystemRequest(r, config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}}, a, verify, "finance", "")
				}
				if (e == nil) != (tc.name == "correct") {
					t.Fatal(tc.name, e)
				}
			})
		}
	}
}
