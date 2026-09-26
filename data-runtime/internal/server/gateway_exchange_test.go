package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/gatewaykeys"
)

func TestGatewayExchangeHTTPCallerBoundaryAndAvailability(t *testing.T) {
	for _, tc := range []struct {
		name    string
		field   string
		value   any
		status  int
		code    string
		live    bool
		enabled bool
	}{
		{name: "ready caller, missing keyset", status: 503, code: "gateway_keyset_unavailable", live: true, enabled: true},
		{name: "disabled", status: 503, code: "gateway_exchange_disabled", live: true},
		{name: "anonymous", status: 401},
		{name: "expired", field: "exp", value: time.Now().Add(-time.Minute).Unix(), status: 401},
		{name: "audience", field: "aud", value: "wrong", status: 401},
		{name: "issuer", field: "iss", value: "https://wrong.test", status: 401},
		{name: "tenant", field: "tenant", value: "other", status: 403},
		{name: "deployment", field: "deployment", value: "other", status: 403},
		{name: "source", field: "source_app", value: "aims", status: 403},
		{name: "scope", field: "scope", value: "console:service-token:issue", status: 403},
		{name: "client", field: "client_id", value: "other.runtime", status: 403},
		{name: "inactive caller credential", field: "hzy", value: map[string]any{"credentialId": 999}, status: 403, code: "console_exchange_identity_inactive", live: true, enabled: true},
		{name: "user token", field: "token_use", value: "access", status: 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, key := testRuntimeJWTConfig(t)
			cfg.Auth.JWT.Issuer = "https://fixture.test/console"
			cfg.DeploymentBindings = map[string]string{"console": "deployment-1"}
			cfg.Apps.Console.GatewayExchangeEnabled = tc.enabled
			db, mock, _ := sqlmock.New()
			defer db.Close()
			if tc.live {
				mock.ExpectQuery("SELECT id,status,app_code,client_type,current_credential_id").WithArgs("console.runtime").WillReturnRows(sqlmock.NewRows([]string{"id", "status", "app", "type", "cred"}).AddRow(1, "active", "console", "runtime", 20))
				mock.ExpectQuery("SELECT scc.id").WithArgs(int64(20), uint64(1), "console.runtime").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(20))
				mock.ExpectQuery("SELECT resource_code,action FROM service_client_grants").WithArgs(uint64(1)).WillReturnRows(sqlmock.NewRows([]string{"resource", "action"}).AddRow("console:service-token", "gateway-exchange"))
			}
			srv := &Server{cfg: cfg, auth: auth.New(cfg), console: consoleapp.NewWithDB(config.ConsoleConfig{}, cfg.Tenant, db)}
			claims := jwt.MapClaims{"iss": cfg.Auth.JWT.Issuer, "aud": "data-runtime", "sub": "client:console.runtime", "client_id": "console.runtime", "source_app": "console", "target_app": "data-runtime", "tenant": "tenant-1", "deployment": "deployment-1", "scope": consoleapp.GatewayExchangeScope, "token_use": "service", "iat": time.Now().Add(-time.Second).Unix(), "exp": time.Now().Add(time.Minute).Unix(), "hzy": map[string]any{"credentialId": 20}}
			if tc.field != "" {
				claims[tc.field] = tc.value
			}
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
			token.Header["kid"] = "test-key"
			signed, _ := token.SignedString(key)
			req := httptest.NewRequest(http.MethodPost, gatewaykeys.ExchangePath, bytes.NewBufferString(`{}`))
			if tc.name != "anonymous" {
				req.Header.Set("Authorization", "Bearer "+signed)
			}
			response := httptest.NewRecorder()
			srv.ServeHTTP(response, req)
			if response.Code != tc.status {
				t.Fatalf("status %d want %d", response.Code, tc.status)
			}
			if tc.code != "" {
				var body struct {
					Error struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				_ = json.Unmarshal(response.Body.Bytes(), &body)
				if body.Error.Code != tc.code {
					t.Fatalf("code %s want %s", body.Error.Code, tc.code)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
