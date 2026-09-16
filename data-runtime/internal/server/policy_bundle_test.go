package server

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPolicyRequestBudgetDoesNotExpandOtherRoutes(t *testing.T) {
	large := `{"body":"` + strings.Repeat("a", 2<<20) + `"}`
	if _, _, err := readJSONBodyWithRaw(httptest.NewRequest("PUT", "/ordinary", strings.NewReader(large))); err == nil {
		t.Fatal("ordinary limit expanded")
	}
	if _, _, err := readJSONBodyWithRawLimit(httptest.NewRequest("PUT", "/v1/console/policy-bundle", strings.NewReader(large)), 8<<20); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readJSONBodyWithRawLimit(httptest.NewRequest("PUT", "/v1/console/policy-bundle", strings.NewReader(strings.Repeat("a", (8<<20)+1))), 8<<20); err == nil {
		t.Fatal("policy limit missing")
	}
}

func TestPolicyStorageAuthBeforeDatabase(t *testing.T) {
	for _, method := range []string{"GET", "PUT"} {
		for _, c := range []struct {
			name, field string
			value       any
			status      int
		}{
			{"valid", "", nil, 503}, {"missing scope", "scope", "console.read", 403},
			{"wrong source", "source_app", "people", 403}, {"wrong target", "target_app", "people", 403},
			{"wrong tenant", "tenant", "other", 403}, {"wrong deployment", "deployment", "other", 403},
			{"wrong audience", "aud", "people", 401}, {"wrong issuer", "iss", "https://wrong.invalid", 401},
			{"expired", "exp", time.Now().Add(-time.Hour).Unix(), 401},
			{"missing expiry", "exp", nil, 403}, {"wrong token use", "token_use", "access", 403},
			{"missing credential", "hzy", nil, 403},
		} {
			t.Run(method+"/"+c.name, func(t *testing.T) {
				cfg, key := testRuntimeJWTConfig(t)
				cfg.Auth.JWT.Issuer = "https://console.test"
				server := &Server{cfg: cfg, auth: auth.New(cfg)}
				scope := "console:policy-bundle:read"
				if method == "PUT" {
					scope = "console:policy-bundle:write"
				}
				claims := jwt.MapClaims{"iss": cfg.Auth.JWT.Issuer, "aud": "data-runtime", "source_app": "console", "target_app": "data-runtime", "tenant": "tenant-1", "deployment": "deployment-1", "sub": "client:console.runtime", "client_id": "console.runtime", "token_use": "service", "hzy": map[string]any{"credentialId": 1}, "scope": scope, "iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(time.Hour).Unix()}
				if c.field != "" {
					claims[c.field] = c.value
				}
				token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
				token.Header["kid"] = "test-key"
				signed, err := token.SignedString(key)
				if err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(method, "/v1/console/policy-bundle", nil)
				request.Header.Set("Authorization", "Bearer "+signed)
				_, err = server.route(request)
				var httpErr httperror.Error
				if !errors.As(err, &httpErr) || (c.name == "valid" && httpErr.Code != "console_adapter_disabled") || (c.name != "valid" && httpErr.Status != c.status) {
					t.Fatalf("error=%v want status=%d", err, c.status)
				}
			})
		}
	}
}
