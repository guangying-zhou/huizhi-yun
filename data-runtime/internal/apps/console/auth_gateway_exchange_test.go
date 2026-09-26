package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/gatewaykeys"
)

func gatewayClaims() gatewaykeys.Assertion {
	return gatewaykeys.Assertion{AppCode: "aims", ClientID: "aims.runtime", Tenant: "C000001", Environment: "test", GatewayDeployment: "test-gateway", Deployment: "C000001-test-aims", Scope: "aims:product:view", OAuthAudience: "data-runtime", KID: strings.Repeat("a", 64), JTI: strings.Repeat("A", 22), ExpiresAt: 1000}
}
func gatewayBody() map[string]any {
	b := exchangeTestBody()
	delete(b, "clientSecret")
	delete(b, "sourceBinding")
	b["assertion"] = "verified-by-runtime"
	return b
}
func TestGatewayExchangeAtomicReplayGrantPolicyAndAudit(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	for _, tc := range []struct {
		name         string
		grantBinding string
		replayError  error
		auditError   error
		success      bool
	}{
		{name: "success", grantBinding: "C000001-test-aims", success: true},
		{name: "wrong source deployment", grantBinding: "other"},
		{name: "replay", grantBinding: "C000001-test-aims", replayError: &mysql.MySQLError{Number: 1062}},
		{name: "missing replay table", grantBinding: "C000001-test-aims", replayError: &mysql.MySQLError{Number: 1146}},
		{name: "audit rollback", grantBinding: "C000001-test-aims", auditError: errors.New("audit unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db, tenant: "C000001"}
			mock.ExpectBegin()
			mock.ExpectQuery("FROM service_clients sc").WithArgs("aims").WillReturnRows(sqlmock.NewRows([]string{"id", "credential", "client_id", "code", "name", "type", "app", "expires"}).AddRow(10, 20, "aims.runtime", "aims.runtime", "Aims", "runtime", "aims", nil))
			mock.ExpectQuery("FROM service_client_grants").WithArgs(uint64(10)).WillReturnRows(sqlmock.NewRows([]string{"resource", "action", "scope"}).AddRow("aims:product", "view", `{"audience":"data-runtime","semanticScope":"aims:product:view","tenantCode":"C000001","deploymentCode":"`+tc.grantBinding+`"}`))
			mock.ExpectExec("UPDATE service_client_grants").WillReturnResult(sqlmock.NewResult(0, 1))
			if tc.grantBinding != "other" {
				mock.ExpectExec("DELETE FROM gateway_service_assertion_replay.*LIMIT 100").WithArgs(sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 100))
				insert := mock.ExpectExec("INSERT INTO gateway_service_assertion_replay").WithArgs("test-gateway", strings.Repeat("A", 22), "C000001", "test", strings.Repeat("a", 64), int64(1000000))
				if tc.replayError != nil {
					insert.WillReturnError(tc.replayError)
				} else {
					insert.WillReturnResult(sqlmock.NewResult(0, 1))
					mock.ExpectQuery("SELECT bundle_version,bundle_hash").WithArgs("C000001", "C000001-test-console").WillReturnRows(sqlmock.NewRows([]string{"version", "hash"}).AddRow("v7", "hash-7"))
					mock.ExpectQuery("SELECT id FROM auth_signing_keys").WithArgs(uint64(5)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(5))
					mock.ExpectExec("UPDATE service_client_credentials").WithArgs(uint64(20)).WillReturnResult(sqlmock.NewResult(0, 1))
					audit := mock.ExpectExec("INSERT INTO auth_token_events").WithArgs("aims.runtime")
					if tc.auditError != nil {
						audit.WillReturnError(tc.auditError)
					} else {
						audit.WillReturnResult(sqlmock.NewResult(1, 1))
					}
				}
			}
			if tc.success {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			result, err := a.exchangeConsoleServiceTokenWithKey(context.Background(), gatewayBody(), "C000001", "C000001-test-console", oidcSigningKey{ID: 5, Kid: "test-kid", PrivateKey: key}, func() *gatewaykeys.Assertion { v := gatewayClaims(); return &v }())
			if tc.success {
				if err != nil {
					t.Fatal(err)
				}
				claims := jwt.MapClaims{}
				token, e := jwt.ParseWithClaims(result["accessToken"].(string), claims, func(*jwt.Token) (any, error) { return key.Public(), nil })
				if e != nil || !token.Valid {
					t.Fatal(e)
				}
				for k, v := range map[string]string{"source_app": "aims", "tenant": "C000001", "deployment": "C000001-test-aims", "scope": "aims:product:view", "aud": "data-runtime", "sub": "client:aims.runtime", "policy_ver": "v7", "caps": "hash-7"} {
					if claims[k] != v {
						t.Fatalf("claims mismatch %s", k)
					}
				}
				legacyRaw, readErr := os.ReadFile("testdata/gateway-legacy-claims.json")
				if readErr != nil {
					t.Fatal(readErr)
				}
				var legacy map[string]any
				if e := json.Unmarshal(legacyRaw, &legacy); e != nil {
					t.Fatal(e)
				}
				if claims["exp"].(float64)-claims["iat"].(float64) != 900 {
					t.Fatal("legacy TTL differs")
				}
				delete(claims, "iat")
				delete(claims, "exp")
				if !reflect.DeepEqual(map[string]any(claims), legacy) {
					t.Fatal("Gateway exchange claims differ from legacy Console builder")
				}
			} else if err == nil || result != nil {
				t.Fatal("failed exchange returned token")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestGatewayExchangeRejectsBodySelectionBeforeDatabase(t *testing.T) {
	a := &Adapter{tenant: "C000001"}
	b := gatewayBody()
	b["app_code"] = "other"
	if _, err := a.ExchangeGatewayServiceToken(context.Background(), b, gatewayClaims(), "C000001", "console", AuditMutationMeta{}); err == nil {
		t.Fatal("body source accepted")
	}
	b = gatewayBody()
	b["scope"] = "aims:product:edit"
	if _, err := a.ExchangeGatewayServiceToken(context.Background(), b, gatewayClaims(), "C000001", "console", AuditMutationMeta{}); err == nil {
		t.Fatal("body differs from signature")
	}
}
