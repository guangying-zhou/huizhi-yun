package server

import (
	"context"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAPF18SchedulerIdentityMatrix(t *testing.T) {
	for _, domain := range []string{"altoc", "finance", "people"} {
		for _, aud := range []string{"data-runtime", "tenant-runtime"} {
			cfg, key := testRuntimeJWTConfig(t)
			cfg.Auth.JWT.Audience = aud
			cfg.Auth.JWT.Issuer = "https://console.test"
			cfg.DeploymentBindings = map[string]string{"enterprise": "deployment-1", "aims": "deployment-aims", "workflow": "deployment-workflow"}
			for _, scenario := range []string{"valid", "actor", "purpose", "user-scope", "notification-scope", "wrong-client", "wrong-source", "wrong-deployment", "wrong-audience", "wrong-tenant", "expired", "revoked", "dependency", "missing-verifier"} {
				t.Run(domain+"/"+aud+"/"+scenario, func(t *testing.T) {
					local := cfg
					local.Enterprise.AllowLegacyAimsCallbacks = false
					app, client, scope, dep, audience := "enterprise", "enterprise.runtime", domain+":scheduler:execute", "deployment-1", cfg.Auth.JWT.Audience
					switch scenario {
					case "user-scope":
						scope = domain + ":enterprise-host:execute"
					case "notification-scope":
						scope = domain + ":notification-detail:authorize"
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
					if scenario == "wrong-tenant" {
						claims["tenant"] = "other"
					}
					if scenario == "expired" {
						claims["exp"] = now.Add(-time.Minute).Unix()
					}
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
					_, err = authenticateEnterpriseSystemRequest(req, local, auth.New(local), verify, domain, "")
					if scenario == "valid" {
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
	}
}

func TestAPF18B1AllRoutesRequireExactSystemLane(t *testing.T) {
	count := 0
	for path, spec := range enterpriseAPFPaths {
		family, action, ok := enterpriseapf.DueOperation(spec.operation)
		if !ok {
			continue
		}
		count++
		if spec.channel != "system" || spec.domain != enterpriseapf.DueFamilies[family].Domain || path != "/v1/enterprise/"+spec.domain+"/"+family+":"+action {
			t.Fatal("due route drift", path, spec)
		}
		for _, scope := range []string{spec.domain + ":scheduler:execute", spec.domain + ":enterprise-host:execute", spec.domain + ":notification-detail:authorize", "aims:scheduler:execute"} {
			a, r, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = scope }, true)
			r.URL.Path = path
			for k := range r.Header {
				if strings.HasPrefix(k, "X-Hzy-Actor-") {
					r.Header.Del(k)
				}
			}
			cfg := config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}}
			_, e := authenticateEnterpriseSystemRequest(r, cfg, a, func(context.Context, auth.Context, string) (bool, error) { return true, nil }, spec.domain, "")
			if (e == nil) != (scope == spec.domain+":scheduler:execute") {
				t.Fatal(path, scope, e)
			}
		}
	}
	if count != 18 {
		t.Fatal("fixed due operation count", count)
	}
}

func TestAPF18DeadLetterRouteMatrix(t *testing.T) {
	count := 0
	for _, domain := range []string{"altoc", "finance", "people"} {
		for _, op := range []string{"pending-dead-letter-actionables", "dead-letter-actionable-published", "pending-dead-letter-closures", "dead-letter-closure-acknowledged"} {
			path := "/v1/enterprise/" + domain + "/" + op
			route, ok := enterpriseAPFPaths[path]
			if !ok || route.domain != domain || route.operation != op || route.channel != "system" || !enterpriseapf.DeadLetterOperation(op) {
				t.Fatal("fixed S route mismatch", path, route)
			}
			for _, adjacent := range []string{path + "/extra", path + ":all", strings.Replace(path, domain, "assets", 1)} {
				if _, ok := enterpriseAPFPaths[adjacent]; ok {
					t.Fatal("adjacent route widened", adjacent)
				}
			}
			count++
		}
	}
	if count != 12 {
		t.Fatal("fixed dead-letter route budget", count)
	}
}
