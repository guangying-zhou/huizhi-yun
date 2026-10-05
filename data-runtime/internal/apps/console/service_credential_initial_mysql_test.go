package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestInitialServiceCredentialMySQL(t *testing.T) {
	socket := os.Getenv("HZY_INITIAL_CREDENTIAL_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Fatal("not isolated")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_initial_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	mc.DBName = name
	conn, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	raw, err := os.ReadFile("../../../../console/docs/hzy_console_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]bool{"auth_signing_keys": true, "service_client_grants": true, "service_clients": true, "service_client_credentials": true, "vault_secrets": true, "vault_secret_versions": true, "vault_access_logs": true}
	if _, err = conn.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `([^`]+)`.*?;").FindAllStringSubmatch(string(raw), -1) {
		if tables[m[1]] {
			if _, err = conn.Exec(m[0]); err != nil {
				t.Fatal(m[1], err)
			}
		}
	}
	conn.Exec("SET FOREIGN_KEY_CHECKS=1")
	// Runtime grant usage tracking requires this newer column absent from the base DDL snapshot.
	if _, err = conn.Exec("ALTER TABLE service_client_grants ADD COLUMN last_used_at DATETIME NULL"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(`INSERT INTO service_clients(client_code,client_name,client_type,app_code,status) VALUES('enterprise.runtime','Enterprise','runtime','enterprise','active')`); err != nil {
		t.Fatal(err)
	}
	a := NewWithDB(config.ConsoleConfig{VaultMasterKey: "isolated-fixture-key"}, "fixture-tenant", conn)
	ctx := context.Background()
	in := InitialServiceCredential{ClientCode: "enterprise.runtime", AppCode: "enterprise", ActorID: "local-fixture"}
	if _, err = conn.Exec(`CREATE TRIGGER reject_audit BEFORE INSERT ON vault_access_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late audit fixture'`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.EnsureInitialServiceCredential(ctx, in); err == nil {
		t.Fatal("audit failure accepted")
	}
	for _, table := range []string{"vault_secrets", "vault_secret_versions", "service_client_credentials"} {
		var count int
		if err = conn.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("rollback", table, count, err)
		}
	}
	conn.Exec("DROP TRIGGER reject_audit")
	first, err := a.EnsureInitialServiceCredential(ctx, in)
	if err != nil || !first.Created || !first.VaultVerified {
		t.Fatal(first, err)
	}
	again, err := a.EnsureInitialServiceCredential(ctx, in)
	if err != nil || again.Created || again.CredentialID != first.CredentialID {
		t.Fatal(again, err)
	}
	verified, err := a.VerifyInitialServiceCredential(ctx, in)
	if err != nil || !verified.VaultVerified {
		t.Fatal(verified, err)
	}
	wrong := NewWithDB(config.ConsoleConfig{VaultMasterKey: "wrong-key"}, "fixture-tenant", conn)
	if _, err = wrong.VerifyInitialServiceCredential(ctx, in); err == nil {
		t.Fatal("wrong key accepted")
	}
	var count int
	conn.QueryRow(`SELECT COUNT(*) FROM vault_access_logs`).Scan(&count)
	if count != 1 {
		t.Fatal("verification mutated audit", count)
	}
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	jwk, _ := json.Marshal(oidcSigningJWK{Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(pub), Kid: "fixture", Alg: "EdDSA", Use: "sig"})
	if _, err = conn.Exec(`INSERT INTO auth_signing_keys(kid,alg,use_type,public_jwk_json,private_key_ref,status) VALUES('fixture','EdDSA','sig',?,'fixture-unused','current')`, string(jwk)); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) SELECT id,'aims:products','view',JSON_OBJECT('tenantCode','tenant-a','deploymentCode','enterprise-test','audience','data-runtime','semanticScope','aims:products:view'),'active' FROM service_clients`); err != nil {
		t.Fatal(err)
	}
	w := InitialServiceTokenExpectation{Issuer: "https://fixture.invalid", Audience: "data-runtime", Tenant: "tenant-a", Deployment: "enterprise-test", ClientCode: "enterprise.runtime", AppCode: "enterprise", Scope: "aims:products:view"}
	claims := jwt.MapClaims{"sub": "client:" + w.ClientCode, "azp": w.ClientCode, "iss": w.Issuer, "aud": w.Audience, "exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "tenant": w.Tenant, "deployment": w.Deployment, "client_id": w.ClientCode, "source_app": w.AppCode, "target_app": w.Audience, "token_use": "service", "scope": w.Scope, "hzy": map[string]any{"appCode": w.AppCode, "subjectType": "service", "credentialId": first.CredentialID}}
	sign := func() string {
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "fixture"
		value, e := token.SignedString(priv)
		if e != nil {
			t.Fatal(e)
		}
		return value
	}
	valid := sign()
	if err = a.VerifyInitialServiceToken(ctx, valid, w); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"iss", "aud", "tenant", "deployment", "client_id", "source_app", "target_app", "scope"} {
		old := claims[key]
		claims[key] = "wrong"
		if err = a.VerifyInitialServiceToken(ctx, sign(), w); err == nil {
			t.Fatal("wrong claim accepted", key)
		}
		claims[key] = old
	}
	claims["exp"] = time.Now().Add(-time.Minute).Unix()
	if err = a.VerifyInitialServiceToken(ctx, sign(), w); err == nil {
		t.Fatal("expired accepted")
	}
	claims["exp"] = time.Now().Add(time.Minute).Unix()

	templateRaw, e := os.ReadFile("../../../../deploy/test-env/enterprise-readiness.template.json")
	if e != nil {
		t.Fatal(e)
	}
	var template struct {
		ServicePolicy struct {
			Capabilities []string `json:"capabilities"`
		} `json:"servicePolicy"`
	}
	if e = json.Unmarshal(templateRaw, &template); e != nil {
		t.Fatal(e)
	}
	// Reviewed 2026-09-15: 64 committed capabilities plus the four work-item
	// state/delete capabilities registered with this batch.
	if len(template.ServicePolicy.Capabilities) != 68 {
		t.Fatal("review changed capability set", len(template.ServicePolicy.Capabilities))
	}
	var serviceID uint64
	conn.QueryRow(`SELECT id FROM service_clients WHERE client_code='enterprise.runtime'`).Scan(&serviceID)
	for _, cap := range template.ServicePolicy.Capabilities {
		at := strings.LastIndex(cap, ":")
		_, e = conn.Exec(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(?,?,?,JSON_OBJECT('tenantCode','tenant-a','deploymentCode','enterprise-test','audience','data-runtime','semanticScope',?),'active') ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json)`, serviceID, cap[:at], cap[at+1:], cap)
		if e != nil {
			t.Fatal(e)
		}
	}
	subject := consumedServiceClient{ServiceClientID: serviceID, CredentialID: first.CredentialID, ClientCode: "enterprise.runtime", ClientID: "enterprise.runtime"}
	for _, cap := range template.ServicePolicy.Capabilities {
		result, e := a.authorizeServiceClientScopes(ctx, subject, "data-runtime", cap)
		if e != nil || result["scope"] != cap {
			t.Fatal("semantic grant", cap, e)
		}
		if _, e = a.authorizeServiceClientScopes(ctx, subject, "tenant-runtime", cap); e == nil {
			t.Fatal("unregistered audience", cap)
		}
	}
	conn.Exec(`UPDATE service_client_grants SET status='inactive'`)
	if err = a.VerifyInitialServiceToken(ctx, valid, w); err == nil {
		t.Fatal("revoked grant accepted")
	}
	conn.Exec(`UPDATE service_client_grants SET status='active'`)
	conn.Exec(`UPDATE service_client_credentials SET status='retired'`)
	if err = a.VerifyInitialServiceToken(ctx, valid, w); err == nil {
		t.Fatal("revoked credential token accepted")
	}

	if _, err = a.EnsureInitialServiceCredential(ctx, in); err == nil {
		t.Fatal("retired credential restored")
	}
	conn.QueryRow(`SELECT COUNT(*) FROM service_client_credentials`).Scan(&count)
	if count != 1 {
		t.Fatal("credential rotated")
	}
}
