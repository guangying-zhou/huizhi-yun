package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestAPFReceivableGoldenPermitAndExactActions(t *testing.T) {
	for _, name := range []string{"read", "assign"} {
		raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-receivable-" + name + "-permit.json")
		if e != nil {
			t.Fatal(e)
		}
		var f struct {
			Method, Target, Canonical string
			Body                      apfInput
		}
		if e = json.Unmarshal(raw, &f); e != nil {
			t.Fatal(e)
		}
		r := httptest.NewRequest(f.Method, f.Target, nil)
		if apfPermitCanonical(r, f.Body) != f.Canonical {
			t.Fatal("golden drift", name)
		}
		now := time.Now()
		f.Body.Authorization.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
		spec := enterpriseAPFPaths[f.Target]
		v := enterpriseRequestContext{ActorUID: f.Body.Authorization.ActorUID}
		v.Route.Binding.Tenant = f.Body.Authorization.Tenant
		v.Route.HostDeployment = f.Body.Authorization.Deployment
		sign := func() {
			r.Header.Set("Authorization", "Bearer token")
			mac := hmac.New(sha256.New, []byte("token"))
			mac.Write([]byte(apfPermitCanonical(r, f.Body)))
			r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
		}
		sign()
		if e = validateAPFPermit(r, f.Body, spec, v, now); e != nil {
			t.Fatal(e)
		}
		original := f.Body.Authorization
		for _, field := range []string{"action", "actor", "tenant", "deployment", "expired", "allowed", "object"} {
			f.Body.Authorization = original
			switch field {
			case "action":
				f.Body.Authorization.Action = "admin"
			case "actor":
				f.Body.Authorization.ActorUID = "other"
			case "tenant":
				f.Body.Authorization.Tenant = "other"
			case "deployment":
				f.Body.Authorization.Deployment = "other"
			case "expired":
				f.Body.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
			case "allowed":
				f.Body.Authorization.Allowed = false
			case "object":
				f.Body.Authorization.ObjectID = "other"
			}
			sign()
			if validateAPFPermit(r, f.Body, spec, v, now) == nil {
				t.Fatal("permit bypass", field)
			}
		}
		f.Body.Authorization = original
		sign()
		f.Body.Sales.Payload["pageSize"] = float64(1)
		if validateAPFPermit(r, f.Body, spec, v, now) == nil {
			t.Fatal("unsigned intent")
		}
	}
}
func TestAPFReceivableTransportMatrix(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(jwt.MapClaims)
	}{
		{"correct", nil}, {"capability", func(c jwt.MapClaims) { c["scope"] = "altoc:read" }}, {"audience", func(c jwt.MapClaims) { c["aud"] = "altoc" }}, {"source", func(c jwt.MapClaims) { c["source_app"] = "altoc" }}, {"tenant", func(c jwt.MapClaims) { c["tenant"] = "other" }}, {"deployment", func(c jwt.MapClaims) { c["deployment"] = "other" }}, {"expired", func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
				c["scope"] = "altoc:enterprise-host:execute"
				if tc.mutate != nil {
					tc.mutate(c)
				}
			}, true)
			route.LogicalTarget = "altoc"
			r.Method = http.MethodGet // Transport authenticates exact delegated URL; business routing tested above.
			_, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
			if (e == nil) != (tc.name == "correct") {
				t.Fatal(e)
			}
		})
	}
}
