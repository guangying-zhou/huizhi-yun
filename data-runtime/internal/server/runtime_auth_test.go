package server

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestRuntimeAuthScopesAddsAdminForStaticTokenMode(t *testing.T) {
	scopes := runtimeAuthScopes(auth.Context{
		AppCode: "altoc",
		Mode:    string(config.AuthStaticToken),
		Scopes:  []string{"altoc.write"},
	})
	if !stringInSlice(scopes, "altoc.admin") {
		t.Fatalf("expected static-token runtime auth to include altoc.admin, got %#v", scopes)
	}
}

func TestRuntimeHealthFailsClosedWithoutLeakingDatabaseError(t *testing.T) {
	database, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	_ = database.Close()
	server := &Server{
		console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-1", database),
	}
	health := server.runtimeHealth(context.Background())
	if health["runtimeProduct"] != "hzy-data-runtime" {
		t.Fatalf("expected explicit data runtime product identity, got %#v", health["runtimeProduct"])
	}
	if health["status"] != "degraded" {
		t.Fatalf("unavailable adapter must degrade runtime health: %#v", health)
	}
	apps, _ := health["apps"].(map[string]any)
	consoleHealth, _ := apps["console"].(map[string]any)
	if consoleHealth["db"] != "unavailable" || consoleHealth["error"] != nil {
		t.Fatalf("health must report coarse readiness without internal error text: %#v", consoleHealth)
	}
}

func TestRuntimeAuthScopesAddsAdminForDisabledMode(t *testing.T) {
	scopes := runtimeAuthScopes(auth.Context{
		AppCode: "altoc",
		Mode:    string(config.AuthDisabled),
		Scopes:  []string{"altoc.write"},
	})
	if !stringInSlice(scopes, "altoc.admin") {
		t.Fatalf("expected disabled runtime auth to include altoc.admin, got %#v", scopes)
	}
}

func TestRuntimeAuthScopesDoesNotElevateJWTMode(t *testing.T) {
	scopes := runtimeAuthScopes(auth.Context{
		AppCode: "altoc",
		Mode:    string(config.AuthJWT),
		Scopes:  []string{"altoc.write"},
	})
	if stringInSlice(scopes, "altoc.admin") {
		t.Fatalf("expected jwt runtime auth not to include admin scope, got %#v", scopes)
	}
}

func TestRuntimeAuthScopesAddsSemanticAliasForAudienceQualifiedScopes(t *testing.T) {
	scopes := runtimeAuthScopes(auth.Context{
		AppCode: "people",
		Mode:    string(config.AuthJWT),
		Scopes:  []string{"data-runtime:people:offboarding_tasks:view", "tenant-runtime:people:integration_operations:replay"},
	})
	for _, expected := range []string{
		"data-runtime:people:offboarding_tasks:view",
		"people:offboarding_tasks:view",
		"tenant-runtime:people:integration_operations:replay",
		"people:integration_operations:replay",
	} {
		if !stringInSlice(scopes, expected) {
			t.Fatalf("expected %q in %#v", expected, scopes)
		}
	}
}

func TestConsoleOIDCJWKSIsPublicDiscoveryMaterial(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodGet, "/v1/console/auth/oidc/jwks", nil)

	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("public JWKS request must reach the adapter without JWT authentication: %T %v", err, err)
	}
}

func TestConsoleProfileRequiresExactCapabilityBeforeAdapterAccess(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/profile", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console.read"))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("legacy scope error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/profile", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "tenant-runtime:console:org-profile:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/profile", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "finance", "console:org-profile:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "source_app_mismatch" {
		t.Fatalf("wrong source app error=%T %v", err, err)
	}
}

func TestAimsCodocsGrantRepairRequiresSignedConsoleAdministratorBeforeAdapterAccess(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "console", "console:service-client:grant")
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/console/admin/service-grant-repairs/aims-codocs-runtime-read",
		strings.NewReader(`{}`),
	)
	request.Header.Set("Authorization", "Bearer "+token)

	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_console_actor_required" {
		t.Fatalf("unsigned repair request error=%T %v", err, err)
	}
}

func TestConsoleCutoverReadinessRequiresSchemaReadCapability(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/runtime/schema/status?app=console&mode=cutover", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:org-profile:view",
	))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("business capability must not read cutover evidence: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/runtime/schema/status?app=console&mode=cutover", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console.schema.read",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact schema capability should reach the adapter boundary: %T %v", err, err)
	}
}

func TestConsoleCutoverReadinessUsesConsoleApplicationDeploymentBinding(t *testing.T) {
	server := &Server{cfg: config.Config{
		Deployment: "c000001-prod-tenant-runtime",
		DeploymentBindings: map[string]string{
			"console": "C000001-console",
		},
	}}
	if got := server.consoleCutoverDeployment(); got != "C000001-console" {
		t.Fatalf("cutover readiness must validate Console data against the Console app binding, got %q", got)
	}
}

func TestConsoleCutoverDispositionsRequireDedicatedExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/cutover/dispositions", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console.schema.read",
	))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("schema reader must not list cutover dispositions: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/cutover/dispositions", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:cutover-disposition:view",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact view capability should reach adapter boundary: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/cutover/dispositions",
		strings.NewReader(`{"changeReference":"CTR-1","dispositions":[]}`),
	)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:cutover-disposition:view",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("view capability must not apply dispositions: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/cutover/dispositions",
		strings.NewReader(`{"changeReference":"CTR-1","dispositions":[]}`),
	)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "finance", "console:cutover-disposition:manage",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "source_app_mismatch" {
		t.Fatalf("wrong source app must be rejected: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/cutover/service-clients/8/retire",
		strings.NewReader(`{}`),
	)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:cutover-disposition:manage",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("disposition manager must not retire a service identity: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/cutover/service-clients/8/retire",
		strings.NewReader(`{}`),
	)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:cutover-service-client:retire",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact retirement capability should reach adapter boundary: %T %v", err, err)
	}
}

func TestConsoleConnectorRuntimeRequiresExactCapabilityBeforeAdapterAccess(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/connector-runtime", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:connector-runtime:admin",
	))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("admin must not imply view capability: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/connector-runtime", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:connector-runtime:view",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/console/connector-runtime/heartbeat", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:connector-runtime:enroll",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("enrollment must not imply heartbeat capability: %T %v", err, err)
	}
}

func TestConsoleIntegrationManagementRequiresExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/integrations", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:integration:edit",
	))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("edit must not imply integration view: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/integrations", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:integration:view",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact integration view error=%T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost, "/v1/console/integrations/dingtalk.default/rotate", strings.NewReader(`{}`),
	)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:integration:edit",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("edit must not imply credential rotation: %T %v", err, err)
	}
}

func TestConsoleProfileUpdateRequiresSignedUserActor(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "console", "console:org-profile:edit")
	body := `{"expectedRevision":1,"orgName":"Wiztek","countryCode":"CN","timezone":"Asia/Shanghai","locale":"zh-CN","currencyCode":"CNY"}`

	request := httptest.NewRequest(http.MethodPut, "/v1/console/profile", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", "console-profile-test")
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_console_actor_required" {
		t.Fatalf("unsigned actor error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPut, "/v1/console/profile", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", "console-profile-test")
	request.Header.Set("X-HZY-Actor-Uid", "U1001")
	request.Header.Set("X-HZY-Actor-Signed-At", "1760000000000")
	request.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, http.MethodPut, "/v1/console/profile", "U1001", nil, "1760000000000"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("trusted actor error=%T %v", err, err)
	}
}

func TestConsoleDirectoryConnectorManagementRequiresExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/directory/provisioning", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-user:view"))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("wrong capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/directory/provisioning", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-connector:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "directory_runtime_not_ready" {
		t.Fatalf("exact capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/console/directory/sources/ldap/test", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-connector:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("view-only mutation error=%T %v", err, err)
	}
}

func TestConsoleDingTalkProfileServiceCommandUsesTargetRuntimeBearer(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	path := "/v1/console/directory/service/dingtalk-profile-sync-batches"

	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "console", "console:directory-profiles:sync",
	))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "directory_runtime_not_ready" {
		t.Fatalf("target Console bearer error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(
		t, privateKey, "connector-runtime", "console:directory-profiles:sync",
	))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "source_app_mismatch" {
		t.Fatalf("source Connector bearer error=%T %v", err, err)
	}
}

func TestConsoleDirectoryConnectorEnrollmentRequiresExactCapability(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodPost, "/v1/console/directory-connectors/enroll", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-connector:execute"))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("wrong capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/console/directory-connectors/enroll", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-connector:enroll"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "directory_runtime_not_ready" {
		t.Fatalf("exact enrollment capability error=%T %v", err, err)
	}
}

func TestConsoleDirectorySourceManagementRequiresExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/directory/sources", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-connector:view"))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("connector view must not read source config: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/directory/sources", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-source:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "directory_runtime_not_ready" {
		t.Fatalf("exact source view capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPut, "/v1/console/directory/sources/ldap", strings.NewReader(`{"status":"active"}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:directory-source:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("source view must not edit source config: %T %v", err, err)
	}
}

func TestConsoleVaultManagementRequiresExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/vault/secrets", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:vault-secret:edit"))
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("edit-only list error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/vault/secrets", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:vault-secret:view"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact view capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/console/vault/secrets/test.secret/reveal", strings.NewReader(`{"reason":"incident"}`))
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:vault-secret:edit"))
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("edit-only reveal error=%T %v", err, err)
	}
}

func TestConsoleOIDCSigningRequiresDedicatedCapability(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/console/auth/oidc/sign",
		strings.NewReader(`{"claims":{},"ttlSeconds":300}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:auth-oidc:write"),
	)
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("OIDC write token must not sign: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/auth/oidc/sign",
		strings.NewReader(`{"claims":{},"ttlSeconds":300}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:auth-oidc:sign"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact OIDC signing capability error=%T %v", err, err)
	}
}

func TestOIDCSigningDeploymentAllowsOnlyExactCanonicalRuntimeClient(t *testing.T) {
	authCtx := auth.Context{
		Tenant:     "tenant-a",
		Deployment: "tenant-a-console",
		AppCode:    "console",
		Subject:    "client:console.runtime",
	}

	userClaims := map[string]any{
		"token_use":  "access",
		"tenant":     "forged",
		"deployment": "tenant-a-aims",
	}
	if err := bindOIDCSigningClaimsToRuntime(userClaims, authCtx, nil); err != nil {
		t.Fatal(err)
	}
	if userClaims["tenant"] != "tenant-a" || userClaims["deployment"] != "tenant-a-console" {
		t.Fatalf("user claims were not pinned to the authenticated Runtime: %#v", userClaims)
	}

	serviceClaims := func(deployment, appCode, clientCode, subjectCode, sourceApp string) map[string]any {
		return map[string]any{
			"token_use":  "service",
			"tenant":     "forged",
			"deployment": deployment,
			"source_app": sourceApp,
			"hzy": map[string]any{
				"appCode": appCode, "clientCode": clientCode, "subjectCode": subjectCode,
			},
		}
	}

	trustedGateway := serviceClaims(
		"tenant-a-console", "workflow", "workflow.runtime", "workflow.runtime", "workflow",
	)
	if err := bindOIDCSigningClaimsToRuntime(trustedGateway, authCtx, nil); err != nil {
		t.Fatal(err)
	}
	if trustedGateway["deployment"] != "tenant-a-console" {
		t.Fatalf("trusted gateway deployment = %v", trustedGateway["deployment"])
	}

	canonicalRuntime := serviceClaims(
		"tenant-a-workflow", "workflow", "workflow.runtime", "workflow.runtime", "workflow",
	)
	if err := bindOIDCSigningClaimsToRuntime(canonicalRuntime, authCtx, nil); err != nil {
		t.Fatal(err)
	}
	if canonicalRuntime["tenant"] != "tenant-a" || canonicalRuntime["deployment"] != "tenant-a-workflow" {
		t.Fatalf("canonical runtime claims = %#v", canonicalRuntime)
	}

	for _, claims := range []map[string]any{
		serviceClaims("tenant-a-finance", "workflow", "workflow.runtime", "workflow.runtime", "workflow"),
		serviceClaims("tenant-a-workflow", "workflow", "workflow.support", "workflow.support", "workflow"),
		serviceClaims("tenant-a-workflow", "workflow", "workflow.runtime", "workflow.runtime", "finance"),
	} {
		err := bindOIDCSigningClaimsToRuntime(claims, authCtx, nil)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) ||
			httpErr.Status != http.StatusForbidden ||
			httpErr.Code != "oidc_signing_service_deployment_invalid" {
			t.Fatalf("invalid service deployment error=%T %v", err, err)
		}
	}
}

func TestOIDCSigningUsesExactEnrolledApplicationDeployment(t *testing.T) {
	authCtx := auth.Context{Tenant: "C000001", Deployment: "wiztek-test-console", AppCode: "console", Subject: "client:console.runtime"}
	bindings := map[string]string{"console": "wiztek-test-console", "people": "C000001-test-people"}
	for _, tc := range []struct {
		name, deployment, app, client, subject, source string
		allowed                                        bool
	}{
		{"test binding", "C000001-test-people", "people", "people.runtime", "people.runtime", "people", true},
		{"production name", "C000001-people", "people", "people.runtime", "people.runtime", "people", false},
		{"wrong tenant", "C000002-test-people", "people", "people.runtime", "people.runtime", "people", false},
		{"unbound app", "C000001-finance", "finance", "finance.runtime", "finance.runtime", "finance", false},
		{"wrong client", "C000001-test-people", "people", "people.support", "people.runtime", "people", false},
		{"wrong subject", "C000001-test-people", "people", "people.runtime", "people.support", "people", false},
		{"wrong source", "C000001-test-people", "people", "people.runtime", "people.runtime", "finance", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := map[string]any{"token_use": "service", "tenant": "forged", "deployment": tc.deployment, "source_app": tc.source,
				"hzy": map[string]any{"appCode": tc.app, "clientCode": tc.client, "subjectCode": tc.subject}}
			err := bindOIDCSigningClaimsToRuntime(claims, authCtx, bindings)
			if tc.allowed {
				if err != nil || claims["deployment"] != tc.deployment || claims["tenant"] != authCtx.Tenant {
					t.Fatalf("exact enrolled binding rejected or changed: %v %#v", err, claims)
				}
				return
			}
			var httpErr httperror.Error
			if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "oidc_signing_service_deployment_invalid" {
				t.Fatalf("invalid binding must be forbidden: %v", err)
			}
		})
	}
}

func TestConsoleServiceIntegrationRoutesRequireCallerCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/service/integrations/oss.default", nil)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "credential_vault:resolve"),
	)
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("resolve-only token must not read integration config: %T %v", err, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/service/integrations/oss.default", nil)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "integration_config:view"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact integration view capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/oss.default/resolve",
		strings.NewReader(`{}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "integration_config:view"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("view-only token must not resolve a credential: %T %v", err, err)
	}
}

func TestConsoleAvatarObjectRoutesRequireExactCapabilities(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(
		http.MethodGet,
		"/v1/console/oss/avatars?objectPath=avatars%2FC000001%2Fuser%2Fdigest.png",
		nil,
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:avatar-object:write"),
	)
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only token must not read an avatar: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodGet,
		"/v1/console/oss/avatars?objectPath=avatars%2FC000001%2Fuser%2Fdigest.png",
		nil,
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:avatar-object:read"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact avatar read capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPut,
		"/v1/console/oss/avatars?integrationCode=oss.default",
		strings.NewReader(`{"objectPath":"avatars/C000001/user/digest.png","contentType":"image/png","contentBase64":"cG5n"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:avatar-object:read"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("read-only token must not write an avatar: %T %v", err, err)
	}
}

func TestConsoleGitLabFixedOperationsRequireExactCapabilityAndIdempotency(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/gitlab.default/gitlab/markdown-tree",
		strings.NewReader(`{"repoPath":"group/project"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "aims", "credential_vault:resolve"),
	)
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("legacy resolve scope must not execute GitLab: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/gitlab.default/gitlab/markdown-tree",
		strings.NewReader(`{"repoPath":"group/project"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "aims", "integration_operations:execute"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact GitLab capability error=%T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/gitlab.default/gitlab/commit",
		strings.NewReader(`{"repoPath":"group/project"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "integration_operations:execute"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "idempotency_key_required" {
		t.Fatalf("GitLab commit without idempotency key error=%T %v", err, err)
	}
}

func TestConsoleWeComFixedOperationsRequireExactCapability(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/wecom.default/wecom/oauth-user",
		strings.NewReader(`{"code":"temporary-code"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "credential_vault:resolve"),
	)
	_, err := server.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("legacy resolve scope must not execute WeCom: %T %v", err, err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/v1/console/service/integrations/wecom.default/wecom/user-detail",
		strings.NewReader(`{"userid":"employee-1"}`),
	)
	request.Header.Set(
		"Authorization",
		"Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", "integration_operations:execute"),
	)
	_, err = server.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_adapter_disabled" {
		t.Fatalf("exact WeCom capability error=%T %v", err, err)
	}
}

func TestConsoleProfileRouteReturnsBoundTenantProfile(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name,legal_name").
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_code", "org_name", "org_short_name", "display_name", "legal_name",
			"unified_social_credit_code", "logo_path", "website_url", "industry_code",
			"country_code", "timezone", "locale", "currency_code", "contact_name",
			"contact_email", "contact_mobile", "address_text", "status", "revision", "updated_at",
		}).AddRow(
			"tenant-1", "Tenant One", nil, "Tenant One", nil,
			nil, nil, nil, nil, "CN", "Asia/Shanghai", "zh-CN", "CNY",
			nil, nil, nil, nil, "active", 1, time.Now().UTC(),
		))

	server := &Server{
		cfg:     cfg,
		auth:    auth.New(cfg),
		console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-1", database),
	}
	request := httptest.NewRequest(http.MethodGet, "/v1/console/profile", nil)
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "console", "console:org-profile:view"))
	result, err := server.route(request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Operation != "console.profile.read" || result.Auth == nil || result.Auth.Subject != "token-subject" {
		t.Fatalf("unexpected route result: %#v", result)
	}
	payload, ok := result.Body.(map[string]any)
	if !ok || payload["code"] != 0 {
		t.Fatalf("unexpected payload: %#v", result.Body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPeopleOffboardingRuntimeUsesExactResourceScopes(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
		want   string
	}{
		{http.MethodGet, "/v1/people/offboarding-cases", "people:offboarding_tasks:view"},
		{http.MethodGet, "/v1/people/offboarding-cases/OBC-1", "people:offboarding_tasks:view"},
		{http.MethodPost, "/v1/people/offboarding-cases", "people:offboarding_tasks:admin"},
		{http.MethodPost, "/v1/people/offboarding-tasks/OBT-1:confirm", "people:offboarding_tasks:confirm"},
		{http.MethodPost, "/v1/people/offboarding-tasks/OBT-1:cancel", "people:offboarding_tasks:cancel"},
	} {
		if got := peopleOffboardingRuntimeScope("people", tc.method, tc.path); got != tc.want {
			t.Fatalf("%s %s scope=%q want %q", tc.method, tc.path, got, tc.want)
		}
	}
	if got := peopleOffboardingRuntimeScope("assets", http.MethodGet, "/v1/people/offboarding-cases"); got != "" {
		t.Fatalf("cross-app scope mapping returned %q", got)
	}
}

func TestCommandShapedReadQueriesUseReadScope(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/members:list"); got != "aims.read" {
		t.Fatalf("members read scope=%q", got)
	}
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/workspace:view"); got != "aims.read" {
		t.Fatalf("product workspace read scope=%q", got)
	}
	if got := readOnlyAppRuntimeScope("codocs", http.MethodPost, "/v1/codocs/document-access/check"); got != "codocs.read" {
		t.Fatalf("document access check scope=%q want codocs.read", got)
	}
	if got := readOnlyAppRuntimeScope("people", http.MethodPost, "/v1/people/employees:search"); got != "people.read" {
		t.Fatalf("employee search scope=%q want people.read", got)
	}
	for _, tc := range []struct {
		appCode string
		method  string
		path    string
	}{
		{"codocs", http.MethodGet, "/v1/codocs/document-access/check"},
		{"codocs", http.MethodPost, "/v1/codocs/document-access/policies/doc-1"},
		{"aims", http.MethodPost, "/v1/codocs/document-access/check"},
		{"people", http.MethodPost, "/v1/people/employees"},
		{"aims", http.MethodPost, "/v1/aims/internal/products/P-A/workspace:edit"},
		{"aims", http.MethodPost, "/v1/aims/internal/products/P-A/members:create"},
		{"aims", http.MethodPost, "/v1/aims/internal/products/P-A/onboard"},
		{"aims", http.MethodPost, "/v1/aims/internal/products/P-A/nested/workspace:view"},
		{"aims", http.MethodPost, "/v1/aims/internal/products//workspace:view"},
	} {
		if got := readOnlyAppRuntimeScope(tc.appCode, tc.method, tc.path); got != "" {
			t.Fatalf("%s %s app=%s unexpectedly mapped to %q", tc.method, tc.path, tc.appCode, got)
		}
	}

	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(scope string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/codocs/document-access/check", strings.NewReader(`{"documentUuid":"12345678","action":"view"}`))
		req.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "codocs", scope))
		return req
	}

	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest("codocs.read"), "codocs", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("read scope result=%#v err=%v", result, err)
	}

	_, err = server.routeAppRuntime(newRequest("codocs.write"), "codocs", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only scope error=%T %v", err, err)
	}
}

func TestProductWorkspaceRequiresSignedUserDespiteForgedQuery(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.read aims:products:view")
	for _, signed := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/internal/products/P-A/workspace:view?current_user=u1&hzy_runtime_actor_delegated=1", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-HZY-Actor-Uid", "u1")
		if signed {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "u1", nil, signedAt))
		}
		_, err := server.routeAppRuntime(req, "aims", &aimsapp.Adapter{})
		var httpErr httperror.Error
		want := "product_user_actor_required"
		if signed {
			want = "invalid_product_input"
		} // passed the capability guard, no DB call without a decision envelope
		if !errors.As(err, &httpErr) || httpErr.Code != want {
			t.Fatalf("signed=%v: %v", signed, err)
		}
	}
}

func TestProductOnboardRequiresSignedUserDespiteForgedQuery(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.write aims:products:onboard")
	for _, signed := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/internal/products/P-A/onboard?current_user=u1&hzy_runtime_actor_delegated=1", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-HZY-Actor-Uid", "u1")
		if signed {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "u1", nil, signedAt))
		}
		_, err := server.routeAppRuntime(req, "aims", &aimsapp.Adapter{})
		var httpErr httperror.Error
		want := "product_user_actor_required"
		if signed {
			want = "invalid_product_input"
		} // passed the capability guard, no DB call without a decision envelope
		if !errors.As(err, &httpErr) || httpErr.Code != want {
			t.Fatalf("signed=%v: %v", signed, err)
		}
	}
}

func TestProductCatalogRequiresSignedUserDespiteForgedQuery(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.write aims:products:onboard")
	for _, signed := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/internal/product-catalog/start?current_user=u1&hzy_runtime_actor_delegated=1", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-HZY-Actor-Uid", "u1")
		if signed {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "u1", nil, signedAt))
		}
		_, err := server.routeAppRuntime(req, "aims", &aimsapp.Adapter{})
		var httpErr httperror.Error
		want := "product_user_actor_required"
		if signed {
			want = "invalid_product_input"
		} // passed the capability guard, no DB call without a decision envelope
		if !errors.As(err, &httpErr) || httpErr.Code != want {
			t.Fatalf("signed=%v: %v", signed, err)
		}
	}
}

func TestProductListRequiresSignedUserDespiteForgedQuery(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.read aims:products:view")
	for _, signed := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/internal/product-list?current_user=u1&hzy_runtime_actor_delegated=1", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-HZY-Actor-Uid", "u1")
		if signed {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "u1", nil, signedAt))
		}
		_, err := server.routeAppRuntime(req, "aims", &aimsapp.Adapter{})
		var httpErr httperror.Error
		want := "product_user_actor_required"
		if signed {
			want = "invalid_product_input"
		} // passed the capability guard, no DB call without a decision envelope
		if !errors.As(err, &httpErr) || httpErr.Code != want {
			t.Fatalf("signed=%v: %v", signed, err)
		}
	}
}

func TestPeopleEmployeeSearchRouteRequiresReadScope(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(scope string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/people/employees:search", strings.NewReader(`{"dept_codes":["D1"]}`))
		req.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "people", scope))
		return req
	}

	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest("people.read"), "people", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("read scope result=%#v err=%v", result, err)
	}
	if handler.method != http.MethodPost || handler.path != "/v1/people/employees:search" {
		t.Fatalf("handler method/path=%s %s", handler.method, handler.path)
	}

	_, err = server.routeAppRuntime(newRequest("people.write"), "people", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only scope error=%T %v", err, err)
	}
}

func TestPeopleOffboardingRouteRejectsLegacyTransportScopeAndInjectsExactScope(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	path := "/v1/people/offboarding-tasks/OBT-1:confirm"
	newRequest := func(scope string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"expectedVersion":"v1"}`))
		req.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, privateKey, "people", scope))
		return req
	}

	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest("data-runtime:people:offboarding_tasks:confirm"), "people", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("exact scope result=%#v err=%v", result, err)
	}
	if scopes := handler.query.Get("current_user_scopes"); !strings.Contains(scopes, "people:offboarding_tasks:confirm") {
		t.Fatalf("query scopes=%q", scopes)
	}

	_, err = server.routeAppRuntime(newRequest("people.write"), "people", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("legacy write scope error=%T %v", err, err)
	}
}

func TestPeopleHRSourceDepartmentRemapRequiresExactRuntimeClientAndSignedActor(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	path := "/v1/people/service/hr-source-sync/dingtalk/departments:remap"
	newRequest := func(appCode string, scope string, subject string, withActor bool) *http.Request {
		token := signTestRuntimeJWTForAppSubject(t, privateKey, appCode, scope, subject)
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"aliases":[{"aliasDeptCode":"DT-100","canonicalDeptCode":"DPT-RD"}]}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if withActor {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Uid", "people-admin-1")
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "people-admin-1", nil, signedAt))
		}
		return req
	}

	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest("people", peopleHRSourceDepartmentRemapScope, peopleHRSourceDepartmentRemapSubject, true), "people", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("exact remap identity result=%#v err=%v", result, err)
	}
	if handler.body["current_user"] != "people-admin-1" {
		t.Fatalf("signed actor not injected: %#v", handler.body)
	}

	_, err = server.routeAppRuntime(newRequest("people", "people.write", peopleHRSourceDepartmentRemapSubject, true), "people", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("generic people.write error=%T %v", err, err)
	}

	_, err = server.routeAppRuntime(newRequest("aims", peopleHRSourceDepartmentRemapScope, "client:aims.runtime", true), "people", &captureRuntimeHandler{})
	if !errors.As(err, &httpErr) || httpErr.Code != "source_app_mismatch" {
		t.Fatalf("wrong source app error=%T %v", err, err)
	}

	_, err = server.routeAppRuntime(newRequest("people", peopleHRSourceDepartmentRemapScope, "client:other.people", true), "people", &captureRuntimeHandler{})
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_people_hr_source_remap_client_required" {
		t.Fatalf("wrong client error=%T %v", err, err)
	}

	_, err = server.routeAppRuntime(newRequest("people", peopleHRSourceDepartmentRemapScope, peopleHRSourceDepartmentRemapSubject, false), "people", &captureRuntimeHandler{})
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_people_hr_source_remap_actor_required" {
		t.Fatalf("missing actor error=%T %v", err, err)
	}
}

func TestPeopleNotificationDetailAuthorizationIsPurposeProtected(t *testing.T) {
	if !isNotificationDetailAuthorizationRuntimePath("people", http.MethodPost, "/v1/people/notification-details/authorize") {
		t.Fatal("People notification detail authorization route is not protected")
	}
	if isNotificationDetailAuthorizationRuntimePath("people", http.MethodGet, "/v1/people/notification-details/authorize") {
		t.Fatal("GET must not be classified as notification detail authorization")
	}
}

func TestPeopleNotificationAuthorizationUsesReadScopeAndPurposeBoundSubject(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(token string, withPurpose bool) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/people/notification-details/authorize", strings.NewReader(`{"descriptor":{"resource":"offboarding_task","id":"OBT-1"}}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if withPurpose {
			signedAt := "1760000000000"
			purpose := "notification-detail-authorization"
			req.Header.Set("X-HZY-Actor-Uid", "task-owner")
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", purpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), "task-owner", nil, signedAt, purpose))
		}
		return req
	}

	readToken := signTestRuntimeJWTForApp(t, privateKey, "people", "people.read")
	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest(readToken, true), "people", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if handler.query.Get("current_user") != "task-owner" || handler.query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		t.Fatalf("query=%#v", handler.query)
	}

	_, err = server.routeAppRuntime(newRequest(readToken, false), "people", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_notification_actor_required" {
		t.Fatalf("missing purpose error=%T %v", err, err)
	}
	writeToken := signTestRuntimeJWTForApp(t, privateKey, "people", "people.write")
	_, err = server.routeAppRuntime(newRequest(writeToken, true), "people", &captureRuntimeHandler{})
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only token error=%T %v", err, err)
	}
}

func TestFinanceNotificationAuthorizationUsesReadScopeAndPurposeBoundSubject(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(token string, withPurpose bool) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/finance/notification-details/authorize", strings.NewReader(`{"descriptor":{"resource":"invoice_request","id":"IR-1"}}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if withPurpose {
			signedAt := "1760000000000"
			purpose := "notification-detail-authorization"
			req.Header.Set("X-HZY-Actor-Uid", "issuer-1")
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", purpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), "issuer-1", nil, signedAt, purpose))
		}
		return req
	}

	if !isNotificationDetailAuthorizationRuntimePath("finance", http.MethodPost, "/v1/finance/notification-details/authorize") {
		t.Fatal("Finance notification detail authorization route is not read/purpose protected")
	}
	readToken := signTestRuntimeJWTForApp(t, privateKey, "finance", "finance.read")
	_, query, err := server.financeNotificationDetailRuntimeAuth(newRequest(readToken, true))
	if err != nil {
		t.Fatalf("read token: %v", err)
	}
	if query.Get("current_user") != "issuer-1" || query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		t.Fatalf("query=%#v", query)
	}
	_, _, err = server.financeNotificationDetailRuntimeAuth(newRequest(readToken, false))
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_notification_actor_required" {
		t.Fatalf("missing purpose error=%T %v", err, err)
	}
	writeToken := signTestRuntimeJWTForApp(t, privateKey, "finance", "finance.write")
	_, _, err = server.financeNotificationDetailRuntimeAuth(newRequest(writeToken, true))
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only token error=%T %v", err, err)
	}
}

func TestFinanceRuntimeScopesRequireSignedActorAndServicePathsStayActorless(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	path := "/v1/finance/project-accounting?current_user=forged&current_user_project_finance_access=all&current_user_project_finance_project_codes=P9"
	token := signTestRuntimeJWTForApp(t, privateKey, "finance", "finance.project_accounting.read")
	unsigned := httptest.NewRequest(http.MethodGet, path, nil)
	unsigned.Header.Set("Authorization", "Bearer "+token)
	authCtx, err := server.auth.Authenticate(unsigned, auth.Requirement{AppCode: "finance", Scope: "finance.project_accounting.read"})
	if err != nil {
		t.Fatalf("authenticate unsigned request: %v", err)
	}
	if _, _, _, _, _, err := financeRuntimeQuery(unsigned, authCtx, "/v1/finance/project-accounting"); err == nil {
		t.Fatal("unsigned request with forged Finance scope was accepted")
	} else {
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Code != "trusted_finance_actor_required" {
			t.Fatalf("unsigned error=%T %v", err, err)
		}
	}

	signed := httptest.NewRequest(http.MethodGet, path, nil)
	signed.Header.Set("Authorization", "Bearer "+token)
	signedAt := "1760000000000"
	signed.Header.Set("X-HZY-Actor-Uid", "trusted-user")
	signed.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	signed.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, signed.Method, signed.URL.RequestURI(), "trusted-user", nil, signedAt))
	authCtx, err = server.auth.Authenticate(signed, auth.Requirement{AppCode: "finance", Scope: "finance.project_accounting.read"})
	if err != nil {
		t.Fatalf("authenticate signed request: %v", err)
	}
	query, _, _, _, delegated, err := financeRuntimeQuery(signed, authCtx, "/v1/finance/project-accounting")
	if err != nil || !delegated {
		t.Fatalf("signed Finance query delegated=%t err=%v", delegated, err)
	}
	if query.Get("current_user") != "trusted-user" || query.Get("current_user_project_finance_access") != "all" {
		t.Fatalf("trusted Finance query=%#v", query)
	}

	service := httptest.NewRequest(http.MethodGet, "/v1/finance/service/people-cost-parameters?current_user=forged&current_user_project_finance_access=all", nil)
	service.Header.Set("Authorization", "Bearer "+token)
	authCtx, err = server.auth.Authenticate(service, auth.Requirement{AppCode: "finance", Scope: "finance.project_accounting.read"})
	if err != nil {
		t.Fatalf("authenticate service request: %v", err)
	}
	query, actor, _, _, delegated, err := financeRuntimeQuery(service, authCtx, "/v1/finance/service/people-cost-parameters")
	if err != nil || delegated || actor != "" {
		t.Fatalf("service query actor=%q delegated=%t err=%v", actor, delegated, err)
	}
	if query.Get("current_user") != "" || query.Get("current_user_project_finance_access") != "" {
		t.Fatalf("service request retained forged Finance auth=%#v", query)
	}
}

func TestFinanceDueNotificationRuntimeRequiresDedicatedWorkerIdentityAndExactBody(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	path := "/v1/finance/service/notifications:acknowledge"
	exactRuntimeScope := "data-runtime:finance:notifications_due.execute"

	newRequest := func(scope, subject string, withWorkerAssertion bool) *http.Request {
		token := signTestRuntimeJWTForAppSubject(t, privateKey, "finance", scope, subject)
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"eventVersion":"v1:event","notificationId":"notice-1","recipientUid":"owner-1"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if withWorkerAssertion {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Uid", financeDueNotificationWorkerActor)
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", financeDueNotificationWorkerPurpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), financeDueNotificationWorkerActor, nil, signedAt, financeDueNotificationWorkerPurpose))
		}
		return req
	}

	_, err := server.financeDueNotificationRuntimeAuth(newRequest("finance.write", financeDueNotificationWorkerSubject, true))
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("generic Finance write token error=%T %v", err, err)
	}

	_, err = server.financeDueNotificationRuntimeAuth(newRequest(exactRuntimeScope, "client:other.runtime", true))
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_finance_due_worker_required" {
		t.Fatalf("wrong worker subject error=%T %v", err, err)
	}

	_, err = server.financeDueNotificationRuntimeAuth(newRequest(exactRuntimeScope, financeDueNotificationWorkerSubject, false))
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_finance_due_worker_required" {
		t.Fatalf("unsigned worker assertion error=%T %v", err, err)
	}

	if _, err = server.financeDueNotificationRuntimeAuth(newRequest(exactRuntimeScope, financeDueNotificationWorkerSubject, true)); err != nil {
		t.Fatalf("dedicated signed worker rejected: %v", err)
	}
	staticCfg := cfg
	staticCfg.Auth.Mode, staticCfg.Auth.StaticToken = config.AuthStaticToken, "static-runtime-token"
	staticServer := &Server{cfg: staticCfg, auth: auth.New(staticCfg)}
	staticRequest := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"eventVersion":"v1:event","notificationId":"notice-1","recipientUid":"owner-1"}`))
	staticRequest.Header.Set("Authorization", "Bearer static-runtime-token")
	_, err = staticServer.financeDueNotificationRuntimeAuth(staticRequest)
	if !errors.As(err, &httpErr) || httpErr.Code != "trusted_finance_due_worker_required" {
		t.Fatalf("static worker token error=%T %v", err, err)
	}
	if err := validateFinanceDueNotificationRuntimeBody(path, map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner-1"}); err != nil {
		t.Fatalf("valid due acknowledgement body rejected: %v", err)
	}
	if err := validateFinanceDueNotificationRuntimeBody(path, map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner-1", "current_user": "forged"}); err == nil {
		t.Fatal("worker acknowledgement accepted a forged runtime field")
	} else if !errors.As(err, &httpErr) || httpErr.Code != "finance_due_request_field_invalid" {
		t.Fatalf("unexpected strict-body error=%T %v", err, err)
	}
}

func TestOtherDueNotificationWorkersRejectModuleWriteAndForgedContext(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}

	for _, path := range []string{
		"/v1/aims/service/notifications:acknowledge",
		"/v1/altoc/service/notifications:acknowledge",
		"/v1/assets/service/notifications:acknowledge",
		"/v1/people/service/notifications:acknowledge",
	} {
		worker, ok := dueNotificationWorkerForPath(path)
		if !ok {
			t.Fatalf("worker missing for %s", path)
		}
		newRequest := func(scope, subject string, signed bool) *http.Request {
			token := signTestRuntimeJWTForAppSubject(t, privateKey, worker.AppCode, scope, subject)
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"eventVersion":"v1:event","notificationId":"notice-1","recipientUid":"owner-1"}`))
			req.Header.Set("Authorization", "Bearer "+token)
			if signed {
				signedAt := "1760000000000"
				req.Header.Set("X-HZY-Actor-Uid", worker.Actor)
				req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
				req.Header.Set("X-HZY-Actor-Purpose", worker.Purpose)
				req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), worker.Actor, nil, signedAt, worker.Purpose))
			}
			return req
		}
		if _, err := server.dueNotificationWorkerAuth(newRequest(worker.AppCode+".write", worker.Subject, true), worker); err == nil {
			t.Fatalf("%s accepted broad write scope", worker.AppCode)
		}
		exactRuntimeScope := "data-runtime:" + worker.AppCode + ":notifications_due.execute"
		if _, err := server.dueNotificationWorkerAuth(newRequest(exactRuntimeScope, "client:other.runtime", true), worker); err == nil {
			t.Fatalf("%s accepted the wrong service client", worker.AppCode)
		}
		if _, err := server.dueNotificationWorkerAuth(newRequest(exactRuntimeScope, worker.Subject, false), worker); err == nil {
			t.Fatalf("%s accepted unsigned worker context", worker.AppCode)
		}
		if _, err := server.dueNotificationWorkerAuth(newRequest(exactRuntimeScope, worker.Subject, true), worker); err != nil {
			t.Fatalf("%s rejected its dedicated worker: %v", worker.AppCode, err)
		}
		if err := validateDueNotificationWorkerBody(path, map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner-1", "current_user": "forged"}); err == nil {
			t.Fatalf("%s accepted forged runtime body field", worker.AppCode)
		}
	}
}

func TestWebDevRuntimeRequiresDelegatedUserActorAndRebuildsTrustedIdentity(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "webdev", "webdev.write")

	unsigned := httptest.NewRequest(http.MethodPost, "/v1/webdev/jobs?current_user=forged&tenant=other-tenant", strings.NewReader(`{
		"type":"git_diff",
		"createdBy":"forged-user",
		"tenant":"other-tenant"
	}`))
	unsigned.Header.Set("Authorization", "Bearer "+token)
	if _, err := server.routeWebDevRuntime(unsigned, &captureRuntimeHandler{}); err == nil {
		t.Fatal("unsigned WebDev user request was accepted")
	} else {
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Code != "trusted_webdev_actor_required" {
			t.Fatalf("unsigned error=%T %v", err, err)
		}
	}

	signed := httptest.NewRequest(http.MethodPost, "/v1/webdev/jobs?current_user=forged&tenant=other-tenant", strings.NewReader(`{
		"type":"git_diff",
		"createdBy":"forged-user",
		"tenant":"other-tenant"
	}`))
	signed.Header.Set("Authorization", "Bearer "+token)
	signedAt := "1760000000000"
	signed.Header.Set("X-HZY-Actor-Uid", "webdev-user")
	signed.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	signed.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, signed.Method, signed.URL.RequestURI(), "webdev-user", nil, signedAt))
	handler := &captureRuntimeHandler{}
	if _, err := server.routeWebDevRuntime(signed, handler); err != nil {
		t.Fatalf("signed WebDev request: %v", err)
	}
	if got := handler.query.Get("current_user"); got != "webdev-user" {
		t.Fatalf("trusted query actor=%q", got)
	}
	if got := handler.query.Get("hzy_runtime_tenant_code"); got != "tenant-1" {
		t.Fatalf("trusted query tenant=%q", got)
	}
	if got := handler.body["createdBy"]; got != "webdev-user" {
		t.Fatalf("createdBy=%#v, want trusted actor", got)
	}
	if _, ok := handler.body["tenant"]; ok {
		t.Fatalf("untrusted tenant body was forwarded: %#v", handler.body)
	}
	if got := handler.body["hzy_runtime_tenant_code"]; got != "tenant-1" {
		t.Fatalf("trusted body tenant=%#v", got)
	}
}

func TestWebDevRuntimeActorlessAllowlistIsLimitedToIssueServiceBridge(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	token := signTestRuntimeJWTForApp(t, privateKey, "webdev", "webdev.write")

	service := httptest.NewRequest(http.MethodPost, "/v1/webdev/service/issues/intake", strings.NewReader(`{"title":"reported","reporterUid":"source-user"}`))
	service.Header.Set("Authorization", "Bearer "+token)
	handler := &captureRuntimeHandler{}
	if _, err := server.routeWebDevRuntime(service, handler); err != nil {
		t.Fatalf("actorless Issue service bridge: %v", err)
	}
	if handler.query.Get("current_user") != "" || handler.body["current_user"] != nil {
		t.Fatalf("actorless service bridge inherited runtime service subject: query=%#v body=%#v", handler.query, handler.body)
	}
	if got := handler.body["reporterUid"]; got != "source-user" {
		t.Fatalf("service bridge reporter uid=%#v", got)
	}
	if got := handler.body["hzy_runtime_tenant_code"]; got != "tenant-1" {
		t.Fatalf("service bridge tenant=%#v", got)
	}

	if isWebDevRuntimeServicePath(http.MethodGet, "/v1/webdev/jobs") ||
		isWebDevRuntimeServicePath(http.MethodPost, "/v1/webdev/issues") ||
		isWebDevRuntimeServicePath(http.MethodDelete, "/v1/webdev/service/issues/ISS-1") ||
		!isWebDevRuntimeServicePath(http.MethodGet, "/v1/webdev/service/issues/mine") ||
		!isWebDevRuntimeServicePath(http.MethodGet, "/v1/webdev/service/issues/settings") ||
		!isWebDevRuntimeServicePath(http.MethodPost, "/v1/webdev/service/issues/ISS-1/claim") ||
		!isWebDevRuntimeServicePath(http.MethodPatch, "/v1/webdev/service/issues/ISS-1") ||
		!isWebDevRuntimeServicePath(http.MethodPost, "/v1/webdev/service/jobs") {
		t.Fatal("WebDev actorless allowlist is broader or narrower than the documented service bridge")
	}
}

func TestAltocNotificationAuthorizationRouteUsesReadScope(t *testing.T) {
	if !isNotificationDetailAuthorizationRuntimePath("altoc", http.MethodPost, "/v1/altoc/notification-details/authorize") {
		t.Fatal("Altoc notification detail authorization route is not read/purpose protected")
	}
	if isNotificationDetailAuthorizationRuntimePath("altoc", http.MethodGet, "/v1/altoc/notification-details/authorize") {
		t.Fatal("Altoc notification detail authorization must be POST only")
	}
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(scope string) *http.Request {
		token := signTestRuntimeJWTForApp(t, privateKey, "altoc", scope)
		req := httptest.NewRequest(http.MethodPost, "/v1/altoc/notification-details/authorize", strings.NewReader(`{"descriptor":{"resource":"receivable_plan","id":"RP-1"}}`))
		req.Header.Set("Authorization", "Bearer "+token)
		signedAt, purpose := "1760000000000", "notification-detail-authorization"
		req.Header.Set("X-HZY-Actor-Uid", "collector-1")
		req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
		req.Header.Set("X-HZY-Actor-Purpose", purpose)
		req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), "collector-1", nil, signedAt, purpose))
		return req
	}
	handler := &captureRuntimeHandler{}
	if _, err := server.routeAppRuntime(newRequest("altoc.read"), "altoc", handler); err != nil {
		t.Fatalf("read scope rejected: %v", err)
	}
	if handler.query.Get("current_user") != "collector-1" || handler.query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		t.Fatalf("trusted query=%#v", handler.query)
	}
	_, err := server.routeAppRuntime(newRequest("altoc.write"), "altoc", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only error=%T %v", err, err)
	}
}

func TestRuntimeQueryWithAuthOverwritesSpoofedAuthContext(t *testing.T) {
	source := url.Values{}
	source.Set("current_user", "spoof-user")
	source.Set("operator_uid", "spoof-operator")
	source.Set("actorUid", "spoof-actor")
	source.Set("current_user_scopes", "altoc.admin")
	source.Set("current_user_dept_codes", "BAD")
	source.Set("hzy_runtime_tenant_code", "evil-tenant")
	source.Set("hzyRuntimeDeploymentCode", "evil-deployment")
	source.Set("hzy_runtime_source_app", "evil-app")
	source.Set("hzy_runtime_service_client_id", "evil-client")
	source.Set("hzy_runtime_actor_purpose", "notification-detail-authorization")
	source.Set("hzy_runtime_actor_delegated", "1")
	source.Set("keyword", "keep-me")

	query := runtimeQueryWithAuth(source, auth.Context{
		Tenant:     "tenant-1",
		Deployment: "deployment-1",
		AppCode:    "altoc",
		Mode:       string(config.AuthJWT),
		Subject:    "token-subject",
		Scopes:     []string{"altoc.write"},
	}, "real-user", []string{"D1", "D2", "D1"})

	if got := query.Get("current_user"); got != "real-user" {
		t.Fatalf("current_user = %q, want real-user", got)
	}
	if got := query.Get("hzy_runtime_actor_purpose"); got != "" {
		t.Fatalf("unsigned actor purpose must be stripped, got %q", got)
	}
	if got := query.Get("hzy_runtime_actor_delegated"); got != "" {
		t.Fatalf("unsigned actor delegation marker must be stripped, got %q", got)
	}
	if got := query.Get("operator_uid"); got != "real-user" {
		t.Fatalf("operator_uid = %q, want real-user", got)
	}
	if got := query.Get("actorUid"); got != "" {
		t.Fatalf("spoofed actorUid must be stripped, got %q", got)
	}
	if got := query.Get("current_user_scopes"); got != "altoc.write" {
		t.Fatalf("current_user_scopes = %q, want altoc.write", got)
	}
	if got := query.Get("current_user_dept_code"); got != "D1" {
		t.Fatalf("current_user_dept_code = %q, want D1", got)
	}
	if got := query.Get("current_user_dept_codes"); got != "D1,D2" {
		t.Fatalf("current_user_dept_codes = %q, want D1,D2", got)
	}
	if got := query.Get("current_user_department_codes"); got != "D1,D2" {
		t.Fatalf("current_user_department_codes = %q, want D1,D2", got)
	}
	if got := query.Get("keyword"); got != "keep-me" {
		t.Fatalf("keyword = %q, want keep-me", got)
	}
	for key, want := range map[string]string{
		"hzy_runtime_tenant_code":       "tenant-1",
		"hzy_runtime_deployment_code":   "deployment-1",
		"hzy_runtime_source_app":        "altoc",
		"hzy_runtime_service_client_id": "token-subject",
	} {
		if got := query.Get(key); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
	if got := query.Get("hzyRuntimeDeploymentCode"); got != "" {
		t.Fatalf("spoof alias hzyRuntimeDeploymentCode survived as %q", got)
	}
}

func TestInjectRuntimeAuthBodyOverwritesSpoofedAuthContext(t *testing.T) {
	body := map[string]any{
		"current_user":                  "spoof-user",
		"operatorUid":                   "spoof-operator",
		"current_user_scopes":           []string{"altoc.admin"},
		"current_user_data_access":      "all",
		"current_user_altoc_access":     "all",
		"current_user_data_dept_codes":  "BAD",
		"current_user_altoc_dept_codes": "BAD",
		"currentUserDeptCodes":          "BAD",
		"current_user_department_codes": "BAD",
		"hzy_runtime_tenant_code":       "evil-tenant",
		"hzyRuntimeDeploymentCode":      "evil-deployment",
		"hzy_runtime_source_app":        "evil-app",
		"hzy_runtime_service_client_id": "evil-client",
		"hzy_runtime_actor_purpose":     "notification-detail-authorization",
		"name":                          "kept",
	}

	injectRuntimeAuthBody(body, auth.Context{
		Tenant:     "tenant-1",
		Deployment: "deployment-1",
		AppCode:    "altoc",
		Mode:       string(config.AuthJWT),
		Subject:    "token-subject",
		Scopes:     []string{"altoc.write"},
	}, "real-user", []string{"D1", "D2", "D1"})

	if got := body["current_user"]; got != "real-user" {
		t.Fatalf("current_user = %#v, want real-user", got)
	}
	if got := body["operator_uid"]; got != "real-user" {
		t.Fatalf("operator_uid = %#v, want real-user", got)
	}
	if _, ok := body["operatorUid"]; ok {
		t.Fatalf("operatorUid spoof key should be removed")
	}
	for _, key := range []string{
		"current_user_data_access",
		"current_user_altoc_access",
		"current_user_data_dept_codes",
		"current_user_altoc_dept_codes",
	} {
		if _, ok := body[key]; ok {
			t.Fatalf("%s spoof key should be removed", key)
		}
	}
	scopes, ok := body["current_user_scopes"].([]string)
	if !ok || len(scopes) != 1 || scopes[0] != "altoc.write" {
		t.Fatalf("current_user_scopes = %#v, want []string{altoc.write}", body["current_user_scopes"])
	}
	if got := body["current_user_dept_code"]; got != "D1" {
		t.Fatalf("current_user_dept_code = %#v, want D1", got)
	}
	if got := body["current_user_dept_codes"]; got != "D1,D2" {
		t.Fatalf("current_user_dept_codes = %#v, want D1,D2", got)
	}
	if got := body["current_user_department_codes"]; got != "D1,D2" {
		t.Fatalf("current_user_department_codes = %#v, want D1,D2", got)
	}
	if got := body["name"]; got != "kept" {
		t.Fatalf("name = %#v, want kept", got)
	}
	if _, ok := body["hzy_runtime_actor_purpose"]; ok {
		t.Fatal("unsigned actor purpose spoof key should be removed")
	}
	for key, want := range map[string]string{
		"hzy_runtime_tenant_code":       "tenant-1",
		"hzy_runtime_deployment_code":   "deployment-1",
		"hzy_runtime_source_app":        "altoc",
		"hzy_runtime_service_client_id": "token-subject",
	} {
		if got := body[key]; got != want {
			t.Fatalf("%s = %#v, want %q", key, got, want)
		}
	}
	if _, ok := body["hzyRuntimeDeploymentCode"]; ok {
		t.Fatal("spoof alias hzyRuntimeDeploymentCode should be removed")
	}
}

func TestRuntimeTrustedContextUsesVerifiedIdentityAndRequestID(t *testing.T) {
	body := map[string]any{
		"hzy_runtime_tenant_code": "spoofed",
		"hzy_runtime_request_id":  "spoofed",
	}
	setRuntimeTrustedBody(body, auth.Context{
		Tenant:     "tenant-1",
		Deployment: "deployment-1",
		AppCode:    "aims",
		Subject:    "service-client-1",
	}, "request-1")

	for key, want := range map[string]string{
		"hzy_runtime_tenant_code":       "tenant-1",
		"hzy_runtime_deployment_code":   "deployment-1",
		"hzy_runtime_source_app":        "aims",
		"hzy_runtime_service_client_id": "service-client-1",
		"hzy_runtime_request_id":        "request-1",
	} {
		if got := body[key]; got != want {
			t.Fatalf("%s = %#v, want %q", key, got, want)
		}
	}
}

func TestInjectRuntimeIdempotencyBodyFromHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/leads/1/convert", nil)
	req.Header.Set("Idempotency-Key", "convert-key-1")
	body := map[string]any{"name": "kept"}

	if err := injectRuntimeIdempotencyBody(req, body); err != nil {
		t.Fatalf("injectRuntimeIdempotencyBody returned error: %v", err)
	}
	if got := body["idempotency_key"]; got != "convert-key-1" {
		t.Fatalf("idempotency_key = %#v, want convert-key-1", got)
	}
	if got := body["name"]; got != "kept" {
		t.Fatalf("name = %#v, want kept", got)
	}
}

func TestInjectRuntimeIdempotencyBodyAllowsMatchingBodyKey(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/leads/1/convert", nil)
	req.Header.Set("Idempotency-Key", "convert-key-1")
	body := map[string]any{"idempotencyKey": "convert-key-1"}

	if err := injectRuntimeIdempotencyBody(req, body); err != nil {
		t.Fatalf("injectRuntimeIdempotencyBody returned error: %v", err)
	}
	if got := body["idempotency_key"]; got != "convert-key-1" {
		t.Fatalf("idempotency_key = %#v, want convert-key-1", got)
	}
}

func TestInjectRuntimeIdempotencyBodyRejectsConflictingBodyKey(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/leads/1/convert", nil)
	req.Header.Set("Idempotency-Key", "header-key")
	body := map[string]any{"idempotency_key": "body-key"}

	err := injectRuntimeIdempotencyBody(req, body)
	if err == nil {
		t.Fatal("injectRuntimeIdempotencyBody returned nil error")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("error = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusConflict || httpErr.Code != "idempotency_key_conflict" {
		t.Fatalf("http error = %d/%s, want 409/idempotency_key_conflict", httpErr.Status, httpErr.Code)
	}
}

func TestRuntimeSignedActorContext(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/altoc/leads?page=1", nil)
	token := "runtime-token"
	signedAt := "1760000000000"
	deptCodes := []string{"D1", "D2", "D3", "D0"}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-HZY-Actor-Uid", " real-user ")
	req.Header.Add("X-HZY-Actor-Dept-Codes", "D1,D2")
	req.Header.Add("X-HZY-Actor-Dept-Codes", "D2;D3")
	req.Header.Set("X-HZY-Actor-Dept-Code", "D0")
	req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "real-user", deptCodes, signedAt))

	actor, gotDeptCodes := runtimeActorContext(req, auth.Context{Subject: "token-subject"})
	if actor != "real-user" {
		t.Fatalf("actor = %q, want real-user", actor)
	}
	if len(gotDeptCodes) != len(deptCodes) {
		t.Fatalf("deptCodes = %#v, want %#v", gotDeptCodes, deptCodes)
	}
	for i := range deptCodes {
		if gotDeptCodes[i] != deptCodes[i] {
			t.Fatalf("deptCodes = %#v, want %#v", gotDeptCodes, deptCodes)
		}
	}
}

func TestRuntimeUnsignedActorHeadersIgnored(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/altoc/leads", nil)
	req.Header.Set("Authorization", "Bearer runtime-token")
	req.Header.Set("X-HZY-Actor-Uid", "spoof-user")
	req.Header.Set("X-HZY-Actor-Dept-Codes", "D1,D2")

	actor, deptCodes := runtimeActorContext(req, auth.Context{Subject: "token-subject"})
	if actor != "token-subject" {
		t.Fatalf("actor = %q, want token-subject", actor)
	}
	if len(deptCodes) != 0 {
		t.Fatalf("deptCodes = %#v, want empty", deptCodes)
	}
}

func TestRuntimePurposeBoundActorContext(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	req := httptest.NewRequest(http.MethodPost, "/v1/aims/notification-details/authorize", nil)
	token := "runtime-token"
	signedAt := "1760000000000"
	purpose := "notification-detail-authorization"
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-HZY-Actor-Uid", " notification-user ")
	req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	req.Header.Set("X-HZY-Actor-Purpose", purpose)
	req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(
		t, token, req.Method, req.URL.RequestURI(), "notification-user", nil, signedAt, purpose,
	))

	actor, deptCodes, gotPurpose := runtimeActorContextDetails(req, auth.Context{Subject: "aims.runtime"})
	if actor != "notification-user" || len(deptCodes) != 0 || gotPurpose != purpose {
		t.Fatalf("actor=%q deptCodes=%#v purpose=%q", actor, deptCodes, gotPurpose)
	}
	if !runtimeActorSignedAtValid("1759999940000", purpose) || runtimeActorSignedAtValid("1759999939999", purpose) {
		t.Fatal("notification actor past window must accept exactly 60 seconds and reject 60001ms")
	}
	if !runtimeActorSignedAtValid("1760000005000", purpose) || runtimeActorSignedAtValid("1760000005001", purpose) {
		t.Fatal("notification actor future skew must accept exactly 5 seconds and reject 5001ms")
	}
	if !runtimeActorSignedAtValid("1759999700000", "") {
		t.Fatal("ordinary actor compatibility must retain its five-minute window")
	}
}

func TestRuntimePurposeBoundActorTamperingAndExpiryFallBackWithoutPurpose(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	token := "runtime-token"
	purpose := "notification-detail-authorization"

	tests := []struct {
		name          string
		requestTarget string
		signedAt      string
		signedPurpose string
		headerPurpose string
	}{
		{name: "purpose tamper", requestTarget: "/v1/aims/notification-details/authorize", signedAt: "1760000000000", signedPurpose: purpose, headerPurpose: "different-purpose"},
		{name: "path tamper", requestTarget: "/v1/aims/work-items/42", signedAt: "1760000000000", signedPurpose: purpose, headerPurpose: purpose},
		{name: "expired", requestTarget: "/v1/aims/notification-details/authorize", signedAt: "1759999939999", signedPurpose: purpose, headerPurpose: purpose},
		{name: "too far future", requestTarget: "/v1/aims/notification-details/authorize", signedAt: "1760000005001", signedPurpose: purpose, headerPurpose: purpose},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/aims/notification-details/authorize", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-HZY-Actor-Uid", "notification-user")
			req.Header.Set("X-HZY-Actor-Signed-At", test.signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", test.headerPurpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(
				t, token, req.Method, test.requestTarget, "notification-user", nil, test.signedAt, test.signedPurpose,
			))

			actor, deptCodes, gotPurpose := runtimeActorContextDetails(req, auth.Context{Subject: "aims.runtime"})
			if actor != "aims.runtime" || len(deptCodes) != 0 || gotPurpose != "" {
				t.Fatalf("invalid actor must not retain purpose: actor=%q deptCodes=%#v purpose=%q", actor, deptCodes, gotPurpose)
			}
		})
	}
}

func TestAimsNotificationAuthorizationRouteRejectsMissingOrInvalidPurposeBeforeAdapter(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	handler := &captureRuntimeHandler{}
	token := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.read")

	for _, purpose := range []string{"", "different-purpose"} {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/notification-details/authorize", strings.NewReader(`{"stage":"prepare"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if purpose != "" {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Uid", "notification-user")
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", purpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(
				t, token, req.Method, req.URL.RequestURI(), "notification-user", nil, signedAt, purpose,
			))
		}
		_, err := server.routeAppRuntime(req, "aims", handler)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_notification_actor_required" {
			t.Fatalf("purpose=%q error=%T %v", purpose, err, err)
		}
	}
	if handler.method != "" {
		t.Fatalf("invalid notification actor must be rejected before adapter, got method=%s", handler.method)
	}
}

func TestAimsNotificationAuthorizationRouteUsesReadScopeAndInjectsPurposeBoundSubject(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	readToken := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.read")
	newRequest := func(token string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/aims/notification-details/authorize", strings.NewReader(`{"stage":"prepare"}`))
		signedAt := "1760000000000"
		purpose := "notification-detail-authorization"
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-HZY-Actor-Uid", "notification-user")
		req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
		req.Header.Set("X-HZY-Actor-Purpose", purpose)
		req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(
			t, token, req.Method, req.URL.RequestURI(), "notification-user", nil, signedAt, purpose,
		))
		return req
	}

	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest(readToken), "aims", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if handler.query.Get("current_user") != "notification-user" || handler.query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		t.Fatalf("query=%#v", handler.query)
	}
	if handler.body["current_user"] != "notification-user" || handler.body["hzy_runtime_actor_purpose"] != "notification-detail-authorization" {
		t.Fatalf("body=%#v", handler.body)
	}

	writeOnlyToken := signTestRuntimeJWTForApp(t, privateKey, "aims", "aims.write")
	_, err = server.routeAppRuntime(newRequest(writeOnlyToken), "aims", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only token error=%T %v", err, err)
	}
}

func TestAssetsNotificationAuthorizationRouteUsesReadScopeAndRequiresPurpose(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	newRequest := func(token string, withPurpose bool) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/assets/notification-details/authorize", strings.NewReader(`{"descriptor":{"resource":"asset_item","id":"AST-001"}}`))
		req.Header.Set("Authorization", "Bearer "+token)
		if withPurpose {
			signedAt := "1760000000000"
			purpose := "notification-detail-authorization"
			req.Header.Set("X-HZY-Actor-Uid", "asset-owner")
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", purpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, token, req.Method, req.URL.RequestURI(), "asset-owner", nil, signedAt, purpose))
		}
		return req
	}

	readToken := signTestRuntimeJWTForApp(t, privateKey, "assets", "assets.read")
	handler := &captureRuntimeHandler{}
	result, err := server.routeAppRuntime(newRequest(readToken, true), "assets", handler)
	if err != nil || result.Operation != "test.runtime" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if handler.query.Get("current_user") != "asset-owner" || handler.query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		t.Fatalf("query=%#v", handler.query)
	}

	_, err = server.routeAppRuntime(newRequest(readToken, false), "assets", &captureRuntimeHandler{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_notification_actor_required" {
		t.Fatalf("missing purpose error=%T %v", err, err)
	}

	writeToken := signTestRuntimeJWTForApp(t, privateKey, "assets", "assets.write")
	_, err = server.routeAppRuntime(newRequest(writeToken, true), "assets", &captureRuntimeHandler{})
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "insufficient_scope" {
		t.Fatalf("write-only token error=%T %v", err, err)
	}
}

func TestRouteAppRuntimeInjectsJWTActorScopesAndIdempotency(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	handler := &captureRuntimeHandler{}
	token := signTestRuntimeJWT(t, privateKey, "tenant-runtime:altoc:write altoc:lead:convert")
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/leads/1/convert?current_user=spoof-user&hzy_runtime_actor_delegated=0&keyword=keep-me", strings.NewReader(`{
		"name": "kept",
		"current_user": "spoof-user",
		"operatorUid": "spoof-operator",
		"current_user_scopes": ["altoc.admin"],
		"current_user_dept_codes": "BAD",
		"idempotencyKey": "convert-key-1"
	}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Idempotency-Key", "convert-key-1")
	signedAt := "1760000000000"
	deptCodes := []string{"D1", "D2"}
	req.Header.Set("X-HZY-Actor-Uid", " real-user ")
	req.Header.Set("X-HZY-Actor-Dept-Codes", strings.Join(deptCodes, ","))
	req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
	req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, req.Method, req.URL.RequestURI(), "real-user", deptCodes, signedAt))

	result, err := server.routeAppRuntime(req, "altoc", handler)
	if err != nil {
		t.Fatalf("routeAppRuntime returned error: %v", err)
	}
	if result.Operation != "test.runtime" {
		t.Fatalf("operation = %q, want test.runtime", result.Operation)
	}
	if handler.method != http.MethodPost || handler.path != "/v1/altoc/leads/1/convert" {
		t.Fatalf("handler route = %s %s, want POST /v1/altoc/leads/1/convert", handler.method, handler.path)
	}
	if got := handler.query.Get("current_user"); got != "real-user" {
		t.Fatalf("query current_user = %q, want real-user", got)
	}
	if got := handler.query.Get("hzy_runtime_actor_delegated"); got != "1" {
		t.Fatalf("query trusted actor delegation = %q, want 1", got)
	}
	if got := handler.query.Get("current_user_scopes"); got != "tenant-runtime:altoc:write altoc:lead:convert" {
		t.Fatalf("query current_user_scopes = %q, want transport and resource scopes", got)
	}
	if got := handler.query.Get("current_user_dept_codes"); got != "D1,D2" {
		t.Fatalf("query dept codes = %q, want D1,D2", got)
	}
	if got := handler.query.Get("keyword"); got != "keep-me" {
		t.Fatalf("query keyword = %q, want keep-me", got)
	}
	if got := handler.body["current_user"]; got != "real-user" {
		t.Fatalf("body current_user = %#v, want real-user", got)
	}
	if _, ok := handler.body["operatorUid"]; ok {
		t.Fatal("spoofed operatorUid should be removed from body")
	}
	scopes, ok := handler.body["current_user_scopes"].([]string)
	if !ok || len(scopes) != 2 || scopes[0] != "tenant-runtime:altoc:write" || scopes[1] != "altoc:lead:convert" {
		t.Fatalf("body scopes = %#v, want transport plus resource action scopes", handler.body["current_user_scopes"])
	}
	if stringInSlice(scopes, "altoc.admin") {
		t.Fatalf("jwt mode must not inject altoc.admin, got %#v", scopes)
	}
	if got := handler.body["current_user_dept_codes"]; got != "D1,D2" {
		t.Fatalf("body dept codes = %#v, want D1,D2", got)
	}
	if got := handler.body["idempotency_key"]; got != "convert-key-1" {
		t.Fatalf("body idempotency_key = %#v, want convert-key-1", got)
	}
	if got := handler.body["name"]; got != "kept" {
		t.Fatalf("body name = %#v, want kept", got)
	}
}

type captureRuntimeHandler struct {
	method string
	path   string
	query  url.Values
	body   map[string]any
}

func (h *captureRuntimeHandler) HandleRuntime(_ context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	h.method = method
	h.path = path
	h.query = cloneURLValues(query)
	h.body = cloneMap(body)
	return map[string]any{"ok": true}, "test.runtime", nil
}

func cloneURLValues(values url.Values) url.Values {
	result := make(url.Values, len(values))
	for key, items := range values {
		result[key] = append([]string(nil), items...)
	}
	return result
}

func cloneMap(values map[string]any) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func testRuntimeJWTConfig(t *testing.T) (config.Config, ed25519.PrivateKey) {
	t.Helper()

	publicKey, privateKey, err := ed25519.GenerateKey(cryptorand.Reader)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	jwks, err := json.Marshal(map[string]any{
		"keys": []map[string]any{
			{
				"kty": "OKP",
				"kid": "test-key",
				"alg": "EdDSA",
				"use": "sig",
				"crv": "Ed25519",
				"x":   base64.RawURLEncoding.EncodeToString(publicKey),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}
	return config.Config{
		Tenant:     "tenant-1",
		Deployment: "deployment-1",
		Auth: config.AuthConfig{
			Mode: config.AuthJWT,
			JWT: config.JWTConfig{
				Audience: "data-runtime",
				JWKSJSON: string(jwks),
			},
		},
	}, privateKey
}

func signTestRuntimeJWT(t *testing.T, privateKey ed25519.PrivateKey, scope string) string {
	return signTestRuntimeJWTForApp(t, privateKey, "altoc", scope)
}

func signTestRuntimeJWTForApp(t *testing.T, privateKey ed25519.PrivateKey, appCode string, scope string) string {
	return signTestRuntimeJWTForAppSubject(t, privateKey, appCode, scope, "token-subject")
}

func signTestRuntimeJWTForAppSubject(t *testing.T, privateKey ed25519.PrivateKey, appCode string, scope string, subject string) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"aud":        "data-runtime",
		"tenant":     "tenant-1",
		"deployment": "deployment-1",
		"app_code":   appCode,
		"token_use":  "service",
		"sub":        subject,
		"scope":      scope,
		"exp":        time.Now().Add(time.Hour).Unix(),
		"iat":        time.Now().Add(-time.Minute).Unix(),
	})
	token.Header["kid"] = "test-key"
	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return tokenString
}

func testActorSignature(t *testing.T, token string, method string, requestTarget string, actorUID string, deptCodes []string, signedAt string) string {
	t.Helper()
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })

	payload := strings.Join([]string{
		method,
		requestTarget,
		strings.TrimSpace(actorUID),
		strings.Join(deptCodes, ","),
		signedAt,
	}, "\n")
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func testActorSignatureWithPurpose(t *testing.T, token string, method string, requestTarget string, actorUID string, deptCodes []string, signedAt string, purpose string) string {
	t.Helper()
	payload := strings.Join([]string{
		method,
		requestTarget,
		strings.TrimSpace(actorUID),
		strings.Join(deptCodes, ","),
		signedAt,
		purpose,
	}, "\n")
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestProductRequestReadTransportScope(t *testing.T) {
	for _, suffix := range []string{"versions:execution-coordination", "versions:list", "versions:view", "versions:scope-list", "components:list", "objectives:list", "objectives:view", "objectives:observations", "objectives:items", "objectives:cycles", "priority-models:list", "reach-observations:list", "reach-observations:view", "roadmap-views:list", "roadmap-views:view", "roadmap-views:apply", "roadmaps:window-view", "roadmaps:quarter-view", "roadmaps:commitments", "roadmaps:cross-snapshots", "roadmaps:cross-snapshot-targets", "cross-dependencies:targets", "cross-dependencies:list", "cross-dependencies:view", "versions:scope-history", "versions:release-view", "versions:release-list", "versions:acceptance-preview", "versions:acceptance-list", "versions:acceptance-view", "handoff-project:authorization", "feature-unscheduled:view", "feature-roadmap:view", "planning-feature:view", "feature-requests:list", "features:list", "features:view", "requests:list", "requests:view", "request-sources:list", "planning-items:list", "planning-items:view", "planning-cycles:list", "planning-cycles:view", "planning-candidates:list", "planning-assessments:list", "planning-comments:history", "planning-comments:list", "planning-reviews:list", "planning-observations:list", "planning-observations:view", "planning-budget:preview", "planning-withdrawal:preview", "planning-consumption:view", "planning-queue:preview", "planning-matrix:view", "planning-capacity:view", "planning-selection:preview", "planning-dependencies:view"} {
		path := "/v1/aims/internal/products/P-A/" + suffix
		if got := readOnlyAppRuntimeScope("aims", http.MethodPost, path); got != "aims.read" {
			t.Fatalf("%s: %s", path, got)
		}
		if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/nested/"+suffix); got != "" {
			t.Fatalf("nested read accepted: %s", got)
		}
	}
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/requests:create"); got != "" {
		t.Fatalf("create treated as read: %s", got)
	}
}

func TestPlanningCreateIsNotReadOnlyTransport(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/planning-items:create"); got != "" {
		t.Fatalf("create treated as read: %s", got)
	}
}

func TestPlanningConsumptionConfirmationIsNotReadOnlyTransport(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/planning-consumption:confirm"); got != "" {
		t.Fatalf("confirmation treated as read: %s", got)
	}
}

func TestFeatureCreateIsNotReadOnlyTransport(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/features:create"); got != "" {
		t.Fatalf("feature creation treated as read: %s", got)
	}
}

func TestFeatureRequestChangeIsNotReadOnly(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/feature-requests:change"); got != "" {
		t.Fatalf("relation mutation read-only: %s", got)
	}
}

func TestPlanningFeatureChangeIsNotReadOnly(t *testing.T) {
	if got := readOnlyAppRuntimeScope("aims", http.MethodPost, "/v1/aims/internal/products/P-A/planning-feature:change"); got != "" {
		t.Fatalf("binding mutation read-only: %s", got)
	}
}

func TestProductDocumentMetadataReadTransport(t *testing.T) {
	path := "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/metadata"
	if scope := readOnlyAppRuntimeScope("codocs", http.MethodPost, path); scope != "codocs.read" {
		t.Fatalf("metadata scope %s", scope)
	}
	if scope := readOnlyAppRuntimeScope("codocs", http.MethodPost, path+"/write"); scope != "" {
		t.Fatalf("write classified read %s", scope)
	}
}

func TestProductDocumentCandidateReadTransport(t *testing.T) {
	path := "/v1/aims/internal/products/P/documents:list"
	if got := readOnlyAppRuntimeScope("aims", "POST", path); got != "aims.read" {
		t.Fatalf("read scope: %q", got)
	}
	if got := readOnlyAppRuntimeScope("aims", "POST", path+"/write"); got != "" {
		t.Fatalf("unexpected read scope: %q", got)
	}
}

func TestProductDocumentSearchReadTransport(t *testing.T) {
	path := "/v1/codocs/service/product-documents/search"
	if got := readOnlyAppRuntimeScope("codocs", "POST", path); got != "codocs.read" {
		t.Fatalf("read %s", got)
	}
	if got := readOnlyAppRuntimeScope("codocs", "POST", path+"/write"); got != "" {
		t.Fatalf("write %s", got)
	}
}

func TestProductDocumentContentReadTransport(t *testing.T) {
	path := "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/content"
	if scope := readOnlyAppRuntimeScope("codocs", http.MethodPost, path); scope != "codocs.read" {
		t.Fatalf("metadata scope %s", scope)
	}
	if scope := readOnlyAppRuntimeScope("codocs", http.MethodPost, path+"/write"); scope != "" {
		t.Fatalf("write classified read %s", scope)
	}
}

func TestRuntimeTrustedContextUsesVerifiedClientIDRatherThanJWTSubject(t *testing.T) {
	ctx := auth.Context{Tenant: "C000001", Deployment: "C000001-test-assets", AppCode: "assets", Subject: "client:assets.runtime", ClientID: "assets.runtime"}
	query := url.Values{"hzy_runtime_service_client_id": {"forged.runtime"}}
	setRuntimeTrustedQuery(query, ctx, "request-1")
	if got := query.Get("hzy_runtime_service_client_id"); got != "assets.runtime" {
		t.Fatalf("client identity = %q", got)
	}
	body := map[string]any{"hzy_runtime_service_client_id": "forged.runtime"}
	setRuntimeTrustedBody(body, ctx, "request-1")
	if got := body["hzy_runtime_service_client_id"]; got != "assets.runtime" {
		t.Fatalf("body client identity = %v", got)
	}
}
