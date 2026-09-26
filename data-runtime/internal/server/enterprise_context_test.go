package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func enterpriseContextFixture(t *testing.T, mutate func(jwt.MapClaims), registered bool) (*auth.Authenticator, *http.Request, enterpriseRouteContext) {
	t.Helper()
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "enterprise-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	now := time.Now()
	claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:enterprise.runtime", "tenant": "tenant-a", "deployment": "enterprise-test", "source_app": "enterprise", "target_app": "data-runtime", "client_id": "enterprise.runtime", "token_use": "service", "scope": "assets:product:read", "hzy": map[string]any{"credentialId": int64(7), "appCode": "enterprise"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
	if mutate != nil {
		mutate(claims)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = "enterprise-test"
	bearer, err := token.SignedString(private)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	if registered {
		cfg.DeploymentBindings = map[string]string{"enterprise": "enterprise-test"}
	} else {
		cfg.Deployment = "enterprise-test"
	}
	r := httptest.NewRequest(http.MethodGet, "/v1/enterprise/products?tenant=tenant-b&actor=forged&source_app=assets", nil)
	r.Header.Set("Authorization", "Bearer "+bearer)
	r.Header.Set("X-HZY-Actor-Uid", "person-a")
	signedAt := strconv.FormatInt(1760000000000, 10) // testActorSignature pins the delegation clock to this instant.
	r.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, signedAt))
	r.Header.Set("X-HZY-Tenant", "tenant-b")
	r.Header.Set("X-HZY-Logical-Target", "finance")
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, HostDeployment: "enterprise-test", LogicalSource: "aims", LogicalTarget: "assets", Capability: "assets:product:read"}
	return auth.New(cfg), r, route
}

func TestEnterpriseContextUsesVerifiedIdentityAndRegisteredRoute(t *testing.T) {
	a, r, route := enterpriseContextFixture(t, nil, true)
	calls := 0
	got, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, identity auth.Context, capability string) (bool, error) {
		calls++
		if identity.ClientID != "enterprise.runtime" || identity.CredentialID != 7 || capability != "assets:product:read" {
			t.Fatal("incorrect credential verification context")
		}
		return true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Route.Binding.Tenant != "tenant-a" || got.Route.LogicalTarget != "assets" || got.Route.LogicalSource != "aims" || got.ActorUID != "person-a" || got.PhysicalHost != "enterprise" || calls != 1 {
		t.Fatalf("incorrect verified context: %#v", got)
	}
}

func TestEnterpriseContextRejectsIdentityAndDelegationViolations(t *testing.T) {
	cases := []struct {
		name       string
		mutate     func(jwt.MapClaims)
		request    func(*http.Request)
		registered bool
	}{
		{name: "unregistered", registered: false},
		{name: "tenant", registered: true, mutate: func(c jwt.MapClaims) { c["tenant"] = "tenant-b" }},
		{name: "audience", registered: true, mutate: func(c jwt.MapClaims) { c["aud"] = "assets" }},
		{name: "deployment", registered: true, mutate: func(c jwt.MapClaims) { c["deployment"] = "another-site" }},
		{name: "source", registered: true, mutate: func(c jwt.MapClaims) { c["source_app"] = "aims" }},
		{name: "client", registered: true, mutate: func(c jwt.MapClaims) { c["client_id"] = "aims.runtime" }},
		{name: "subject", registered: true, mutate: func(c jwt.MapClaims) { c["sub"] = "client:aims.runtime" }},
		{name: "legacy-prefixed-capability", registered: true, mutate: func(c jwt.MapClaims) { c["scope"] = "data-runtime:assets:product:read" }},
		{name: "broad-scope", registered: true, mutate: func(c jwt.MapClaims) { c["scope"] = "*" }},
		{name: "expired", registered: true, mutate: func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }},
		{name: "missing-expiry", registered: true, mutate: func(c jwt.MapClaims) { delete(c, "exp") }},
		{name: "unsigned-actor", registered: true, request: func(r *http.Request) { r.Header.Del("X-HZY-Actor-Signature") }},
		{name: "tampered-actor", registered: true, request: func(r *http.Request) { r.Header.Set("X-HZY-Actor-Uid", "other") }},
		{name: "tampered-path", registered: true, request: func(r *http.Request) { r.URL.Path = "/v1/enterprise/finance" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, tc.mutate, tc.registered)
			if tc.request != nil {
				tc.request(r)
			}
			_, err := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) {
				t.Fatal("invalid identity reached credential verifier")
				return true, nil
			})
			if err == nil {
				t.Fatal("invalid context accepted")
			}
		})
	}
}

func TestEnterpriseContextRequiresLiveCredentialState(t *testing.T) {
	a, r, route := enterpriseContextFixture(t, nil, true)
	for _, verify := range []enterpriseCredentialVerifier{nil, func(context.Context, auth.Context, string) (bool, error) { return false, nil }, func(context.Context, auth.Context, string) (bool, error) {
		return false, errors.New("private backend diagnostic")
	}} {
		if _, err := authenticateEnterpriseRequest(r, a, route, verify); err == nil {
			t.Fatal("missing or inactive credential accepted")
		}
	}
}
