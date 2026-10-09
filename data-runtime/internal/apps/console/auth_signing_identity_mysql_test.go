package console

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceSigningIdentityMySQL(t *testing.T) {
	socket := os.Getenv("HZY_GATEWAY_EXCHANGE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires disposable /tmp MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated MySQL")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "signing_identity_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + name + "`")
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, q := range []string{
		`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(128),client_name VARCHAR(128),client_type VARCHAR(32),app_code VARCHAR(64) NULL,status VARCHAR(16),current_credential_id BIGINT)`,
		`CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(16),expires_at DATETIME)`,
		`CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(32),status VARCHAR(16),scope_json JSON)`,
		`INSERT INTO service_clients VALUES(9,'aims-runtime','Aims Runtime','runtime','aims','active',42)`,
		`INSERT INTO service_client_credentials VALUES(42,9,'aims-runtime-client','active',NULL)`,
		`INSERT INTO service_client_grants VALUES(9,'assets:product','read','active','{"audience":"assets","semanticScope":"assets:product:read"}')`,
	} {
		if _, err = db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", db)
	adapter.SetOIDCSigningDeploymentBindings("runtime-test", map[string]string{"aims": "tenant-a-aims"})

	t.Run("registered audience and physical scope cannot cross audience", func(t *testing.T) {
		claims := serviceSigningBody("assets:product:read")["claims"].(map[string]any)
		claims["aud"], claims["target_app"] = "finance", "finance"
		err := adapter.authorizeServiceSigningClaims(context.Background(), claims, claims["hzy"].(map[string]any))
		assertSigningForbidden(t, err, "insufficient_scope")
	})
	t.Run("legacy grant must match approved triple", func(t *testing.T) {
		if _, err := db.Exec(`UPDATE service_client_grants SET scope_json=JSON_OBJECT('source','legacy')`); err != nil {
			t.Fatal(err)
		}
		claims := serviceSigningBody("assets:product:read")["claims"].(map[string]any)
		err := adapter.authorizeServiceSigningClaims(context.Background(), claims, claims["hzy"].(map[string]any))
		assertSigningForbidden(t, err, "insufficient_scope")
		if _, err := db.Exec(`UPDATE service_client_grants SET scope_json=JSON_OBJECT('audience','assets','semanticScope','assets:product:read')`); err != nil {
			t.Fatal(err)
		}
	})
	for _, tc := range []struct {
		name, sql, code string
		deployment      string
		forge           bool
	}{
		{name: "active identity"},
		{name: "foreign source deployment", deployment: "tenant-b-aims", code: "oidc_signing_service_deployment_mismatch"},
		{name: "target instead of source", deployment: "tenant-a-assets", code: "oidc_signing_service_deployment_mismatch"},
		{name: "explicit grant deployment", sql: `UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','tenant-a','$.deploymentCode','custom-aims')`, deployment: "custom-aims"},
		{name: "partial grant binding", sql: `UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','tenant-a')`, code: "oidc_signing_service_deployment_binding_invalid"},
		{name: "foreign grant tenant", sql: `UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','tenant-b','$.deploymentCode','tenant-a-aims')`, code: "oidc_signing_service_deployment_binding_invalid"},
		{name: "paired forgery", code: "oidc_signing_service_identity_mismatch", forge: true},
		{name: "null application", sql: `UPDATE service_clients SET app_code=NULL`},
		{name: "noncurrent credential", sql: `UPDATE service_clients SET current_credential_id=43`, code: "oidc_signing_service_state_inactive"},
		{name: "expired credential", sql: `UPDATE service_client_credentials SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND`, code: "oidc_signing_service_state_inactive"},
		{name: "revoked grant", sql: `UPDATE service_client_grants SET status='revoked'`, code: "insufficient_scope"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, q := range []string{`UPDATE service_clients SET app_code='aims',current_credential_id=42`, `UPDATE service_client_credentials SET expires_at=NULL`, `UPDATE service_client_grants SET status='active',scope_json=JSON_OBJECT('audience','assets','semanticScope','assets:product:read')`} {
				if _, err = db.Exec(q); err != nil {
					t.Fatal(err)
				}
			}
			if tc.sql != "" {
				if _, err = db.Exec(tc.sql); err != nil {
					t.Fatal(err)
				}
			}
			if tc.name == "null application" {
				if _, err := db.Exec(`UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','tenant-a','$.deploymentCode','tenant-a-aims')`); err != nil {
					t.Fatal(err)
				}
			}
			claims := serviceSigningBody("assets:product:read")["claims"].(map[string]any)
			if tc.deployment != "" {
				claims["deployment"] = tc.deployment
			}
			hzy := claims["hzy"].(map[string]any)
			if tc.forge {
				claims["sub"] = "client:forged"
				hzy["clientCode"] = "forged"
				hzy["subjectCode"] = "forged"
			}
			err := adapter.authorizeServiceSigningClaims(context.Background(), claims, hzy)
			if tc.code != "" {
				assertSigningForbidden(t, err, tc.code)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			wantApp := "aims"
			if tc.name == "null application" {
				wantApp = ""
			}
			if hzy["clientName"] != "Aims Runtime" || hzy["clientType"] != "runtime" || hzy["appCode"] != wantApp || claims["source_app"] != wantApp {
				t.Fatal("credential row identity was not canonicalized")
			}
		})
	}

	t.Run("user active client and azp", func(t *testing.T) {
		for _, q := range []string{
			`CREATE TABLE auth_clients(client_id VARCHAR(128) COLLATE utf8mb4_general_ci PRIMARY KEY,status VARCHAR(16))`,
			`CREATE TABLE directory_users(uid VARCHAR(128) PRIMARY KEY,status VARCHAR(16))`,
			`CREATE TABLE local_sessions(session_id VARCHAR(128) PRIMARY KEY,uid VARCHAR(128),status VARCHAR(16),revoked_at DATETIME NULL,expires_at DATETIME)`,
			`INSERT INTO auth_clients VALUES('aims','active'),('enterprise','active'),('disabled','disabled')`,
			`INSERT INTO directory_users VALUES('u1001','active')`,
			`INSERT INTO local_sessions VALUES('` + testSigningSID + `','u1001','active',NULL,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`,
		} {
			if _, err := db.Exec(q); err != nil {
				t.Fatal(err)
			}
		}
		for _, tc := range []struct {
			name, audience, code string
			azp                  any
			present              bool
		}{
			{name: "active", audience: "aims"},
			{name: "equal azp", audience: "aims", azp: "aims", present: true},
			{name: "SSO other active client", audience: "enterprise"},
			{name: "unregistered", audience: "unknown", code: "oidc_signing_user_client_not_active"},
			{name: "disabled", audience: "disabled", code: "oidc_signing_user_client_not_active"},
			{name: "case mismatch despite database collation", audience: "AIMS", code: "oidc_signing_user_client_not_active"},
			{name: "wrong azp", audience: "aims", azp: "enterprise", present: true, code: "oidc_signing_user_azp_mismatch"},
			{name: "null azp", audience: "aims", present: true, code: "oidc_signing_user_azp_mismatch"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				claims := userSigningBody(testSigningSID, "user:u1001", "u1001")["claims"].(map[string]any)
				claims["aud"] = tc.audience
				if tc.present {
					claims["azp"] = tc.azp
				}
				err := adapter.authorizeUserSigningClaims(context.Background(), claims, claims["hzy"].(map[string]any))
				if tc.code != "" {
					assertSigningForbidden(t, err, tc.code)
				} else if err != nil {
					t.Fatal(err)
				}
			})
		}
	})

}
