package console

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var vaultSecretCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{1,126}[A-Za-z0-9]$`)

var vaultCreateFields = map[string]bool{
	"secretCode": true, "secretName": true, "secretType": true, "usageType": true,
	"ownerType": true, "ownerKey": true, "storageBackend": true, "material": true,
	"revealPolicy": true, "expiresAt": true,
}

var vaultVersionFields = map[string]bool{
	"storageBackend": true, "material": true,
}

type vaultCurrentSecret struct {
	ID               uint64
	SecretCode       string
	SecretRef        string
	SecretName       string
	SecretType       string
	UsageType        string
	OwnerType        string
	OwnerKey         sql.NullString
	StorageBackend   string
	RevealPolicy     string
	MaskedPreview    sql.NullString
	Status           string
	CurrentVersionID sql.NullInt64
	VersionID        sql.NullInt64
	VersionNo        sql.NullInt64
	CiphertextBlob   []byte
	BackendSecretRef sql.NullString
	ContentHash      sql.NullString
	EncryptionScheme sql.NullString
}

type VaultAccessMeta struct {
	ActorType    string
	ActorID      string
	AppCode      string
	RequestIP    string
	UserAgent    string
	Reason       string
	ApprovalCode string
}

func (a *Adapter) ListVaultSecrets(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{}
	args := []any{}
	usageType := vaultText(query.Get("usageType"))
	if usageType == "" {
		usageType = vaultText(query.Get("usage_type"))
	}
	if usageType != "" {
		if _, err := normalizeVaultUsageType(usageType); err != nil {
			return nil, err
		}
		conditions = append(conditions, "vs.usage_type=?")
		args = append(args, usageType)
	}
	if status := vaultText(query.Get("status")); status != "" {
		if status != "active" && status != "inactive" && status != "retired" {
			return nil, httperror.New(http.StatusBadRequest, "console_vault_status_invalid", "Vault status is invalid")
		}
		conditions = append(conditions, "vs.status=?")
		args = append(args, status)
	}
	search := vaultText(query.Get("search"))
	if search == "" {
		search = vaultText(query.Get("keyword"))
	}
	if search != "" {
		if len(search) > 100 {
			return nil, httperror.New(http.StatusBadRequest, "console_vault_search_too_long", "Vault search is too long")
		}
		conditions = append(conditions, "(vs.secret_code LIKE ? OR vs.secret_name LIKE ? OR vs.owner_key LIKE ?)")
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern, pattern)
	}
	statement := `SELECT
		vs.secret_code,vs.secret_ref,vs.secret_name,vs.secret_type,vs.usage_type,
		vs.owner_type,vs.owner_key,vs.storage_backend,vs.reveal_policy,vs.masked_preview,
		DATE_FORMAT(vs.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		DATE_FORMAT(vs.last_rotated_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		vs.status,vsv.version_no,
		DATE_FORMAT(vs.created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		DATE_FORMAT(vs.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
		FROM vault_secrets vs
		LEFT JOIN vault_secret_versions vsv ON vsv.id=vs.current_version_id`
	if len(conditions) > 0 {
		statement += " WHERE " + strings.Join(conditions, " AND ")
	}
	statement += " ORDER BY vs.updated_at DESC,vs.id DESC LIMIT 200"
	rows, err := a.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var secretCode, secretRef, secretName, secretType, itemUsageType, ownerType string
		var storageBackend, revealPolicy, status string
		var ownerKey, maskedPreview, expiresAt, lastRotatedAt, createdAt, updatedAt sql.NullString
		var versionNo sql.NullInt64
		if err := rows.Scan(
			&secretCode, &secretRef, &secretName, &secretType, &itemUsageType,
			&ownerType, &ownerKey, &storageBackend, &revealPolicy, &maskedPreview,
			&expiresAt, &lastRotatedAt, &status, &versionNo, &createdAt, &updatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"secretCode": secretCode, "secretRef": secretRef, "secretName": secretName,
			"secretType": secretType, "usageType": itemUsageType, "ownerType": ownerType,
			"ownerKey": nullableVaultString(ownerKey), "storageBackend": storageBackend,
			"revealPolicy": revealPolicy, "maskedPreview": nullableVaultString(maskedPreview),
			"currentVersionNo": nullableVaultInt(versionNo), "expiresAt": nullableVaultString(expiresAt),
			"lastRotatedAt": nullableVaultString(lastRotatedAt), "status": status,
			"createdAt": nullableVaultString(createdAt), "updatedAt": nullableVaultString(updatedAt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) CreateVaultSecret(
	ctx context.Context,
	body map[string]any,
	meta MutationMeta,
) (result map[string]any, err error) {
	if err = rejectVaultFields(body, vaultCreateFields); err != nil {
		return nil, err
	}
	secretCode, err := normalizeVaultCode(body["secretCode"])
	if err != nil {
		return nil, err
	}
	secretName := vaultFirstText(body["secretName"], secretCode)
	secretType := vaultFirstText(body["secretType"], "api_key")
	usageType, err := normalizeVaultUsageType(body["usageType"])
	if err != nil {
		return nil, err
	}
	ownerType := vaultFirstText(body["ownerType"], usageType)
	ownerKey := nullableVaultText(body["ownerKey"])
	storageBackend, err := normalizeVaultStorageBackend(body["storageBackend"], "")
	if err != nil {
		return nil, err
	}
	material, err := normalizeVaultMaterial(storageBackend, vaultRecord(body["material"]), a)
	if err != nil {
		return nil, err
	}
	expiresAt, err := parseVaultExpiry(body["expiresAt"])
	if err != nil {
		return nil, err
	}
	revealPolicy := vaultFirstText(body["revealPolicy"], "approval")
	payload := map[string]any{
		"secretCode": secretCode, "secretName": secretName, "secretType": secretType,
		"usageType": usageType, "ownerType": ownerType, "ownerKey": ownerKey,
		"storageBackend": storageBackend, "revealPolicy": revealPolicy,
		"expiresAt": expiresAt, "materialSupplied": true,
	}
	session, replay, err := a.beginMutation(ctx, "console.vault.secret.create",
		meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()
	var existing int
	if err = session.tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM vault_secrets WHERE secret_code=? OR secret_ref=?",
		secretCode, "hzybase://vault/"+secretCode).Scan(&existing); err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, httperror.New(http.StatusConflict, "console_vault_secret_exists", "Vault secret already exists")
	}
	secretInsert, err := session.tx.ExecContext(ctx, `INSERT INTO vault_secrets (
		secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
		storage_backend,reveal_policy,masked_preview,expires_at,status,created_by,created_at,updated_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		secretCode, "hzybase://vault/"+secretCode, secretName, secretType, usageType,
		ownerType, ownerKey, storageBackend, revealPolicy, material.MaskedPreview, expiresAt, meta.ActorID)
	if err != nil {
		return nil, err
	}
	secretID, err := secretInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	versionInsert, err := session.tx.ExecContext(ctx, `INSERT INTO vault_secret_versions (
		secret_id,version_no,ciphertext_blob,backend_secret_ref,content_hash,encryption_scheme,
		key_fingerprint,status,activated_at,created_by,created_at
	) VALUES (?,1,?,?,?,?,?,'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())`,
		secretID, nullableVaultBytes(material.CiphertextBlob), material.BackendSecretRef,
		material.ContentHash, material.EncryptionScheme, material.KeyFingerprint, meta.ActorID)
	if err != nil {
		return nil, err
	}
	versionID, err := versionInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE vault_secrets
		SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE id=?`, versionID, secretID); err != nil {
		return nil, err
	}
	if err = insertVaultAccessLog(ctx, session.tx, secretID, versionID, "rotate",
		VaultAccessMeta{ActorType: "human", ActorID: meta.ActorID, Reason: "create_secret"}, "success"); err != nil {
		return nil, err
	}
	result = map[string]any{
		"secretCode": secretCode, "secretRef": "hzybase://vault/" + secretCode,
		"secretName": secretName, "secretType": secretType, "usageType": usageType,
		"storageBackend": storageBackend, "maskedPreview": material.MaskedPreview,
		"currentVersionNo": 1, "status": "active", "receiptId": session.receiptID,
	}
	err = a.finishMutation(ctx, session, "vault", "create", "vault_secret", secretCode,
		map[string]any{"secretCode": secretCode, "storageBackend": storageBackend}, result)
	return result, err
}

func (a *Adapter) AddVaultSecretVersion(
	ctx context.Context,
	secretCode string,
	body map[string]any,
	setCurrent bool,
	meta MutationMeta,
) (result map[string]any, err error) {
	if err = rejectVaultFields(body, vaultVersionFields); err != nil {
		return nil, err
	}
	secretCode, err = normalizeVaultCode(secretCode)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"secretCode": secretCode, "storageBackend": vaultText(body["storageBackend"]),
		"setCurrent": setCurrent, "materialSupplied": body["material"] != nil,
	}
	operation := "console.vault.version.append"
	if setCurrent {
		operation = "console.vault.secret.rotate"
	}
	session, replay, err := a.beginMutation(ctx, operation,
		meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()
	secret, err := loadVaultSecretTx(ctx, session.tx, secretCode)
	if err != nil {
		return nil, err
	}
	storageBackend, err := normalizeVaultStorageBackend(body["storageBackend"], secret.StorageBackend)
	if err != nil {
		return nil, err
	}
	material, err := normalizeVaultMaterial(storageBackend, vaultRecord(body["material"]), a)
	if err != nil {
		return nil, err
	}
	var versionNo uint64
	if err = session.tx.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version_no),0)+1 FROM vault_secret_versions WHERE secret_id=? FOR UPDATE",
		secret.ID).Scan(&versionNo); err != nil {
		return nil, err
	}
	versionInsert, err := session.tx.ExecContext(ctx, `INSERT INTO vault_secret_versions (
		secret_id,version_no,ciphertext_blob,backend_secret_ref,content_hash,encryption_scheme,
		key_fingerprint,rotated_from_id,status,activated_at,created_by,created_at
	) VALUES (?,?,?,?,?,?,?,?, 'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())`,
		secret.ID, versionNo, nullableVaultBytes(material.CiphertextBlob), material.BackendSecretRef,
		material.ContentHash, material.EncryptionScheme, material.KeyFingerprint,
		nullableVaultInt64(secret.CurrentVersionID), meta.ActorID)
	if err != nil {
		return nil, err
	}
	versionID, err := versionInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	if setCurrent {
		if _, err = session.tx.ExecContext(ctx, `UPDATE vault_secret_versions
			SET status='retired',retired_at=COALESCE(retired_at,UTC_TIMESTAMP())
			WHERE secret_id=? AND id<>? AND status='active'`, secret.ID, versionID); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE vault_secrets
			SET current_version_id=?,storage_backend=?,masked_preview=?,
				last_rotated_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE id=?`, versionID, storageBackend, material.MaskedPreview, secret.ID); err != nil {
			return nil, err
		}
	}
	reason := "append_version"
	if setCurrent {
		reason = "rotate_current"
	}
	if err = insertVaultAccessLog(ctx, session.tx, int64(secret.ID), versionID, "rotate",
		VaultAccessMeta{ActorType: "human", ActorID: meta.ActorID, Reason: reason}, "success"); err != nil {
		return nil, err
	}
	result = map[string]any{
		"secretCode": secret.SecretCode, "secretRef": secret.SecretRef,
		"versionNo": versionNo, "current": setCurrent, "status": "active",
		"receiptId": session.receiptID,
	}
	action := "append_version"
	if setCurrent {
		action = "rotate"
	}
	err = a.finishMutation(ctx, session, "vault", action, "vault_secret", secretCode,
		map[string]any{"secretCode": secretCode, "versionNo": versionNo, "current": setCurrent}, result)
	return result, err
}

func (a *Adapter) RevealVaultSecret(
	ctx context.Context,
	secretCode string,
	versionNo any,
	meta VaultAccessMeta,
) (map[string]any, error) {
	secret, err := a.loadVaultSecret(ctx, secretCode, versionNo)
	if err != nil {
		return nil, err
	}
	value, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend, secret.CiphertextBlob,
		secret.BackendSecretRef.String, secret.ContentHash.String,
	)
	resultStatus := "success"
	if resolveErr != nil {
		resultStatus = "failed"
	}
	logErr := insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "reveal", meta, resultStatus)
	if resolveErr != nil {
		return nil, resolveErr
	}
	if logErr != nil {
		return nil, logErr
	}
	return map[string]any{
		"secretCode": secret.SecretCode, "secretRef": secret.SecretRef,
		"secretName": secret.SecretName, "secretType": secret.SecretType,
		"usageType": secret.UsageType, "ownerType": secret.OwnerType,
		"ownerKey": nullableVaultString(secret.OwnerKey), "storageBackend": secret.StorageBackend,
		"revealPolicy": secret.RevealPolicy, "maskedPreview": nullableVaultString(secret.MaskedPreview),
		"currentVersionNo": nullableVaultInt(secret.VersionNo), "status": secret.Status,
		"versionNo": nullableVaultInt(secret.VersionNo), "plaintext": value,
		"revealedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (a *Adapter) ResolveVaultSecret(
	ctx context.Context,
	secretCodeOrRef string,
	versionNo any,
	meta VaultAccessMeta,
) (map[string]any, error) {
	secret, err := a.loadVaultSecret(ctx, secretCodeOrRef, versionNo)
	if err != nil {
		return nil, err
	}
	if secret.UsageType == "custody" {
		_ = insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, "denied")
		return nil, httperror.New(http.StatusForbidden, "console_vault_custody_forbidden", "Custody secret cannot be resolved programmatically")
	}
	value, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend, secret.CiphertextBlob,
		secret.BackendSecretRef.String, secret.ContentHash.String,
	)
	status := "success"
	if resolveErr != nil {
		status = "failed"
	}
	logErr := insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, status)
	if resolveErr != nil {
		return nil, resolveErr
	}
	if logErr != nil {
		return nil, logErr
	}
	return map[string]any{
		"secretCode": secret.SecretCode, "secretRef": secret.SecretRef,
		"versionNo": nullableVaultInt(secret.VersionNo), "value": value,
	}, nil
}

type vaultSQLRunner interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func loadVaultSecretTx(ctx context.Context, tx *sql.Tx, secretCode string) (vaultCurrentSecret, error) {
	return queryVaultSecret(ctx, tx, secretCode, nil, true)
}

func (a *Adapter) loadVaultSecret(ctx context.Context, value string, versionNo any) (vaultCurrentSecret, error) {
	return queryVaultSecret(ctx, a.db, value, versionNo, false)
}

func queryVaultSecret(
	ctx context.Context,
	runner vaultSQLRunner,
	value string,
	versionNo any,
	lock bool,
) (vaultCurrentSecret, error) {
	var secret vaultCurrentSecret
	value = vaultText(value)
	if value == "" {
		return secret, httperror.New(http.StatusBadRequest, "console_vault_secret_required", "secretCode or secretRef is required")
	}
	explicitVersion, err := parseVaultVersion(value, versionNo)
	if err != nil {
		return secret, err
	}
	baseValue := explicitVersion.BaseValue
	lookup := "vs.secret_code=?"
	args := []any{baseValue}
	if strings.HasPrefix(baseValue, "hzybase://vault/") {
		code := strings.TrimPrefix(baseValue, "hzybase://vault/")
		lookup = "(vs.secret_ref=? OR vs.secret_code=?)"
		args = []any{baseValue, code}
	}
	versionJoin := "vsv.id=vs.current_version_id"
	if explicitVersion.VersionNo > 0 {
		versionJoin = "vsv.secret_id=vs.id AND vsv.version_no=?"
		args = append([]any{explicitVersion.VersionNo}, args...)
	}
	statement := `SELECT
		vs.id,vs.secret_code,vs.secret_ref,vs.secret_name,vs.secret_type,vs.usage_type,
		vs.owner_type,vs.owner_key,vs.storage_backend,vs.reveal_policy,vs.masked_preview,
		vs.status,vs.current_version_id,vsv.id,vsv.version_no,vsv.ciphertext_blob,
		vsv.backend_secret_ref,vsv.content_hash,vsv.encryption_scheme
		FROM vault_secrets vs
		INNER JOIN vault_secret_versions vsv ON ` + versionJoin + `
		WHERE ` + lookup + ` AND vs.status='active' AND vsv.status='active' LIMIT 1`
	if lock {
		statement += " FOR UPDATE"
	}
	err = runner.QueryRowContext(ctx, statement, args...).Scan(
		&secret.ID, &secret.SecretCode, &secret.SecretRef, &secret.SecretName,
		&secret.SecretType, &secret.UsageType, &secret.OwnerType, &secret.OwnerKey,
		&secret.StorageBackend, &secret.RevealPolicy, &secret.MaskedPreview,
		&secret.Status, &secret.CurrentVersionID, &secret.VersionID, &secret.VersionNo,
		&secret.CiphertextBlob, &secret.BackendSecretRef, &secret.ContentHash,
		&secret.EncryptionScheme,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return secret, httperror.New(http.StatusNotFound, "console_vault_secret_not_found", "Vault secret was not found")
	}
	return secret, err
}

func insertVaultAccessLog(
	ctx context.Context,
	runner vaultSQLRunner,
	secretID int64,
	versionID int64,
	action string,
	meta VaultAccessMeta,
	status string,
) error {
	actorType := vaultFirstText(meta.ActorType, "human")
	_, err := runner.ExecContext(ctx, `INSERT INTO vault_access_logs (
		secret_id,version_id,action,actor_type,actor_id,app_code,reason,approval_code,
		request_ip,user_agent,result_status,created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
		secretID, nullableVaultPositive(versionID), action, actorType, nullableVaultText(meta.ActorID),
		nullableVaultText(meta.AppCode), nullableVaultText(meta.Reason), nullableVaultText(meta.ApprovalCode),
		nullableVaultText(meta.RequestIP), nullableVaultText(meta.UserAgent), status)
	return err
}

func normalizeVaultCode(value any) (string, error) {
	code := vaultText(value)
	if !vaultSecretCodePattern.MatchString(code) {
		return "", httperror.New(http.StatusBadRequest, "console_vault_secret_code_invalid", "Vault secretCode is invalid")
	}
	return code, nil
}

func normalizeVaultStorageBackend(value any, fallback string) (string, error) {
	backend := vaultText(value)
	if backend == "" {
		backend = fallback
	}
	if backend == "" {
		backend = "db_encrypted"
	}
	switch backend {
	case "db_encrypted", "env_ref", "docker_secret", "k8s_secret":
		return backend, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "console_vault_storage_backend_invalid", "Vault storageBackend is invalid")
	}
}

func normalizeVaultUsageType(value any) (string, error) {
	usage := vaultFirstText(value, "integration")
	switch usage {
	case "integration", "service", "bootstrap", "custody":
		return usage, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "console_vault_usage_type_invalid", "Vault usageType is invalid")
	}
}

func rejectVaultFields(body map[string]any, allowed map[string]bool) error {
	for key := range body {
		if !allowed[key] {
			return httperror.New(http.StatusBadRequest, "console_vault_field_not_writable", "Vault field is not writable: "+key)
		}
	}
	return nil
}

func parseVaultExpiry(value any) (any, error) {
	text := vaultText(value)
	if text == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_vault_expiry_invalid", "Vault expiresAt is invalid")
	}
	return parsed.UTC(), nil
}

type parsedVaultVersion struct {
	BaseValue string
	VersionNo uint64
}

func parseVaultVersion(value string, explicit any) (parsedVaultVersion, error) {
	result := parsedVaultVersion{BaseValue: value}
	if text := vaultText(explicit); text != "" {
		version, err := strconv.ParseUint(text, 10, 64)
		if err != nil || version == 0 {
			return result, httperror.New(http.StatusBadRequest, "console_vault_version_invalid", "Vault versionNo is invalid")
		}
		result.VersionNo = version
		return result, nil
	}
	match := regexp.MustCompile(`@v([0-9]+)$`).FindStringSubmatch(value)
	if len(match) == 2 {
		version, _ := strconv.ParseUint(match[1], 10, 64)
		result.VersionNo = version
		result.BaseValue = strings.TrimSuffix(value, match[0])
	}
	return result, nil
}

func vaultRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func vaultText(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func vaultFirstText(value any, fallback string) string {
	if text := vaultText(value); text != "" {
		return text
	}
	return fallback
}

func nullableVaultText(value any) any {
	if text := vaultText(value); text != "" {
		return text
	}
	return nil
}

func nullableVaultBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func nullableVaultString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullableVaultInt(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}

func nullableVaultInt64(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}

func nullableVaultPositive(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}
