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
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "scheduler-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"aims": "aims-test", "enterprise": "enterprise-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, WorkerDeployment: "aims-test", WorkerClient: "aims.runtime"}
	for _, scenario := range []string{"valid", "host", "bare-subject", "tenant", "deployment", "audience", "scope", "expired", "revoked", "dependency", "missing-verifier"} {
		t.Run(scenario, func(t *testing.T) {
			now := time.Now()
			claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:aims.runtime", "tenant": "tenant-a", "deployment": "aims-test", "source_app": "aims", "target_app": "data-runtime", "client_id": "aims.runtime", "token_use": "service", "scope": enterpriseSchedulerCapability, "hzy": map[string]any{"credentialId": int64(7), "appCode": "aims"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
			switch scenario {
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
				if a.ClientID != "aims.runtime" || capability != enterpriseSchedulerCapability {
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
				if err != nil || identity.Deployment != "aims-test" || identity.SourceApp != "aims" {
					t.Fatal("valid worker rejected", err)
				}
			} else if err == nil {
				t.Fatal("invalid worker accepted")
			}
		})
	}
}
