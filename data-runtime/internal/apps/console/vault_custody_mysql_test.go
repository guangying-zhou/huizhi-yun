package console

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The owner-bound custody reveal used by Finance for bank account numbers.
func TestRevealCustodySecretForOwnerMySQL(t *testing.T) {
	socket := os.Getenv("HZY_INITIAL_CREDENTIAL_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Fatal("not isolated")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_custody_%d", time.Now().UnixNano())
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
	if _, err = conn.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `([^`]+)`.*?;").FindAllStringSubmatch(string(raw), -1) {
		if m[1] == "vault_secrets" || m[1] == "vault_secret_versions" || m[1] == "vault_access_logs" {
			if _, err = conn.Exec(m[0]); err != nil {
				t.Fatal(m[1], err)
			}
		}
	}
	a := NewWithDB(config.ConsoleConfig{VaultMasterKey: "isolated-fixture-key"}, "fixture-tenant", conn)
	ctx := context.Background()
	const synthetic = "TEST-ACCOUNT-0000000000001234"
	seed := func(code, secretType, usage, ownerType, ownerKey string) {
		t.Helper()
		material, err := a.encryptVaultPlaintext(synthetic)
		if err != nil {
			t.Fatal(err)
		}
		res, err := conn.Exec(`INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'db_encrypted','single_actor',?,'active','fixture',UTC_TIMESTAMP(),UTC_TIMESTAMP())`, code, "hzybase://vault/"+code, code, secretType, usage, ownerType, ownerKey, material.MaskedPreview)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		res, err = conn.Exec(`INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,status,activated_at,created_by,created_at) VALUES (?,1,?,?,?,?,'active',UTC_TIMESTAMP(),'fixture',UTC_TIMESTAMP())`, id, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme, material.KeyFingerprint)
		if err != nil {
			t.Fatal(err)
		}
		version, _ := res.LastInsertId()
		if _, err = conn.Exec("UPDATE vault_secrets SET current_version_id=? WHERE id=?", version, id); err != nil {
			t.Fatal(err)
		}
	}
	own := "finance.bank-account.BA-W000002.account-no"
	seed(own, "bank_account_number", "custody", "finance_bank_account", "BA-W000002")
	seed("finance.bank-account.BA-W000003.account-no", "bank_account_number", "custody", "finance_bank_account", "BA-W000003")
	seed("integration.gitlab.token", "api_key", "integration", "integration", "gitlab")
	seed("finance.bank-account.BA-W000009.account-no", "bank_account_number", "service", "finance_bank_account", "BA-W000009")
	meta := VaultAccessMeta{ActorType: "human", ActorID: "finance-admin", AppCode: "finance", RequestIP: "203.0.113.7", UserAgent: "fixture", Reason: "monthly reconciliation"}
	logs := func(status string) int {
		t.Helper()
		var n int
		if err := conn.QueryRow("SELECT COUNT(*) FROM vault_access_logs WHERE action='reveal' AND result_status=?", status).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	notFound := func(err error) {
		t.Helper()
		var he httperror.Error
		if !errors.As(err, &he) || he.Status != 404 || he.Code != "console_vault_secret_not_found" {
			t.Fatal("expected not found, got", err)
		}
	}

	value, err := a.RevealCustodySecretForOwner(ctx, own, "bank_account_number", "finance_bank_account", "BA-W000002", meta)
	if err != nil || value != synthetic {
		t.Fatal("reveal", err)
	}
	var actor, app, reason, ip string
	if err = conn.QueryRow("SELECT actor_id,app_code,reason,request_ip FROM vault_access_logs WHERE action='reveal' AND result_status='success'").Scan(&actor, &app, &reason, &ip); err != nil || actor != "finance-admin" || app != "finance" || reason != "monthly reconciliation" || ip != "203.0.113.7" {
		t.Fatal("access log", actor, app, reason, ip, err)
	}

	// Another owner's secret, another type, a non-custody secret, a missing
	// secret, a versioned or prefixed reference: all indistinguishable.
	for name, args := range map[string][4]string{
		"other account's secret":  {"finance.bank-account.BA-W000003.account-no", "bank_account_number", "finance_bank_account", "BA-W000002"},
		"wrong owner type":        {own, "bank_account_number", "integration", "BA-W000002"},
		"wrong secret type":       {own, "api_key", "finance_bank_account", "BA-W000002"},
		"integration secret":      {"integration.gitlab.token", "api_key", "integration", "gitlab"},
		"non-custody same shape":  {"finance.bank-account.BA-W000009.account-no", "bank_account_number", "finance_bank_account", "BA-W000009"},
		"missing":                 {"finance.bank-account.BA-W000404.account-no", "bank_account_number", "finance_bank_account", "BA-W000404"},
		"reference instead of id": {"hzybase://vault/" + own, "bank_account_number", "finance_bank_account", "BA-W000002"},
		"versioned":               {own + "@v1", "bank_account_number", "finance_bank_account", "BA-W000002"},
	} {
		value, err := a.RevealCustodySecretForOwner(ctx, args[0], args[1], args[2], args[3], meta)
		if value != "" {
			t.Fatal(name, "returned plaintext")
		}
		notFound(err)
	}
	if logs("success") != 1 || logs("denied") == 0 {
		t.Fatal("denied attempts on existing secrets are logged", logs("success"), logs("denied"))
	}
	// Actor and reason are mandatory.
	for _, m := range []VaultAccessMeta{{ActorID: "finance-admin"}, {Reason: "monthly reconciliation"}} {
		if value, err := a.RevealCustodySecretForOwner(ctx, own, "bank_account_number", "finance_bank_account", "BA-W000002", m); err == nil || value != "" {
			t.Fatal("reveal without actor or reason")
		}
	}
	// A custody secret is still closed to programmatic resolution.
	if _, err = a.ResolveVaultSecret(ctx, own, nil, meta); err == nil {
		t.Fatal("custody secret resolved programmatically")
	}
	// Without the access log no plaintext leaves the vault.
	if _, err = conn.Exec(`CREATE TRIGGER reject_audit BEFORE INSERT ON vault_access_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit unavailable'`); err != nil {
		t.Fatal(err)
	}
	if value, err = a.RevealCustodySecretForOwner(ctx, own, "bank_account_number", "finance_bank_account", "BA-W000002", meta); err == nil || value != "" {
		t.Fatal("plaintext returned without access log")
	}
	// A wrong master key fails closed.
	wrong := NewWithDB(config.ConsoleConfig{VaultMasterKey: "wrong-key"}, "fixture-tenant", conn)
	if value, err = wrong.RevealCustodySecretForOwner(ctx, own, "bank_account_number", "finance_bank_account", "BA-W000002", meta); err == nil || value != "" {
		t.Fatal("wrong key revealed plaintext")
	}
}
