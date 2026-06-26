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

	"github.com/golang-jwt/jwt/v5"
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

func TestRuntimeQueryWithAuthOverwritesSpoofedAuthContext(t *testing.T) {
	source := url.Values{}
	source.Set("current_user", "spoof-user")
	source.Set("operator_uid", "spoof-operator")
	source.Set("current_user_scopes", "altoc.admin")
	source.Set("current_user_dept_codes", "BAD")
	source.Set("keyword", "keep-me")

	query := runtimeQueryWithAuth(source, auth.Context{
		AppCode: "altoc",
		Mode:    string(config.AuthJWT),
		Subject: "token-subject",
		Scopes:  []string{"altoc.write"},
	}, "real-user", []string{"D1", "D2", "D1"})

	if got := query.Get("current_user"); got != "real-user" {
		t.Fatalf("current_user = %q, want real-user", got)
	}
	if got := query.Get("operator_uid"); got != "real-user" {
		t.Fatalf("operator_uid = %q, want real-user", got)
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
		"name":                          "kept",
	}

	injectRuntimeAuthBody(body, auth.Context{
		AppCode: "altoc",
		Mode:    string(config.AuthJWT),
		Subject: "token-subject",
		Scopes:  []string{"altoc.write"},
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

func TestRouteAppRuntimeInjectsJWTActorScopesAndIdempotency(t *testing.T) {
	cfg, privateKey := testRuntimeJWTConfig(t)
	server := &Server{cfg: cfg, auth: auth.New(cfg)}
	handler := &captureRuntimeHandler{}
	token := signTestRuntimeJWT(t, privateKey, "tenant-runtime:altoc:write altoc:lead:convert")
	req := httptest.NewRequest(http.MethodPost, "/v1/altoc/leads/1/convert?current_user=spoof-user&keyword=keep-me", strings.NewReader(`{
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
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"aud":        "data-runtime",
		"tenant":     "tenant-1",
		"deployment": "deployment-1",
		"app_code":   "altoc",
		"sub":        "token-subject",
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
