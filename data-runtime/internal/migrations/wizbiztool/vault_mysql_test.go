package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"errors"
	"github.com/go-sql-driver/mysql"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestToolRuntimeVaultMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	vault, admin := setupUpgradeVault(t, f)
	defer vault.Close()
	var err error
	obj := PreparedObject{Key: "BA-W000001", Values: map[string]any{"account_no_secret_ref": "hzybase://vault/finance.bank-account.BA-W000001.account-no"}, VaultContentSHA256: Digest([]byte("WIZBIZ-TEST-1"))}
	forbidden := f.profile
	forbidden.VaultWrite = "forbidden"
	if err = vault.Ensure(ctx, obj, f.data["wb_bank_account"][0], forbidden); err != ErrVault {
		t.Fatal("forbidden vault wrote secret", err)
	}
	var before int
	if admin.QueryRow("SELECT COUNT(*) FROM vault_secrets").Scan(&before) != nil || before != 0 {
		t.Fatal("forbidden vault side effect")
	}
	for i := 0; i < 2; i++ {
		if err = vault.Ensure(ctx, obj, f.data["wb_bank_account"][0], f.profile); err != nil {
			_, probeErr := vault.adapter.CreateVaultSecret(ctx, map[string]any{"secretCode": "finance.bank-account.BA-W000001.account-no", "secretType": "bank_account_number", "usageType": "custody", "ownerType": "finance_bank_account", "ownerKey": "BA-W000001", "storageBackend": "db_encrypted", "material": map[string]any{"plaintext": "WIZBIZ-TEST-1"}}, consoleapp.MutationMeta{IdempotencyKey: "wizbiz/" + f.profile.BatchCode + "/BA-W000001", ActorID: f.profile.Operator})
			var he httperror.Error
			var me *mysql.MySQLError
			if errors.As(probeErr, &he) {
				t.Fatalf("vault adapter fixed code: %s", he.Code)
			}
			if errors.As(probeErr, &me) {
				t.Fatalf("vault adapter SQL number: %d", me.Number)
			}
			t.Fatal("vault ensure", err)
		}
	}
	if err = vault.Check(ctx, "BA-W000001", obj.VaultContentSHA256, maskAccount("WIZBIZ-TEST-1")); err != nil {
		t.Fatal(err)
	}
	var count int
	if admin.QueryRow("SELECT COUNT(*) FROM vault_secret_versions").Scan(&count) != nil || count != 1 {
		t.Fatal("duplicate vault version")
	}
	_, err = vault.adapter.ResolveVaultSecret(ctx, "finance.bank-account.BA-W000001.account-no", nil, consoleapp.VaultAccessMeta{ActorID: "fixture"})
	var he httperror.Error
	if !errors.As(err, &he) || he.Status != 403 {
		t.Fatal("custody unexpectedly resolvable")
	}
	if err = vault.Retire(ctx, "BA-W000001", f.profile); err != nil {
		t.Fatal("retire", err)
	}
	if err = vault.Retire(ctx, "BA-W000001", f.profile); err != nil {
		t.Fatal("retire replay", err)
	}
	var status string
	if admin.QueryRow("SELECT status FROM vault_secrets").Scan(&status) != nil || status != "inactive" {
		t.Fatal("vault not retained inactive")
	}
	if admin.QueryRow("SELECT COUNT(*) FROM vault_secret_versions").Scan(&count) != nil || count != 1 {
		t.Fatal("retire deleted vault version")
	}
}

func setupUpgradeVault(t *testing.T, f *toolFixture) (*runtimeVault, *sql.DB) {
	t.Helper()
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = f.profile.Source.Socket
	mc.DBName = f.profile.ConsoleDatabase
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	admin.SetMaxOpenConns(1)
	raw, err := os.ReadFile("../../../../console/docs/hzy_console_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"vault_secrets": true, "vault_secret_versions": true, "vault_access_logs": true, "console_mutation_receipts": true, "operation_logs": true}
	for _, m := range regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `([^`]+)`.*?;").FindAllStringSubmatch(string(raw), -1) {
		if allowed[m[1]] {
			if _, err = admin.Exec(m[0]); err != nil {
				t.Fatal("isolated Console DDL", m[1], err)
			}
		}
	}
	if _, err = admin.Exec("SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatal(err)
	}
	var port int
	if f.root.QueryRow("SELECT @@port").Scan(&port) != nil {
		t.Fatal("isolated port")
	}
	user := "w2_vault_" + f.profile.Database[len(f.profile.Database)-12:]
	if _, err = f.root.Exec("CREATE USER '" + user + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.root.Exec("DROP USER '" + user + "'@'localhost'") })
	for table := range allowed {
		if _, err = f.root.Exec("GRANT SELECT,INSERT,UPDATE ON `" + f.profile.ConsoleDatabase + "`.`" + table + "` TO '" + user + "'@'localhost'"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = f.root.Exec("CREATE USER '" + user + "'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.root.Exec("DROP USER '" + user + "'@'127.0.0.1'") })
	for table := range allowed {
		if _, err = f.root.Exec("GRANT SELECT,INSERT,UPDATE ON `" + f.profile.ConsoleDatabase + "`.`" + table + "` TO '" + user + "'@'127.0.0.1'"); err != nil {
			t.Fatal(err)
		}
	}
	var cfg config.Config
	if _, err = ReadJSON(f.profile.RuntimeConfig, &cfg, 32<<20); err != nil {
		t.Fatal(err)
	}
	cfg.Apps.Console.DB = config.DBConfig{Host: "127.0.0.1", Port: port, User: user, Database: f.profile.ConsoleDatabase, ConnectionLimit: 2}
	cfgRaw, _ := json.Marshal(cfg)
	if os.WriteFile(f.profile.RuntimeConfig, cfgRaw, 0600) != nil {
		t.Fatal("synthetic Runtime config")
	}
	if os.WriteFile(filepath.Join(filepath.Dir(f.profile.RuntimeConfig), "console-vault-master-key"), []byte("synthetic-w2-test-key"), 0600) != nil {
		t.Fatal("synthetic key")
	}
	t.Setenv("HZY_CONSOLE_VAULT_MASTER_KEY", "")
	t.Setenv("HZY_CONSOLE_VAULT_MASTER_KEY_FILE", filepath.Join(filepath.Dir(f.profile.RuntimeConfig), "console-vault-master-key"))
	vault, err := openRuntimeVault(f.profile)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { admin.Close() })
	return vault, admin
}
