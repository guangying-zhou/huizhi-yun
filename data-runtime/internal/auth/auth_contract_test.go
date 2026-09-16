package auth

import (
	"crypto/ed25519"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestJWTAuthenticatorRejectsWrongOperationTrustBoundary(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	requirement := Requirement{AppCode: "altoc", Scope: "altoc.write"}

	tests := []struct {
		name       string
		mutate     func(jwt.MapClaims)
		wantStatus int
		wantCode   string
	}{
		{
			name:       "missing token use",
			mutate:     func(claims jwt.MapClaims) { delete(claims, "token_use") },
			wantStatus: http.StatusForbidden,
			wantCode:   "service_token_required",
		},
		{
			name:       "user token",
			mutate:     func(claims jwt.MapClaims) { claims["token_use"] = "access" },
			wantStatus: http.StatusForbidden,
			wantCode:   "service_token_required",
		},
		{
			name:       "missing tenant",
			mutate:     func(claims jwt.MapClaims) { delete(claims, "tenant") },
			wantStatus: http.StatusForbidden,
			wantCode:   "tenant_claim_required",
		},
		{
			name:       "missing deployment",
			mutate:     func(claims jwt.MapClaims) { delete(claims, "deployment") },
			wantStatus: http.StatusForbidden,
			wantCode:   "deployment_claim_required",
		},
		{
			name: "missing source app even when client id matches",
			mutate: func(claims jwt.MapClaims) {
				delete(claims, "app_code")
				claims["client_id"] = "altoc"
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "app_claim_required",
		},
		{
			name: "conflicting tenant aliases",
			mutate: func(claims jwt.MapClaims) {
				claims["tenant_code"] = "tenant-b"
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "tenant_claim_conflict",
		},
		{
			name: "conflicting deployment aliases",
			mutate: func(claims jwt.MapClaims) {
				claims["deploymentCode"] = "deployment-b"
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "deployment_claim_conflict",
		},
		{
			name: "conflicting app aliases",
			mutate: func(claims jwt.MapClaims) {
				claims["hzy"] = map[string]any{"appCode": "aims"}
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "app_claim_conflict",
		},
		{
			name:       "wrong audience",
			mutate:     func(claims jwt.MapClaims) { claims["aud"] = "another-runtime" },
			wantStatus: http.StatusUnauthorized,
			wantCode:   "invalid_jwt",
		},
		{
			name:       "wrong tenant",
			mutate:     func(claims jwt.MapClaims) { claims["tenant"] = "tenant-b" },
			wantStatus: http.StatusForbidden,
			wantCode:   "tenant_mismatch",
		},
		{
			name:       "wrong deployment",
			mutate:     func(claims jwt.MapClaims) { claims["deployment"] = "deployment-b" },
			wantStatus: http.StatusForbidden,
			wantCode:   "deployment_mismatch",
		},
		{
			name:       "missing write capability",
			mutate:     func(claims jwt.MapClaims) { claims["scope"] = "altoc.read" },
			wantStatus: http.StatusForbidden,
			wantCode:   "insufficient_scope",
		},
		{
			name:       "expired token",
			mutate:     func(claims jwt.MapClaims) { claims["exp"] = time.Now().Add(-time.Minute).Unix() },
			wantStatus: http.StatusUnauthorized,
			wantCode:   "invalid_jwt",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := contractJWTClaims()
			test.mutate(claims)
			request := httptest.NewRequest(http.MethodPost, "/v1/altoc/service/service-tickets/ST-1/delivery-result:sync", nil)
			request.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

			_, err := authenticator.Authenticate(request, requirement)
			assertAuthHTTPError(t, err, test.wantStatus, test.wantCode)
		})
	}
}

func TestJWTAuthenticatorAllowsExplicitCrossAppScopeFromEnrolledSourceDeployment(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	authenticator.cfg.DeploymentBindings = map[string]string{
		"finance": "tenant-a-finance-prod",
		"aims":    "tenant-a-aims-prod",
	}
	claims := contractJWTClaims()
	claims["app_code"] = "finance"
	claims["source_app"] = "finance"
	claims["deployment"] = "tenant-a-finance-prod"
	claims["scope"] = "data-runtime:aims:read"
	req := httptest.NewRequest(http.MethodGet, "/v1/aims/admin/projects", nil)
	req.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	ctx, err := authenticator.Authenticate(req, Requirement{AppCode: "aims", Scope: "aims.read"})
	if err != nil {
		t.Fatalf("Authenticate Finance -> Aims read: %v", err)
	}
	if ctx.AppCode != "finance" || ctx.Deployment != "tenant-a-finance-prod" {
		t.Fatalf("source context = app %q deployment %q", ctx.AppCode, ctx.Deployment)
	}
}

func TestJWTAuthenticatorCanRequireExactSourceApplication(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	authenticator.cfg.DeploymentBindings = map[string]string{
		"console": "tenant-a-console-prod",
		"finance": "tenant-a-finance-prod",
	}

	claims := contractJWTClaims()
	claims["app_code"] = "finance"
	claims["source_app"] = "finance"
	claims["deployment"] = "tenant-a-finance-prod"
	claims["scope"] = "data-runtime:console:org-profile:edit"
	request := httptest.NewRequest(http.MethodPut, "/v1/console/profile", nil)
	request.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	_, err := authenticator.Authenticate(request, Requirement{
		AppCode:       "console",
		Scope:         "console:org-profile:edit",
		SourceAppCode: "console",
	})
	assertAuthHTTPError(t, err, http.StatusForbidden, "source_app_mismatch")
}

func TestJWTAuthenticatorRejectsCrossAppTokenFromWrongSourceDeployment(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	authenticator.cfg.DeploymentBindings = map[string]string{
		"finance": "tenant-a-finance-prod",
		"aims":    "tenant-a-aims-prod",
	}
	claims := contractJWTClaims()
	claims["app_code"] = "finance"
	claims["source_app"] = "finance"
	claims["deployment"] = "tenant-a-aims-prod"
	claims["scope"] = "data-runtime:aims:read"
	req := httptest.NewRequest(http.MethodGet, "/v1/aims/admin/projects", nil)
	req.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	_, err := authenticator.Authenticate(req, Requirement{AppCode: "aims", Scope: "aims.read"})
	assertAuthHTTPError(t, err, http.StatusForbidden, "deployment_mismatch")
}

func TestJWTAuthenticatorRestoresExactRuntimeResourceScope(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	claims := contractJWTClaims()
	claims["app_code"] = "people"
	claims["source_app"] = "people"
	claims["scope"] = "data-runtime:people:offboarding_tasks:view"
	req := httptest.NewRequest(http.MethodGet, "/v1/people/offboarding-cases", nil)
	req.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	if _, err := authenticator.Authenticate(req, Requirement{AppCode: "people", Scope: "people:offboarding_tasks:view"}); err != nil {
		t.Fatalf("Authenticate audience-qualified People resource scope: %v", err)
	}

	claims["scope"] = "another-runtime:people:offboarding_tasks:view"
	req.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))
	_, err := authenticator.Authenticate(req, Requirement{AppCode: "people", Scope: "people:offboarding_tasks:view"})
	assertAuthHTTPError(t, err, http.StatusForbidden, "insufficient_scope")
}

func TestJWTAuthenticatorUsesPerAppDeploymentEnrollmentBinding(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	authenticator.cfg.DeploymentBindings = map[string]string{"altoc": "tenant-a-altoc-prod"}
	claims := contractJWTClaims()
	claims["deployment"] = "tenant-a-altoc-prod"
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/contracts", nil)
	req.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	ctx, err := authenticator.Authenticate(req, Requirement{AppCode: "altoc", Scope: "altoc.write"})
	if err != nil {
		t.Fatalf("Authenticate with app deployment binding: %v", err)
	}
	if ctx.Deployment != "tenant-a-altoc-prod" {
		t.Fatalf("deployment = %q, want tenant-a-altoc-prod", ctx.Deployment)
	}
}

func TestJWTAuthenticatorAllowsConnectorRuntimeFromConsoleDeploymentBinding(t *testing.T) {
	authenticator, privateKey := newContractJWTAuthenticator(t)
	authenticator.cfg.DeploymentBindings = map[string]string{
		"console": "tenant-a-console-prod",
	}
	claims := contractJWTClaims()
	claims["app_code"] = "connector-runtime"
	claims["source_app"] = "connector-runtime"
	claims["deployment"] = "tenant-a-console-prod"
	claims["scope"] = "data-runtime:integration_config:view"
	request := httptest.NewRequest(
		http.MethodGet,
		"/v1/console/service/integrations/dingtalk.default",
		nil,
	)
	request.Header.Set("Authorization", "Bearer "+signContractJWT(t, privateKey, claims))

	ctx, err := authenticator.Authenticate(request, Requirement{
		AppCode: "console",
		Scope:   "integration_config:view",
	})
	if err != nil {
		t.Fatalf("Authenticate Connector Runtime from Console deployment: %v", err)
	}
	if ctx.AppCode != "connector-runtime" || ctx.Deployment != "tenant-a-console-prod" {
		t.Fatalf("source context = app %q deployment %q", ctx.AppCode, ctx.Deployment)
	}
}

func TestJWTAuthenticatorRefreshesJWKSOnUnknownKid(t *testing.T) {
	oldPublicKey, oldPrivateKey, err := ed25519.GenerateKey(cryptorand.Reader)
	if err != nil {
		t.Fatalf("generate old signing key: %v", err)
	}
	newPublicKey, newPrivateKey, err := ed25519.GenerateKey(cryptorand.Reader)
	if err != nil {
		t.Fatalf("generate new signing key: %v", err)
	}

	var rotated atomic.Bool
	var jwksRequests atomic.Int32
	jwksServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		jwksRequests.Add(1)
		kid := "old-key"
		publicKey := oldPublicKey
		if rotated.Load() {
			kid = "new-key"
			publicKey = newPublicKey
		}
		response.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "OKP", "kid": kid, "alg": "EdDSA", "use": "sig",
				"crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(publicKey),
			}},
		})
	}))
	defer jwksServer.Close()

	authenticator := New(config.Config{
		Tenant: "tenant-a", Deployment: "deployment-a",
		Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{
			Audience: "data-runtime", JWKSURL: jwksServer.URL,
		}},
	})
	requirement := Requirement{AppCode: "altoc", Scope: "altoc.write"}

	oldRequest := httptest.NewRequest(http.MethodPost, "/v1/altoc/contracts", nil)
	oldRequest.Header.Set("Authorization", "Bearer "+signContractJWTWithKid(t, oldPrivateKey, "old-key", contractJWTClaims()))
	if _, err := authenticator.Authenticate(oldRequest, requirement); err != nil {
		t.Fatalf("authenticate before signing-key rotation: %v", err)
	}

	rotated.Store(true)
	newRequest := httptest.NewRequest(http.MethodPost, "/v1/altoc/contracts", nil)
	newRequest.Header.Set("Authorization", "Bearer "+signContractJWTWithKid(t, newPrivateKey, "new-key", contractJWTClaims()))
	if _, err := authenticator.Authenticate(newRequest, requirement); err != nil {
		t.Fatalf("authenticate immediately after signing-key rotation: %v", err)
	}
	if got := jwksRequests.Load(); got != 2 {
		t.Fatalf("JWKS requests = %d, want initial load plus one unknown-kid refresh", got)
	}

	for _, unknownKid := range []string{"unknown-key-1", "unknown-key-2"} {
		request := httptest.NewRequest(http.MethodPost, "/v1/altoc/contracts", nil)
		request.Header.Set("Authorization", "Bearer "+signContractJWTWithKid(t, newPrivateKey, unknownKid, contractJWTClaims()))
		_, err := authenticator.Authenticate(request, requirement)
		assertAuthHTTPError(t, err, http.StatusUnauthorized, "invalid_jwt")
	}
	if got := jwksRequests.Load(); got != 2 {
		t.Fatalf("JWKS requests after repeated unknown kids = %d, want cooldown to retain 2", got)
	}
}

func newContractJWTAuthenticator(t *testing.T) (*Authenticator, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(cryptorand.Reader)
	if err != nil {
		t.Fatalf("ed25519.GenerateKey: %v", err)
	}
	jwks, err := json.Marshal(map[string]any{
		"keys": []map[string]any{{
			"kty": "OKP",
			"kid": "contract-key",
			"alg": "EdDSA",
			"use": "sig",
			"crv": "Ed25519",
			"x":   base64.RawURLEncoding.EncodeToString(publicKey),
		}},
	})
	if err != nil {
		t.Fatalf("json.Marshal JWKS: %v", err)
	}
	configuration := config.Config{
		Tenant:     "tenant-a",
		Deployment: "deployment-a",
		Auth: config.AuthConfig{
			Mode: config.AuthJWT,
			JWT: config.JWTConfig{
				Audience: "data-runtime",
				JWKSJSON: string(jwks),
			},
		},
	}
	return New(configuration), privateKey
}

func contractJWTClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"aud":        "data-runtime",
		"tenant":     "tenant-a",
		"deployment": "deployment-a",
		"app_code":   "altoc",
		"token_use":  "service",
		"sub":        "altoc-runtime",
		"scope":      "altoc.write",
		"exp":        time.Now().Add(time.Hour).Unix(),
		"iat":        time.Now().Add(-time.Minute).Unix(),
	}
}

func signContractJWT(t *testing.T, privateKey ed25519.PrivateKey, claims jwt.MapClaims) string {
	return signContractJWTWithKid(t, privateKey, "contract-key", claims)
}

func signContractJWTWithKid(t *testing.T, privateKey ed25519.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}
	return signed
}

func assertAuthHTTPError(t *testing.T, err error, wantStatus int, wantCode string) {
	t.Helper()
	if err == nil {
		t.Fatalf("Authenticate error = nil, want %d/%s", wantStatus, wantCode)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("Authenticate error = %T %v, want httperror.Error", err, err)
	}
	if httpErr.Status != wantStatus || httpErr.Code != wantCode {
		t.Fatalf("Authenticate error = %d/%s, want %d/%s", httpErr.Status, httpErr.Code, wantStatus, wantCode)
	}
}
