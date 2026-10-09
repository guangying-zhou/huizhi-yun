package wizbiztool

import (
	"context"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"os"
	"strings"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	runtimedb "github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

var ErrVault = errors.New("migration_vault_not_ready")

type vaultWriter interface {
	Ensure(context.Context, PreparedObject, map[string]any, Profile) error
	Close() error
}
type runtimeVault struct {
	database   *sql.DB
	adapter    *consoleapp.Adapter
	upgradeKey []byte
}

func openRuntimeVault(p Profile) (*runtimeVault, error) {
	cfg, _, err := readRuntimeBindingConfig(p.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	// Reuse Runtime precedence; no dotenv, key generation or secret output.
	key, err := config.ResolveConsoleVaultMasterKey(os.Getenv, func(path string) ([]byte, error) { return cutoverprofile.ReadProtected(path, 4096) })
	if err != nil || key == "" {
		return nil, ErrVault
	}
	cfg.Apps.Console.VaultMasterKey = key

	if cfg.Apps.Console.DB.Database != p.ConsoleDatabase || strings.EqualFold(cfg.Apps.Console.DB.User, "root") {
		return nil, ErrTarget
	}
	database, err := runtimedb.Open(cfg.Apps.Console.DB)
	if err != nil {
		return nil, ErrVault
	}
	var actualDatabase, actualInstance string
	if database.QueryRow("SELECT DATABASE(),@@server_uuid").Scan(&actualDatabase, &actualInstance) != nil || actualDatabase != p.ConsoleDatabase || actualInstance != p.InstanceID {
		database.Close()
		return nil, ErrTarget
	}
	return &runtimeVault{database: database, adapter: consoleapp.NewWithDB(cfg.Apps.Console, p.Tenant, database), upgradeKey: []byte(key)}, nil
}
func (v *runtimeVault) Close() error { return v.database.Close() }
func (v *runtimeVault) Ensure(ctx context.Context, obj PreparedObject, source map[string]any, p Profile) error {
	if obj.Values["account_no_secret_ref"] == nil {
		return nil
	}
	if p.VaultWrite == "forbidden" {
		return ErrVault
	}
	account := "WIZBIZ-TEST-" + sourceText(source, "ba_id")
	if p.VaultWrite == "real" {
		if p.Validate() != nil {
			return ErrProfile
		}
		account = sourceText(source, "account_number")
		if account == "" || account != strings.TrimSpace(account) {
			return ErrVault
		}
	}
	if Digest([]byte(account)) != obj.VaultContentSHA256 {
		return ErrVault
	}
	code, _ := obj.Key.(string)
	secretCode := "finance.bank-account." + code + ".account-no"
	ref, _ := SecretRef(code)
	var ownerType, ownerKey, usage, status, contentHash, masked, kind, backend string
	err := v.database.QueryRowContext(ctx, "SELECT s.owner_type,s.owner_key,s.usage_type,s.status,v.content_hash,s.masked_preview,s.secret_type,s.storage_backend FROM vault_secrets s JOIN vault_secret_versions v ON v.id=s.current_version_id WHERE BINARY s.secret_code=BINARY ? AND BINARY s.secret_ref=BINARY ?", secretCode, ref).Scan(&ownerType, &ownerKey, &usage, &status, &contentHash, &masked, &kind, &backend)
	if err == nil {
		if kind != "bank_account_number" || backend != "db_encrypted" || ownerType != "finance_bank_account" || ownerKey != code || usage != "custody" || status != "active" || !vaultHashEquals(contentHash, Digest([]byte(account))) || masked != maskAccount(account) {
			return ErrVault
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return ErrVault
	}
	_, err = v.adapter.CreateVaultSecret(ctx, map[string]any{"secretCode": secretCode, "secretName": secretCode, "secretType": "bank_account_number", "usageType": "custody", "ownerType": "finance_bank_account", "ownerKey": code, "storageBackend": "db_encrypted", "revealPolicy": "approval", "material": map[string]any{"plaintext": account}}, consoleapp.MutationMeta{IdempotencyKey: "wizbiz/" + p.BatchCode + "/" + code, RequestID: p.BatchCode, ActorID: p.Operator})
	if err != nil {
		return vaultCreateFailure(err)
	}
	return nil
}

func (v *runtimeVault) Check(ctx context.Context, code, hash, mask string) error {
	ref, err := SecretRef(code)
	if err != nil {
		return ErrVault
	}
	var ownerType, ownerKey, usage, status, contentHash, masked, kind, backend string
	if v.database.QueryRowContext(ctx, "SELECT s.owner_type,s.owner_key,s.usage_type,s.status,v.content_hash,s.masked_preview,s.secret_type,s.storage_backend FROM vault_secrets s JOIN vault_secret_versions v ON v.id=s.current_version_id WHERE BINARY s.secret_ref=BINARY ?", ref).Scan(&ownerType, &ownerKey, &usage, &status, &contentHash, &masked, &kind, &backend) != nil || kind != "bank_account_number" || backend != "db_encrypted" || ownerType != "finance_bank_account" || ownerKey != code || usage != "custody" || status != "active" || !vaultHashEquals(contentHash, hash) || masked != mask {
		return ErrVault
	}
	return nil
}

// Retire only secrets created by this exact batch's successful Console receipt.
// A reused or rotated secret is never disabled by migration rollback.
func (v *runtimeVault) Retire(ctx context.Context, code string, p Profile) error {
	tx, err := v.database.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return ErrVault
	}
	defer tx.Rollback()
	var created int
	if tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM console_mutation_receipts WHERE tenant_code=? AND operation_code='console.vault.secret.create' AND idempotency_key=? AND status='succeeded'", p.Tenant, "wizbiz/"+p.BatchCode+"/"+code).Scan(&created) != nil {
		return ErrVault
	}
	if created == 0 {
		return nil
	}
	if created != 1 {
		return ErrVault
	}
	ref, _ := SecretRef(code)
	var id, version int64
	var owner, ownerKey, usage, status string
	var versionNo int
	if tx.QueryRowContext(ctx, "SELECT s.id,s.current_version_id,s.owner_type,s.owner_key,s.usage_type,s.status,v.version_no FROM vault_secrets s JOIN vault_secret_versions v ON v.id=s.current_version_id WHERE BINARY secret_ref=BINARY ? FOR UPDATE", ref).Scan(&id, &version, &owner, &ownerKey, &usage, &status, &versionNo) != nil || owner != "finance_bank_account" || ownerKey != code || usage != "custody" || versionNo != 1 {
		return ErrVault
	}
	if status == "inactive" {
		return nil
	}
	if status != "active" {
		return ErrVault
	}
	if _, err = tx.ExecContext(ctx, "UPDATE vault_secrets SET status='inactive',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='active' AND current_version_id=?", id, version); err != nil {
		return ErrVault
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO vault_access_logs(secret_id,version_id,action,actor_type,actor_id,app_code,reason,approval_code,result_status,created_at) VALUES(?,?,'retire','human',?,'wizbiz-migration','migration rollback',?,'success',UTC_TIMESTAMP())", id, version, p.Operator, p.BatchCode); err != nil {
		return ErrVault
	}
	if tx.Commit() != nil {
		return ErrVault
	}
	return nil
}

func vaultHashEquals(stored, raw string) bool {
	return validHash(raw) && (stored == raw || stored == "sha256_"+raw)
}

func (v *runtimeVault) BatchCodes(ctx context.Context, p Profile) ([]string, error) {
	prefix := "wizbiz/" + p.BatchCode + "/"
	rows, err := v.database.QueryContext(ctx, "SELECT s.owner_key,s.owner_type,s.usage_type,s.secret_type FROM console_mutation_receipts r JOIN vault_secrets s ON BINARY s.secret_ref=BINARY JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.secretRef')) WHERE r.tenant_code=? AND r.operation_code='console.vault.secret.create' AND r.status='succeeded' AND BINARY LEFT(r.idempotency_key,?)=BINARY ?", p.Tenant, len(prefix), prefix)
	if err != nil {
		return nil, ErrVault
	}
	defer rows.Close()
	codes := []string{}
	for rows.Next() {
		var code, owner, usage, kind string
		if rows.Scan(&code, &owner, &usage, &kind) != nil || owner != "finance_bank_account" || usage != "custody" || kind != "bank_account_number" {
			return nil, ErrVault
		}
		if _, err := SecretRef(code); err != nil {
			return nil, ErrVault
		}
		codes = append(codes, code)
	}
	if rows.Err() != nil {
		return nil, ErrVault
	}
	return codes, nil
}

func vaultCreateFailure(err error) error {
	var dbError *mysql.MySQLError
	if errors.As(err, &dbError) {
		switch dbError.Number {
		case 1142, 1143, 1044, 1045:
			return gateFailure(ErrVault, "create_permission", "vault")
		case 1146, 1054:
			return gateFailure(ErrVault, "create_schema", "vault")
		default:
			return gateFailure(ErrVault, "create_database", "vault")
		}
	}
	var httpError httperror.Error
	if errors.As(err, &httpError) {
		switch httpError.Status {
		case 400:
			return gateFailure(ErrVault, "create_input", "vault")
		case 403:
			return gateFailure(ErrVault, "create_authorization", "vault")
		case 409:
			return gateFailure(ErrVault, "create_conflict", "vault")
		}
	}
	return gateFailure(ErrVault, "create_other", "vault")
}
