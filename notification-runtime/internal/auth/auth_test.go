package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

func TestHasScopeRequiresExactNotificationCapability(t *testing.T) {
	required := "notification-runtime:send"

	cases := []struct {
		name   string
		scopes []string
		want   bool
	}{
		{name: "exact", scopes: []string{"notification-runtime:send"}, want: true},
		{name: "exact among many", scopes: []string{"integration_config:view", "notification-runtime:send"}, want: true},
		{name: "global wildcard rejected", scopes: []string{"*"}, want: false},
		{name: "resource wildcard rejected", scopes: []string{"notification-runtime:*"}, want: false},
		{name: "other notification action rejected", scopes: []string{"notification-runtime:admin"}, want: false},
		{name: "other runtime capability rejected", scopes: []string{"workflow:callback"}, want: false},
		{name: "empty rejected", scopes: nil, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasScope(tc.scopes, required); got != tc.want {
				t.Fatalf("hasScope(%v, %q) = %v, want %v", tc.scopes, required, got, tc.want)
			}
		})
	}
}

func TestJWKSClientUsesIsolatedHTTP11Transport(t *testing.T) {
	client := newJWKSHTTPClient(3 * time.Second)
	if client.Timeout != 3*time.Second {
		t.Fatalf("timeout = %s, want 3s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatal("JWKS transport must not force HTTP/2")
	}
	if transport.TLSNextProto == nil || len(transport.TLSNextProto) != 0 {
		t.Fatal("JWKS transport must explicitly disable HTTP/2 negotiation")
	}
	if transport.TLSClientConfig == nil || len(transport.TLSClientConfig.NextProtos) != 1 || transport.TLSClientConfig.NextProtos[0] != "http/1.1" {
		t.Fatal("JWKS transport must advertise only HTTP/1.1 through TLS ALPN")
	}
}

func TestDeliveryReadAndReconcileScopesAreNotInterchangeable(t *testing.T) {
	read := "notification-runtime:deliveries:read"
	reconcile := "notification-runtime:deliveries:reconcile"
	if !hasScope([]string{read}, read) || !hasScope([]string{reconcile}, reconcile) {
		t.Fatal("exact delivery scope was rejected")
	}
	if hasScope([]string{read}, reconcile) || hasScope([]string{reconcile}, read) || hasScope([]string{"notification-runtime:send"}, read) {
		t.Fatal("delivery scopes were incorrectly implied by another capability")
	}
}

func TestRequireServiceTokenUse(t *testing.T) {
	if err := requireServiceTokenUse("service"); err != nil {
		t.Fatalf("requireServiceTokenUse(service) returned error: %v", err)
	}

	rejected := []struct {
		name     string
		tokenUse string
	}{
		{name: "missing", tokenUse: ""},
		{name: "user", tokenUse: "user"},
		{name: "refresh", tokenUse: "refresh"},
		{name: "wrong case", tokenUse: "SERVICE"},
	}

	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			if err := requireServiceTokenUse(tc.tokenUse); err == nil {
				t.Fatalf("requireServiceTokenUse(%q) returned nil, want error", tc.tokenUse)
			}
		})
	}
}

func TestValidateJWTClaimsBindsTrustedRuntimeIdentity(t *testing.T) {
	cfg := config.Config{Tenant: "C000001", Deployment: "prod"}
	tokenClaims := &claims{
		TenantCode: "C000001",
		Deployment: "prod",
		ClientID:   "aims-runtime-client",
		TokenUse:   "service",
		Scope:      "notification-runtime:send integration_config:view",
		HZY:        hzyClaims{AppCode: " AIMS "},
	}
	tokenClaims.Subject = "client:aims.runtime"

	actor, err := validateJWTClaims(cfg, tokenClaims, Requirement{Scope: "notification-runtime:send"})
	if err != nil {
		t.Fatalf("validateJWTClaims returned error: %v", err)
	}
	if actor.Tenant != "C000001" || actor.Deployment != "prod" || actor.SourceApp != "aims" {
		t.Fatalf("trusted identity = tenant:%q deployment:%q source:%q", actor.Tenant, actor.Deployment, actor.SourceApp)
	}
	if actor.ClientID != "aims-runtime-client" || actor.Subject != "client:aims.runtime" {
		t.Fatalf("client identity = client:%q subject:%q", actor.ClientID, actor.Subject)
	}
}

func TestValidateJWTClaimsConnectorAcceptsAuthorizedTenantDeployment(t *testing.T) {
	cfg := config.Config{
		Tenant:     "C000001",
		Deployment: "C000001-console",
		Auth: config.AuthConfig{
			AllowTenantServiceDeployments: true,
		},
	}
	tokenClaims := &claims{
		TenantCode: "C000001",
		Deployment: "C000001-aims",
		ClientID:   "aims-runtime-client",
		TokenUse:   "service",
		Scope:      "connector-runtime:notifications:send",
		HZY:        hzyClaims{AppCode: "aims"},
	}
	tokenClaims.Subject = "client:aims.runtime"

	actor, err := validateJWTClaims(cfg, tokenClaims, Requirement{Scope: "connector-runtime:notifications:send"})
	if err != nil {
		t.Fatalf("validateJWTClaims returned error: %v", err)
	}
	if actor.Tenant != "C000001" || actor.Deployment != "C000001-aims" || actor.SourceApp != "aims" {
		t.Fatalf("trusted identity = tenant:%q deployment:%q source:%q", actor.Tenant, actor.Deployment, actor.SourceApp)
	}
}

func TestValidateJWTClaimsConnectorStillRejectsAnotherTenant(t *testing.T) {
	cfg := config.Config{
		Tenant:     "C000001",
		Deployment: "C000001-console",
		Auth: config.AuthConfig{
			AllowTenantServiceDeployments: true,
		},
	}
	tokenClaims := &claims{
		TenantCode: "C999999",
		Deployment: "C999999-aims",
		ClientID:   "aims-runtime-client",
		TokenUse:   "service",
		Scope:      "connector-runtime:notifications:send",
		HZY:        hzyClaims{AppCode: "aims"},
	}

	_, err := validateJWTClaims(cfg, tokenClaims, Requirement{Scope: "connector-runtime:notifications:send"})
	var httpError *httperror.Error
	if !errors.As(err, &httpError) || httpError.Code != "tenant_mismatch" {
		t.Fatalf("error = %#v, want tenant_mismatch", err)
	}
}

func TestValidateJWTClaimsRejectsUnboundRuntimeIdentity(t *testing.T) {
	cfg := config.Config{Tenant: "C000001", Deployment: "prod"}
	valid := claims{
		TenantCode: "C000001",
		Deployment: "prod",
		ClientID:   "aims-runtime-client",
		TokenUse:   "service",
		Scope:      "notification-runtime:send",
		HZY:        hzyClaims{AppCode: "aims"},
	}

	cases := []struct {
		name   string
		mutate func(*claims)
		code   string
	}{
		{name: "missing tenant", mutate: func(c *claims) { c.TenantCode = "" }, code: "missing_tenant_claim"},
		{name: "conflicting tenant aliases", mutate: func(c *claims) { c.TenantCodeAlt = "C999999" }, code: "tenant_claim_conflict"},
		{name: "wrong tenant", mutate: func(c *claims) { c.TenantCode = "C999999" }, code: "tenant_mismatch"},
		{name: "missing deployment", mutate: func(c *claims) { c.Deployment = "" }, code: "missing_deployment_claim"},
		{name: "conflicting deployment aliases", mutate: func(c *claims) { c.DeploymentJSON = "staging" }, code: "deployment_claim_conflict"},
		{name: "wrong deployment", mutate: func(c *claims) { c.Deployment = "staging" }, code: "deployment_mismatch"},
		{name: "missing source app", mutate: func(c *claims) { c.HZY.AppCode = "" }, code: "missing_source_app_claim"},
		{name: "conflicting source aliases", mutate: func(c *claims) { c.AppCodeAlt = "workflow" }, code: "source_app_claim_conflict"},
		{name: "missing client id", mutate: func(c *claims) { c.ClientID = "" }, code: "missing_client_id_claim"},
		{name: "missing scope", mutate: func(c *claims) { c.Scope = "integration_config:view" }, code: "insufficient_scope"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := valid
			tc.mutate(&candidate)
			_, err := validateJWTClaims(cfg, &candidate, Requirement{Scope: "notification-runtime:send"})
			var httpError *httperror.Error
			if !errors.As(err, &httpError) || httpError.Code != tc.code {
				t.Fatalf("error = %#v, want httperror code %q", err, tc.code)
			}
		})
	}
}

func TestRequireActiveServiceTokenPostsTokenAndFailsClosed(t *testing.T) {
	var sawTenant string
	var sawDeployment string
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/oauth/introspect" {
			t.Fatalf("request = %s %s", r.Method, r.URL.String())
		}
		if r.URL.RawQuery != "" {
			t.Fatalf("token or query data appeared in introspection URL: %s", r.URL.String())
		}
		if contentType := r.Header.Get("Content-Type"); contentType != "application/x-www-form-urlencoded" {
			t.Fatalf("content-type = %q", contentType)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("ParseForm: %v", err)
		}
		sawTenant = r.Header.Get("X-Hzy-Tenant")
		sawDeployment = r.Header.Get("X-Hzy-Deployment")
		switch r.Form.Get("token") {
		case "active-token":
			_, _ = w.Write([]byte(`{"active":true}`))
		case "inactive-token":
			_, _ = w.Write([]byte(`{"active":false}`))
		case "control-error-token":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`control plane unavailable`))
		case "invalid-json-token":
			_, _ = w.Write([]byte(`not-json`))
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	t.Cleanup(control.Close)
	authenticator := New(config.Config{
		Tenant:     "C000001",
		Deployment: "prod",
		Console: config.ConsoleConfig{
			BaseURL: control.URL,
			Timeout: time.Second,
		},
	})

	if err := authenticator.requireActiveServiceToken(context.Background(), "active-token"); err != nil {
		t.Fatalf("active token returned error: %v", err)
	}
	if sawTenant != "C000001" || sawDeployment != "prod" {
		t.Fatalf("introspection context headers = tenant:%q deployment:%q", sawTenant, sawDeployment)
	}

	cases := []struct {
		token  string
		status int
		code   string
	}{
		{token: "inactive-token", status: http.StatusUnauthorized, code: "inactive_service_token"},
		{token: "unknown-token", status: http.StatusUnauthorized, code: "inactive_service_token"},
		{token: "control-error-token", status: http.StatusServiceUnavailable, code: "service_token_introspection_unavailable"},
		{token: "invalid-json-token", status: http.StatusServiceUnavailable, code: "service_token_introspection_unavailable"},
	}
	for _, tc := range cases {
		t.Run(strings.TrimSuffix(tc.token, "-token"), func(t *testing.T) {
			err := authenticator.requireActiveServiceToken(context.Background(), tc.token)
			var httpError *httperror.Error
			if !errors.As(err, &httpError) || httpError.Status != tc.status || httpError.Code != tc.code {
				t.Fatalf("error = %#v, want %d/%s", err, tc.status, tc.code)
			}
		})
	}

	control.Close()
	err := authenticator.requireActiveServiceToken(context.Background(), "network-error-token")
	var httpError *httperror.Error
	if !errors.As(err, &httpError) || httpError.Status != http.StatusServiceUnavailable || httpError.Code != "service_token_introspection_unavailable" {
		t.Fatalf("network error = %#v, want 503/service_token_introspection_unavailable", err)
	}
}
