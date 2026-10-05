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
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEnterpriseNotificationDetailSourceAndPurpose(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "purpose-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "T", Deployment: "runtime", DeploymentBindings: map[string]string{"enterprise": "T-enterprise", "aims": "T-aims", "assets": "T-assets", "codocs": "T-codocs"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	for _, domain := range []string{"aims", "assets"} {
		for _, scenario := range []string{"valid", "scheduler-scope", "wrong-source", "wrong-client", "wrong-deployment", "legacy-closed", "legacy-open", "legacy-qualified", "revoked", "dependency", "missing-verifier"} {
			t.Run(domain+"/"+scenario, func(t *testing.T) {
				local := cfg
				local.Enterprise.AllowLegacyNotificationDetails = (scenario == "legacy-open" || scenario == "legacy-qualified")
				app, client, scope, dep := "enterprise", "enterprise.runtime", domain+":notification-detail:authorize", "T-enterprise"
				switch scenario {
				case "scheduler-scope":
					scope = domain + ":scheduler:execute"
				case "wrong-source":
					app = "codocs"
					client = "codocs.runtime"
					dep = "T-codocs"
				case "wrong-client":
					client = "aims.runtime"
				case "wrong-deployment":
					dep = "other"
				case "legacy-closed", "legacy-open", "legacy-qualified":
					app = domain
					client = domain + ".runtime"
					dep = "T-" + domain
					scope = domain + ".read"
					if scenario == "legacy-qualified" {
						scope = "data-runtime:" + domain + ":read"
					}
				}
				now := time.Now()
				claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:" + client, "tenant": "T", "deployment": dep, "source_app": app, "target_app": "data-runtime", "client_id": client, "token_use": "service", "scope": scope, "hzy": map[string]any{"credentialId": 7, "appCode": app}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
				token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
				token.Header["kid"] = "purpose-test"
				bearer, e := token.SignedString(private)
				if e != nil {
					t.Fatal(e)
				}
				req := httptest.NewRequest(http.MethodPost, "/v1/"+domain+"/notification-details/authorize", nil)
				req.Header.Set("Authorization", "Bearer "+bearer)
				var verify enterpriseCredentialVerifier = func(_ context.Context, a auth.Context, capability string) (bool, error) {
					if a.ClientID != client || capability != scope {
						t.Fatal("credential scope mismatch")
					}
					if scenario == "dependency" {
						return false, errors.New("dependency")
					}
					return scenario != "revoked", nil
				}
				if scenario == "missing-verifier" {
					verify = nil
				}
				identity, e := authenticateEnterpriseNotificationDetail(req, local, auth.New(local), verify, domain)
				if scenario == "valid" || (scenario == "legacy-open" || scenario == "legacy-qualified") {
					if e != nil {
						t.Fatal(e)
					}
					if _, _, e = notificationDetailViewer(req, identity); e == nil {
						t.Fatal("missing purpose accepted")
					}
					return
				}
				var public httperror.Error
				if !errors.As(e, &public) {
					t.Fatalf("no public error: %v", e)
				}
				expected := 403
				if scenario == "dependency" || scenario == "missing-verifier" {
					expected = 503
				}
				if public.Status != expected {
					t.Fatalf("got %d want %d: %v", public.Status, expected, e)
				}
			})
		}
	}
}

func TestEnterpriseNotificationViewerRequiresActualPurposeSignature(t *testing.T) {
	old := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = old })
	identity := auth.Context{Subject: "client:enterprise.runtime"}
	for _, item := range []struct {
		uid, purpose string
		allow        bool
	}{{"viewer", "notification-detail-authorization", true}, {"viewer", "", false}, {"viewer", "service-command", false}, {identity.Subject, "notification-detail-authorization", false}} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/notification-details/authorize", nil)
		req.Header.Set("Authorization", "Bearer fixture-token")
		req.Header.Set("X-HZY-Actor-Uid", item.uid)
		req.Header.Set("X-HZY-Actor-Purpose", item.purpose)
		req.Header.Set("X-HZY-Actor-Signed-At", "1760000000000")
		req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, "fixture-token", req.Method, req.URL.RequestURI(), item.uid, nil, "1760000000000", item.purpose))
		uid, _, err := notificationDetailViewer(req, identity)
		if item.allow {
			if err != nil || uid != "viewer" {
				t.Fatalf("valid purpose rejected %v", err)
			}
		} else if err == nil {
			t.Fatal("invalid purpose accepted")
		}
	}
}
