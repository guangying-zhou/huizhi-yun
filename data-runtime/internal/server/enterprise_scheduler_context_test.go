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
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEnterpriseSchedulerVerifiesRealWorkerAndLiveCredential(t *testing.T) {
	testSchedulerIdentity(t, "aims")
}
func TestHostSchedulerVerifiesRealWorkerAndLiveCredential(t *testing.T) {
	testSchedulerIdentity(t, "enterprise")
}
func testSchedulerIdentity(t *testing.T, executor string) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "scheduler-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"aims": "aims-test", "enterprise": "enterprise-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, WorkerDeployment: executor + "-test", WorkerClient: executor + ".runtime"}
	for _, scenario := range []string{"valid", "host", "bare-subject", "opposite-worker", "tenant", "deployment", "audience", "scope", "callback-only", "expired", "revoked", "dependency", "missing-verifier"} {
		t.Run(scenario, func(t *testing.T) {
			now := time.Now()
			claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:" + executor + ".runtime", "tenant": "tenant-a", "deployment": executor + "-test", "source_app": executor, "target_app": "data-runtime", "client_id": executor + ".runtime", "token_use": "service", "scope": enterpriseSchedulerCapability, "hzy": map[string]any{"credentialId": int64(7), "appCode": executor}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
			switch scenario {
			case "opposite-worker":
				other := "enterprise"
				if executor == "enterprise" {
					other = "aims"
				}
				claims["sub"] = "client:" + other + ".runtime"
				claims["client_id"] = other + ".runtime"
				claims["source_app"] = other
				claims["deployment"] = other + "-test"
				claims["hzy"] = map[string]any{"credentialId": int64(7), "appCode": other}
			case "bare-subject":
				claims["sub"] = "aims.runtime"
			case "host":
				claims["sub"] = "enterprise.runtime"
				claims["client_id"] = "enterprise.runtime"
				claims["source_app"] = "enterprise"
				claims["deployment"] = "enterprise-test"
				claims["hzy"] = map[string]any{"credentialId": int64(7), "appCode": "enterprise"}
			case "tenant":
				claims["tenant"] = "other"
			case "deployment":
				claims["deployment"] = "other"
			case "audience":
				claims["aud"] = "altoc"
			case "scope":
				claims["scope"] = "aims.write"
			case "callback-only":
				claims["scope"] = "aims:scheduler:execute aims:work-item-completion-callback:execute"
			case "expired":
				claims["exp"] = now.Add(-time.Hour).Unix()
			}
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
			token.Header["kid"] = "scheduler-test"
			bearer, err := token.SignedString(private)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/enterprise/aims/integration-operations:claim-next?tenant=forged", nil)
			req.Header.Set("Authorization", "Bearer "+bearer)
			req.Header.Set("X-HZY-App-Code", "enterprise")
			req.Header.Set("X-HZY-Actor-Uid", "forged")
			var verify enterpriseCredentialVerifier = func(_ context.Context, a auth.Context, capability string) (bool, error) {
				if a.ClientID != executor+".runtime" || capability != enterpriseSchedulerCapability {
					t.Fatal("wrong credential lookup")
				}
				if scenario == "dependency" {
					return false, errors.New("database unavailable")
				}
				return scenario != "revoked", nil
			}
			if scenario == "missing-verifier" {
				verify = nil
			}
			_, identity, err := authenticateEnterpriseScheduler(req, auth.New(cfg), route, verify)
			if scenario == "valid" {
				if err != nil || identity.Deployment != executor+"-test" || identity.SourceApp != executor {
					t.Fatal("valid worker rejected", err)
				}
			} else if err == nil {
				t.Fatal("invalid worker accepted")
			}
		})
	}
}
