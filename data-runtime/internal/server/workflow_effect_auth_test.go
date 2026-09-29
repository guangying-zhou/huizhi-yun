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
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWorkflowEffectServiceAuthenticationMatrix(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "workflow-effect-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "C000001", Deployment: "runtime-test", DeploymentBindings: map[string]string{"workflow": "workflow-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	const scheduler = workflowIntegrationOperationScope
	makeRequest := func(changes map[string]any) *http.Request {
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:workflow.runtime", "tenant": "C000001", "deployment": "workflow-test", "source_app": "workflow", "target_app": "data-runtime", "client_id": "workflow.runtime", "token_use": "service", "scope": scheduler, "hzy": map[string]any{"credentialId": 7, "appCode": "workflow"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		for key, value := range changes {
			claims[key] = value
		}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "workflow-effect-test"
		bearer, signErr := token.SignedString(private)
		if signErr != nil {
			t.Fatal(signErr)
		}
		req := httptest.NewRequest(http.MethodGet, "/v1/workflow/notification-effects/pending", nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		return req
	}
	var verified int
	verify := func(_ context.Context, identity auth.Context, scope string) (bool, error) {
		verified++
		if identity.ClientID != "workflow.runtime" || scope != scheduler || identity.CredentialID != 7 || identity.Audience != "data-runtime" {
			t.Fatalf("wrong state verification: %+v %q", identity, scope)
		}
		return true, nil
	}
	good, err := authenticateWorkflowEffectService(makeRequest(nil), auth.New(cfg), cfg.Tenant, cfg.DeploymentBindings["workflow"], verify, scheduler, "workflow.runtime")
	if err != nil || good.ClientID != "workflow.runtime" || verified != 1 {
		t.Fatalf("scheduler identity rejected: %+v %v calls=%d", good, err, verified)
	}
	if _, err := authenticateWorkflowEffectService(makeRequest(nil), auth.New(cfg), cfg.Tenant,
		cfg.DeploymentBindings["workflow"], func(context.Context, auth.Context, string) (bool, error) {
			return false, nil // Console returns inactive for NULL current_credential_id.
		}, scheduler, "workflow.runtime"); err == nil {
		t.Fatal("inactive credential accepted")
	} else if known, ok := err.(httperror.Error); !ok || known.Status != 403 || known.Code != "workflow_effect_credential_inactive" {
		t.Fatalf("inactive credential must end as 403: %v", err)
	}
	if _, err := authenticateWorkflowEffectService(makeRequest(map[string]any{"client_id": "workflow.maintenance", "sub": "client:workflow.maintenance", "scope": workflowDeliveryRecoveryScope}), auth.New(cfg), cfg.Tenant, cfg.DeploymentBindings["workflow"], func(context.Context, auth.Context, string) (bool, error) { return true, nil }, workflowDeliveryRecoveryScope, "workflow.maintenance"); err != nil {
		t.Fatalf("maintenance identity rejected: %v", err)
	}
	for name, request := range map[string]*http.Request{
		"scheduler client cannot recover": makeRequest(map[string]any{"scope": workflowDeliveryRecoveryScope}),
		"scheduler scope cannot recover":  makeRequest(map[string]any{"client_id": "workflow.maintenance", "sub": "client:workflow.maintenance"}),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := authenticateWorkflowEffectService(request, auth.New(cfg), cfg.Tenant, "workflow-test", func(context.Context, auth.Context, string) (bool, error) { return true, nil }, workflowDeliveryRecoveryScope, "workflow.maintenance")
			if known, ok := err.(httperror.Error); !ok || known.Status != 403 {
				t.Fatalf("maintenance separation failed: %v", err)
			}
		})
	}
	for _, item := range []struct {
		name                               string
		changes                            map[string]any
		tenant, deployment, expectedClient string
		want                               int
	}{
		{"missing scope", map[string]any{"scope": "workflow.read"}, cfg.Tenant, "workflow-test", "workflow.runtime", 403},
		{"wrong audience", map[string]any{"aud": "tenant-runtime"}, cfg.Tenant, "workflow-test", "workflow.runtime", 401},
		{"wrong client", map[string]any{"client_id": "workflow.maintenance", "sub": "client:workflow.maintenance"}, cfg.Tenant, "workflow-test", "workflow.runtime", 403},
		{"wrong tenant", map[string]any{"tenant": "C000002"}, cfg.Tenant, "workflow-test", "workflow.runtime", 403},
		{"wrong deployment", map[string]any{"deployment": "other"}, cfg.Tenant, "workflow-test", "workflow.runtime", 403},
		{"expired", map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}, cfg.Tenant, "workflow-test", "workflow.runtime", 401},
	} {
		t.Run(item.name, func(t *testing.T) {
			_, err := authenticateWorkflowEffectService(makeRequest(item.changes), auth.New(cfg), item.tenant, item.deployment, verify, scheduler, item.expectedClient)
			known, ok := err.(httperror.Error)
			if !ok || known.Status != item.want {
				t.Fatalf("wanted %d; got %v", item.want, err)
			}
		})
	}
	// Authentication runs before HandleRuntime. With no Workflow adapter at all,
	// both a claim and a checkpoint reject a wrong grant as 403; neither can
	// touch the outbox row or advance its attempt count.
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/v1/workflow/notification-effects/pending"},
		{http.MethodPost, "/v1/workflow/notification-effects/7/ack"},
	} {
		req := makeRequest(map[string]any{"scope": "workflow.read"})
		req.Method, req.URL.Path = route.method, route.path
		_, err := server.route(req)
		if known, ok := err.(httperror.Error); !ok || known.Status != 403 {
			t.Fatalf("%s %s touched unavailable adapter before 403: %v", route.method, route.path, err)
		}
	}
	missing := httptest.NewRequest(http.MethodGet, "/v1/workflow/notification-effects/pending", nil)
	if _, err := authenticateWorkflowEffectService(missing, auth.New(cfg), cfg.Tenant, "workflow-test", verify, scheduler, "workflow.runtime"); err == nil {
		t.Fatal("missing bearer accepted")
	} else if known, ok := err.(httperror.Error); !ok || known.Status != 401 {
		t.Fatalf("missing bearer: %v", err)
	}
	for _, item := range []struct {
		name   string
		active bool
		err    error
		want   int
	}{
		{"revoked grant", false, nil, 403},
		{"Console down", false, errors.New("console unavailable"), 503},
	} {
		t.Run(item.name, func(t *testing.T) {
			_, err := authenticateWorkflowEffectService(makeRequest(nil), auth.New(cfg), cfg.Tenant, "workflow-test", func(context.Context, auth.Context, string) (bool, error) { return item.active, item.err }, scheduler, "workflow.runtime")
			known, ok := err.(httperror.Error)
			if !ok || known.Status != item.want {
				t.Fatalf("wanted %d; got %v", item.want, err)
			}
		})
	}
}

func TestWorkflowRecoveryInputIsClosed(t *testing.T) {
	if reason, version, err := workflowRecoveryInput(map[string]any{"reason": " operator approved ", "expectedVersion": float64(3)}); err != nil || reason != "operator approved" || version != 3 {
		t.Fatalf("valid input: %q %d %v", reason, version, err)
	}
	for name, body := range map[string]map[string]any{
		"empty reason":       {"reason": " ", "expectedVersion": float64(1)},
		"long reason":        {"reason": strings.Repeat("x", 201), "expectedVersion": float64(1)},
		"fractional version": {"reason": "approved", "expectedVersion": 1.5},
		"zero version":       {"reason": "approved", "expectedVersion": float64(0)},
		"extra actor":        {"reason": "approved", "expectedVersion": float64(1), "actor": "someone"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := workflowRecoveryInput(body); err == nil {
				t.Fatal("invalid recovery accepted")
			}
		})
	}
}

func TestWorkflowNotificationDetailVerifierIdentityIsFixed(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "workflow-verifier-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "C000001", Deployment: "runtime-test", DeploymentBindings: map[string]string{"workflow": "workflow-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	makeRequest := func(changes map[string]any) *http.Request {
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:workflow.runtime", "tenant": "C000001", "deployment": "workflow-test", "source_app": "workflow", "target_app": "data-runtime", "client_id": "workflow.runtime", "token_use": "service", "scope": "data-runtime:workflow:read", "hzy": map[string]any{"credentialId": 7, "appCode": "workflow"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		for key, value := range changes {
			claims[key] = value
		}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "workflow-verifier-test"
		bearer, signErr := token.SignedString(private)
		if signErr != nil {
			t.Fatal(signErr)
		}
		req := httptest.NewRequest(http.MethodPost, "/v1/workflow/notification-details/authorize", nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		return req
	}
	var checked string
	active := func(_ context.Context, identity auth.Context, scope string) (bool, error) {
		checked = scope
		return identity.ClientID == "workflow.runtime", nil
	}
	good, err := authenticateWorkflowNotificationDetailVerifier(makeRequest(nil), auth.New(cfg), cfg.Tenant, "workflow-test", active)
	if err != nil || good.ClientID != "workflow.runtime" || checked != "data-runtime:workflow:read" {
		t.Fatalf("workflow.runtime verifier rejected: %+v %v checked=%q", good, err, checked)
	}
	status := func(err error) int {
		if known, ok := err.(httperror.Error); ok {
			return known.Status
		}
		return 0
	}
	for name, item := range map[string]struct {
		changes    map[string]any
		deployment string
		verify     enterpriseCredentialVerifier
		want       int
	}{
		"aims.runtime with workflow read":       {changes: map[string]any{"client_id": "aims.runtime", "sub": "client:aims.runtime"}, deployment: "workflow-test", verify: active, want: 403},
		"enterprise.runtime with workflow read": {changes: map[string]any{"client_id": "enterprise.runtime", "sub": "client:enterprise.runtime"}, deployment: "workflow-test", verify: active, want: 403},
		"wrong deployment":                      {changes: nil, deployment: "other-workflow", verify: active, want: 403},
		"write scope only":                      {changes: map[string]any{"scope": "data-runtime:workflow:write"}, deployment: "workflow-test", verify: active, want: 403},
		"revoked grant":                         {changes: nil, deployment: "workflow-test", verify: func(context.Context, auth.Context, string) (bool, error) { return false, nil }, want: 403},
		"grant state unavailable":               {changes: nil, deployment: "workflow-test", verify: func(context.Context, auth.Context, string) (bool, error) { return false, errors.New("down") }, want: 503},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := authenticateWorkflowNotificationDetailVerifier(makeRequest(item.changes), auth.New(cfg), cfg.Tenant, item.deployment, item.verify)
			if err == nil || status(err) != item.want {
				t.Fatalf("got %v (status %d), want %d", err, status(err), item.want)
			}
		})
	}
}
