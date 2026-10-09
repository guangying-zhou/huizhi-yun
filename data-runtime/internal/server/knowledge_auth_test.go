package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestKnowledgeTargetRuntimeAuthentication(t *testing.T) {
	pub, private, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "knowledge", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "C000001", Deployment: "runtime-test", DeploymentBindings: map[string]string{"assets": "assets-test", "codocs": "codocs-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	for _, target := range []string{"assets", "codocs"} {
		t.Run(target, func(t *testing.T) {
			cap := target + ":knowledge-link:create"
			if target == "assets" {
				cap = "assets:asset-link:create"
			}
			route := enterpriseSchedulerRoute{App: target, Binding: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "runtime-test"}, WorkerDeployment: target + "-test", WorkerClient: target + ".runtime"}
			request := func(overrides jwt.MapClaims) *http.Request {
				now := time.Now()
				claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:" + target + ".runtime", "tenant": "C000001", "deployment": target + "-test", "source_app": target, "target_app": "data-runtime", "client_id": target + ".runtime", "token_use": "service", "scope": cap, "hzy": map[string]any{"credentialId": int64(7), "appCode": target}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
				for k, v := range overrides {
					claims[k] = v
				}
				token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
				token.Header["kid"] = "knowledge"
				bearer, e := token.SignedString(private)
				if e != nil {
					t.Fatal(e)
				}
				r := httptest.NewRequest(http.MethodPost, "/v1/"+target+"/service/enterprise-knowledge-links", nil)
				r.Header.Set("Authorization", "Bearer "+bearer)
				return r
			}
			verify := func(context.Context, auth.Context, string) (bool, error) { return true, nil }
			if _, _, e = authenticateEnterpriseSchedulerCapability(request(nil), auth.New(cfg), route, verify, cap); e != nil {
				t.Fatal(e)
			}
			for name, bad := range map[string]jwt.MapClaims{"missing capability": {"scope": ""}, "wide": {"scope": target + ":write"}, "audience": {"aud": "console"}, "source": {"source_app": "enterprise"}, "client": {"client_id": "enterprise.runtime"}, "tenant": {"tenant": "other"}, "deployment": {"deployment": "other"}, "expired": {"exp": time.Now().Add(-time.Hour).Unix()}} {
				t.Run(name, func(t *testing.T) {
					if _, _, e := authenticateEnterpriseSchedulerCapability(request(bad), auth.New(cfg), route, verify, cap); e == nil {
						t.Fatal("invalid identity passed")
					}
				})
			}
			if _, _, e = authenticateEnterpriseSchedulerCapability(request(nil), auth.New(cfg), route, func(context.Context, auth.Context, string) (bool, error) { return false, nil }, cap); e == nil {
				t.Fatal("revoked grant passed")
			}
			_, _, e = authenticateEnterpriseSchedulerCapability(request(nil), auth.New(cfg), route, func(context.Context, auth.Context, string) (bool, error) { return false, errors.New("dependency") }, cap)
			var h httperror.Error
			if !errors.As(e, &h) || h.Status != 503 {
				t.Fatal("dependency must remain 503", e)
			}
		})
	}
}
