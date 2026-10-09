package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"strings"
	"testing"
	"time"
)

func TestAltocApprovalCredentialMatrix(t *testing.T) {
	cases := []struct {
		name   string
		change func(jwt.MapClaims)
		active bool
	}{
		{"correct", nil, true},
		{"missing capability", func(c jwt.MapClaims) { c["scope"] = "altoc:read" }, true},
		{"wrong audience", func(c jwt.MapClaims) { c["aud"] = "altoc" }, true},
		{"wrong source", func(c jwt.MapClaims) { c["source_app"] = "workflow" }, true},
		{"wrong tenant", func(c jwt.MapClaims) { c["tenant"] = "other" }, true},
		{"wrong deployment", func(c jwt.MapClaims) { c["deployment"] = "other" }, true},
		{"wrong client", func(c jwt.MapClaims) { c["client_id"] = "altoc.runtime"; c["sub"] = "client:altoc.runtime" }, true},
		{"expired", func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }, true},
		{"user token", func(c jwt.MapClaims) { c["token_use"] = "access" }, true},
		{"revoked", nil, false},
	}
	for _, channel := range []string{"user", "system"} {
		for _, tc := range cases {
			t.Run(channel+"/"+tc.name, func(t *testing.T) {
				scope := "altoc:enterprise-host:execute"
				if channel == "system" {
					scope = "altoc:scheduler:execute"
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
					route.LogicalTarget = "altoc"
					_, e = authenticateEnterpriseRequest(r, a, route, verify)
				} else {
					for k := range r.Header {
						if strings.HasPrefix(strings.ToLower(k), "x-hzy-actor-") {
							r.Header.Del(k)
						}
					}
					_, e = authenticateEnterpriseSystemRequest(r, config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}}, a, verify, "altoc", "")
				}
				if (e == nil) != (tc.name == "correct") {
					t.Fatal(tc.name, e)
				}
			})
		}
	}
}
func TestAltocApprovalFixedUserPermit(t *testing.T) {
	for _, resource := range []string{"quotation", "contract"} {
		for _, action := range []string{"request", "bind"} {
			op := resource + "-approval-" + action
			spec := enterpriseAPFPaths["/v1/enterprise/altoc/"+resource+"-approval:"+action]
			if spec.operation != op || spec.domain != "altoc" || spec.channel != "user" {
				t.Fatal("route not frozen")
			}
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
			route.LogicalTarget = "altoc"
			v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
			if e != nil {
				t.Fatal(e)
			}
			now := time.Now()
			rev := int64(1)
			i := apfInput{Input: enterpriseapf.Input{ID: "1", RowVersion: 2}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: resource, Action: "edit", Operation: op, ObjectID: "1", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self"}}}
			sign := func() {
				m := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
				m.Write([]byte(apfPermitCanonical(r, i)))
				r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
			}
			sign()
			if e := validateAPFPermit(r, i, spec, v, now); e != nil {
				t.Fatal(e)
			}
			i.RowVersion++
			if validateAPFPermit(r, i, spec, v, now) == nil {
				t.Fatal("tampered version")
			}
			i.RowVersion--
			i.Authorization.Action = "view"
			sign()
			if validateAPFPermit(r, i, spec, v, now) == nil {
				t.Fatal("view used for submit")
			}
		}
	}
}
