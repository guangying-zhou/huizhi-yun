package server

import (
	"context"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEnterpriseCallbackSystemLaneIsSeparatedAndLive(t *testing.T) {
	cfg, key := testRuntimeJWTConfig(t)
	cfg.Auth.JWT.Issuer = "https://console.test"
	cfg.DeploymentBindings = map[string]string{"enterprise": "deployment-1", "aims": "deployment-aims", "workflow": "deployment-workflow"}
	for _, scenario := range []string{"valid", "actor", "purpose", "user-scope", "notification-scope", "wrong-client", "wrong-source", "wrong-deployment", "wrong-audience", "revoked", "dependency", "missing-verifier", "legacy-closed", "legacy-open"} {
		t.Run(scenario, func(t *testing.T) {
			local := cfg
			local.Enterprise.AllowLegacyAimsCallbacks = scenario == "legacy-open"
			app, client, scope, dep, audience := "enterprise", "enterprise.runtime", "aims:scheduler:execute", "deployment-1", cfg.Auth.JWT.Audience
			switch scenario {
			case "user-scope":
				scope = "aims:enterprise-host:execute"
			case "notification-scope":
				scope = "aims:notification-detail:authorize"
			case "wrong-client":
				client = "workflow.runtime"
			case "wrong-source":
				app = "workflow"
				client = "workflow.runtime"
				dep = "deployment-workflow"
			case "wrong-deployment":
				dep = "other"
			case "wrong-audience":
				audience = "codocs"
			case "legacy-closed", "legacy-open":
				app = "aims"
				client = "aims.runtime"
				dep = "deployment-aims"
				scope = "aims:work-item-completion-callback:execute"
			}
			now := time.Now()
			claims := jwt.MapClaims{"iss": cfg.Auth.JWT.Issuer, "aud": audience, "sub": "client:" + client, "tenant": cfg.Tenant, "deployment": dep, "source_app": app, "target_app": audience, "client_id": client, "token_use": "service", "scope": scope, "hzy": map[string]any{"credentialId": 7, "appCode": app}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
			token.Header["kid"] = "test-key"
			bearer, err := token.SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/aims/service/work-item-completion/workflow-callback", nil)
			req.Header.Set("Authorization", "Bearer "+bearer)
			if scenario == "actor" {
				req.Header.Set("X-HZY-Actor-Uid", "viewer")
			}
			if scenario == "purpose" {
				req.Header.Set("X-HZY-Actor-Purpose", "notification-detail-authorization")
			}
			calls := 0
			var verify enterpriseCredentialVerifier = func(_ context.Context, identity auth.Context, capability string) (bool, error) {
				calls++
				if identity.ClientID != client || capability != scope {
					t.Fatal("wrong credential/grant lookup")
				}
				if scenario == "dependency" {
					return false, errors.New("dependency")
				}
				return scenario != "revoked", nil
			}
			if scenario == "missing-verifier" {
				verify = nil
			}
			_, err = authenticateEnterpriseSystemRequest(req, local, auth.New(local), verify, "aims", "aims:work-item-completion-callback:execute")
			if scenario == "valid" || scenario == "legacy-open" {
				if err != nil || calls != 1 {
					t.Fatalf("valid request rejected %v calls=%d", err, calls)
				}
				return
			}
			var public httperror.Error
			if !errors.As(err, &public) {
				t.Fatalf("invalid request accepted: %v", err)
			}
			if scenario == "dependency" || scenario == "missing-verifier" {
				if public.Status != 503 {
					t.Fatal(err)
				}
			} else if public.Status != 401 && public.Status != 403 {
				t.Fatal(err)
			}
			if scenario == "actor" || scenario == "purpose" {
				if calls != 0 {
					t.Fatal("delegation reached live grant lookup")
				}
			}
		})
	}
}

func TestEnterpriseLegacyFallbackOnlyForSourceMismatch(t *testing.T) {
	for _, code := range []string{"insufficient_scope", "deployment_mismatch", "tenant_mismatch", "invalid_token", "credential_unavailable"} {
		if enterpriseSourceMismatch(httperror.New(403, code, "redacted")) {
			t.Fatal(code)
		}
	}
	if !enterpriseSourceMismatch(httperror.New(403, "source_app_mismatch", "redacted")) {
		t.Fatal("source mismatch must select legacy")
	}
}
