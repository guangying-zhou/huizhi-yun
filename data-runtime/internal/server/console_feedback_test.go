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
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestFeedbackPermitGoldenAndTampering(t *testing.T) {
	raw, e := os.ReadFile("testdata/feedback-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		Method, Path, Key, Token, Canonical, Signature string
		Now                                            int64
		Body                                           feedbackRequest
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(v.Method, v.Path, nil)
	r.Header.Set("Authorization", "Bearer "+v.Token)
	r.Header.Set("Idempotency-Key", v.Key)
	r.Header.Set("X-HZY-Feedback-Permit-Signature", v.Signature)
	if got := feedbackCanonical(r, v.Body); got != v.Canonical {
		t.Fatalf("canonical mismatch\n%s\n%s", got, v.Canonical)
	}
	validate := func(in feedbackRequest) error {
		return validateFeedbackPermit(r, in, "draft", "alice", "T1", "T1-enterprise", time.UnixMilli(v.Now))
	}
	if e = validate(v.Body); e != nil {
		t.Fatal(e)
	}
	for name, mutate := range map[string]func(*feedbackRequest){"actor": func(v *feedbackRequest) { v.Authorization.ActorUID = "bob" }, "tenant": func(v *feedbackRequest) { v.Authorization.Tenant = "T2" }, "deployment": func(v *feedbackRequest) { v.Authorization.Deployment = "other" }, "action": func(v *feedbackRequest) { v.Authorization.Action = "view" }, "scope": func(v *feedbackRequest) { v.Authorization.Global = true }, "operation": func(v *feedbackRequest) { v.Authorization.Operation = "read" }, "expired": func(v *feedbackRequest) { v.Authorization.ExpiresAt = 1 }, "policy": func(v *feedbackRequest) { v.Authorization.BundleHash = "" }, "payload": func(v *feedbackRequest) { v.Payload = "{}" }} {
		t.Run(name, func(t *testing.T) {
			bad := v.Body
			mutate(&bad)
			if validate(bad) == nil {
				t.Fatal("accepted tampered permit")
			}
		})
	}
	r.Header.Set("Idempotency-Key", "changed")
	if validate(v.Body) == nil {
		t.Fatal("unbound idempotency key")
	}
	r.Header.Set("Idempotency-Key", v.Key)
	r.Header.Set("Authorization", "Bearer other")
	if validate(v.Body) == nil {
		t.Fatal("unbound service credential")
	}
}

func TestFeedbackHostRejectsWrongIdentity(t *testing.T) {
	for _, scenario := range []string{"anonymous", "tenant", "source", "capability", "audience", "deployment", "unsigned-actor"} {
		t.Run(scenario, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
				c["scope"] = "console:enterprise-host:execute"
				switch scenario {
				case "tenant":
					c["tenant"] = "other"
				case "source":
					c["source_app"] = "console"
				case "capability":
					c["scope"] = "aims:enterprise-host:execute"
				case "audience":
					c["aud"] = "other"
				case "deployment":
					c["deployment"] = "other"
				}
			}, true)
			r.Method = "POST"
			r.URL.Path = "/v1/enterprise/console/feedback:list"
			r.URL.RawQuery = ""
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
			if scenario == "anonymous" {
				r.Header.Del("Authorization")
			}
			if scenario == "unsigned-actor" {
				r.Header.Del("X-HZY-Actor-Signature")
			}
			cfg := config.Config{Tenant: route.Binding.Tenant, Deployment: route.Binding.RuntimeDeployment, DeploymentBindings: map[string]string{"enterprise": route.HostDeployment}}
			cfg.Enterprise.Enabled = true
			cfg.Enterprise.Environment = route.Binding.Environment
			s := &Server{cfg: cfg, auth: a}
			_, e := s.route(r)
			var denied httperror.Error
			if !errors.As(e, &denied) || denied.Status < 400 || denied.Status >= 500 {
				t.Fatalf("identity boundary did not reject %s: %v", scenario, e)
			}
		})
	}
}

func TestConsoleFeedbackServiceCredentialGate(t *testing.T) {
	for _, scenario := range []string{"valid", "revoked", "unavailable", "wrong-client", "wrong-source", "wrong-capability", "wrong-deployment", "wrong-audience", "expired", "no-credential"} {
		t.Run(scenario, func(t *testing.T) {
			pub, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
			claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:console.runtime", "tenant": "T1", "deployment": "console-test", "source_app": "console", "target_app": "data-runtime", "client_id": "console.runtime", "token_use": "service", "scope": "console:feedback-delivery:execute", "hzy": map[string]any{"credentialId": int64(7), "appCode": "console"}, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
			switch scenario {
			case "wrong-client":
				claims["client_id"] = "enterprise.runtime"
			case "wrong-source":
				claims["source_app"] = "enterprise"
			case "wrong-capability":
				claims["scope"] = "console:feedback:view"
			case "wrong-deployment":
				claims["deployment"] = "other"
			case "wrong-audience":
				claims["aud"] = "console"
			case "expired":
				claims["exp"] = time.Now().Add(-time.Minute).Unix()
			case "no-credential":
				claims["hzy"] = map[string]any{"appCode": "console"}
			}
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
			token.Header["kid"] = "test"
			bearer, err := token.SignedString(private)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("POST", "/v1/console/feedback:draft", nil)
			r.Header.Set("Authorization", "Bearer "+bearer)
			cfg := config.Config{Tenant: "T1", Deployment: "runtime-test", DeploymentBindings: map[string]string{"console": "console-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
			calls := 0
			_, err = authenticateConsoleFeedbackRequest(r, auth.New(cfg), "console:feedback-delivery:execute", func(_ context.Context, identity auth.Context, scope string) (bool, error) {
				calls++
				if identity.ClientID != "console.runtime" || identity.CredentialID != 7 || scope != "console:feedback-delivery:execute" {
					t.Fatal("incorrect live credential query")
				}
				if scenario == "unavailable" {
					return false, errors.New("storage down")
				}
				return scenario != "revoked", nil
			})
			if scenario == "valid" {
				if err != nil || calls != 1 {
					t.Fatal(err, calls)
				}
				return
			}
			var denied httperror.Error
			expected := 403
			if scenario == "wrong-audience" || scenario == "expired" {
				expected = 401
			}
			if scenario == "unavailable" {
				expected = 503
			}
			if !errors.As(err, &denied) || denied.Status != expected {
				t.Fatal("gate status", scenario, err)
			}
			if strings.HasPrefix(scenario, "wrong-") || scenario == "no-credential" {
				if calls != 0 {
					t.Fatal("invalid identity reached verifier")
				}
			}
		})
	}
}

func TestFeedbackMediaPermitGoldenAndTampering(t *testing.T) {
	raw, e := os.ReadFile("testdata/feedback-media-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		Method, Path, Key, Token, Canonical, Signature string
		Now                                            int64
		Body                                           feedbackRequest
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(v.Method, v.Path, nil)
	r.Header.Set("Authorization", "Bearer "+v.Token)
	r.Header.Set("Idempotency-Key", v.Key)
	r.Header.Set("X-HZY-Feedback-Permit-Signature", v.Signature)
	if got := feedbackCanonical(r, v.Body); got != v.Canonical {
		t.Fatalf("canonical mismatch\n%s\n%s", got, v.Canonical)
	}
	validate := func(in feedbackRequest) error {
		return validateFeedbackPermit(r, in, "attachment-put", "alice", "T1", "T1-enterprise", time.UnixMilli(v.Now))
	}
	if e = validate(v.Body); e != nil {
		t.Fatal(e)
	}
	for name, mutate := range map[string]func(*feedbackRequest){"actor": func(v *feedbackRequest) { v.Authorization.ActorUID = "bob" }, "tenant": func(v *feedbackRequest) { v.Authorization.Tenant = "T2" }, "deployment": func(v *feedbackRequest) { v.Authorization.Deployment = "other" }, "action": func(v *feedbackRequest) { v.Authorization.Action = "view" }, "scope": func(v *feedbackRequest) { v.Authorization.Global = true }, "operation": func(v *feedbackRequest) { v.Authorization.Operation = "read" }, "expired": func(v *feedbackRequest) { v.Authorization.ExpiresAt = 1 }, "policy": func(v *feedbackRequest) { v.Authorization.BundleHash = "" }, "payload": func(v *feedbackRequest) { v.Payload = "{}" }} {
		t.Run(name, func(t *testing.T) {
			bad := v.Body
			mutate(&bad)
			if validate(bad) == nil {
				t.Fatal("accepted tampered permit")
			}
		})
	}
	r.Header.Set("Idempotency-Key", "changed")
	if validate(v.Body) == nil {
		t.Fatal("unbound idempotency key")
	}
	r.Header.Set("Idempotency-Key", v.Key)
	r.Header.Set("Authorization", "Bearer other")
	if validate(v.Body) == nil {
		t.Fatal("unbound service credential")
	}
}
