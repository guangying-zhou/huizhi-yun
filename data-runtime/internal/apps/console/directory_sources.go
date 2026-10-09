package console

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var directorySourceProviders = map[string]struct {
	Name       string
	SecretCode string
}{
	"ldap":     {Name: "LDAP 目录源", SecretCode: "directory.ldap.bind_password"},
	"wecom":    {Name: "企业微信通讯录", SecretCode: "directory.wecom.contact_secret"},
	"dingtalk": {Name: "钉钉通讯录", SecretCode: "directory.dingtalk.app_secret"},
}

var directorySourceFields = map[string]bool{
	"providerCode": true, "integrationName": true, "baseUrl": true,
	"config": true, "credential": true, "status": true,
}

var directorySourceCredentialFields = map[string]bool{
	"secretCode": true, "secretName": true, "storageBackend": true,
	"backendSecretRef": true, "plaintext": true,
}

type directorySourceRow struct {
	ID                  uint64
	IntegrationCode     string
	IntegrationType     string
	IntegrationName     string
	ProviderCode        string
	BaseURL             sql.NullString
	ConfigJSON          []byte
	ConnectivityStatus  string
	LastCheckedAt       sql.NullTime
	LastErrorMessage    sql.NullString
	Status              string
	CurrentCredentialID sql.NullInt64
	SecretCode          sql.NullString
	SecretRef           sql.NullString
	StorageBackend      sql.NullString
	BackendSecretRef    sql.NullString
	CredentialStatus    sql.NullString
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type directorySourceQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const directorySourceSelect = `SELECT
	i.id,i.integration_code,i.integration_type,i.integration_name,i.provider_code,
	i.base_url,i.config_json,i.connectivity_status,i.last_checked_at,
	i.last_error_message,i.status,i.current_credential_id,
	vs.secret_code,vs.secret_ref,vs.storage_backend,vsv.backend_secret_ref,
	ic.status,i.created_at,i.updated_at
	FROM integrations i
	LEFT JOIN integration_credentials ic
	  ON ic.id=i.current_credential_id AND ic.integration_id=i.id
	LEFT JOIN vault_secrets vs ON vs.id=ic.secret_id
	LEFT JOIN vault_secret_versions vsv
	  ON vsv.id=COALESCE(ic.secret_version_id,vs.current_version_id)
	 AND vsv.secret_id=vs.id`

func normalizeDirectoryProvider(value any) (string, error) {
	provider := strings.ToLower(vaultText(value))
	if _, ok := directorySourceProviders[provider]; !ok {
		return "", httperror.New(http.StatusBadRequest, "console_directory_source_provider_invalid", "Directory source provider is invalid")
	}
	return provider, nil
}

func directoryIntegrationCode(provider string) string {
	return "directory." + provider
}

func rejectDirectorySourceFields(body map[string]any) error {
	for key := range body {
		if !directorySourceFields[key] {
			return httperror.New(http.StatusBadRequest, "console_directory_source_field_not_writable", "Directory source field is not writable: "+key)
		}
	}
	return nil
}

func normalizeDirectorySourceStatus(value any) (string, error) {
	status := vaultFirstText(value, "active")
	if status != "active" && status != "inactive" {
		return "", httperror.New(http.StatusBadRequest, "console_directory_source_status_invalid", "Directory source status is invalid")
	}
	return status, nil
}

func normalizeDirectorySourceConfig(value any) (map[string]any, []byte, error) {
	config := vaultRecord(value)
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, nil, httperror.New(http.StatusBadRequest, "console_directory_source_config_invalid", "Directory source config is invalid")
	}
	if len(encoded) > 64*1024 {
		return nil, nil, httperror.New(http.StatusRequestEntityTooLarge, "console_directory_source_config_too_large", "Directory source config is too large")
	}
	if key := directorySourceSecretConfigKey(config); key != "" {
		return nil, nil, httperror.New(http.StatusBadRequest, "console_directory_source_secret_in_config", "Secret material must use credential/Vault, not config: "+key)
	}
	return config, encoded, nil
}

func directorySourceSecretConfigKey(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
			switch normalized {
			case "password", "bindpassword", "secret", "clientsecret", "appsecret",
				"token", "accesstoken", "refreshtoken", "privatekey":
				return key
			}
			if nested := directorySourceSecretConfigKey(child); nested != "" {
				return key + "." + nested
			}
		}
	case []any:
		for index, child := range typed {
			if nested := directorySourceSecretConfigKey(child); nested != "" {
				return fmt.Sprintf("%d.%s", index, nested)
			}
		}
	}
	return ""
}

func scanDirectorySource(scanner interface{ Scan(...any) error }) (directorySourceRow, error) {
	var row directorySourceRow
	err := scanner.Scan(
		&row.ID, &row.IntegrationCode, &row.IntegrationType, &row.IntegrationName,
		&row.ProviderCode, &row.BaseURL, &row.ConfigJSON, &row.ConnectivityStatus,
		&row.LastCheckedAt, &row.LastErrorMessage, &row.Status,
		&row.CurrentCredentialID, &row.SecretCode, &row.SecretRef,
		&row.StorageBackend, &row.BackendSecretRef, &row.CredentialStatus,
		&row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

func mapDirectorySource(row directorySourceRow) map[string]any {
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	var credential any
	if row.SecretCode.Valid {
		credential = map[string]any{
			"secretCode":             row.SecretCode.String,
			"secretRef":              row.SecretRef.String,
			"storageBackend":         row.StorageBackend.String,
			"backendSecretRefMasked": maskDirectoryBackendRef(row.BackendSecretRef.String),
			"status":                 nullableVaultString(row.CredentialStatus),
		}
	}
	return map[string]any{
		"providerCode": row.ProviderCode, "integrationCode": row.IntegrationCode,
		"integrationType": row.IntegrationType, "integrationName": row.IntegrationName,
		"baseUrl": nullableVaultString(row.BaseURL), "config": config,
		"connectivityStatus": row.ConnectivityStatus,
		"lastCheckedAt":      nullableDirectoryTime(row.LastCheckedAt),
		"lastErrorMessage":   nullableVaultString(row.LastErrorMessage),
		"status":             row.Status, "credential": credential,
		"createdAt": row.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updatedAt": row.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func nullableDirectoryTime(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time.UTC().Format(time.RFC3339Nano)
}

func maskDirectoryBackendRef(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if len(value) <= 8 {
		return "********"
	}
	return value[:4] + "****" + value[len(value)-4:]
}

func queryDirectorySource(
	ctx context.Context,
	runner directorySourceQueryer,
	provider string,
	lock bool,
) (directorySourceRow, error) {
	statement := directorySourceSelect + " WHERE i.integration_code=? LIMIT 1"
	if lock {
		statement += " FOR UPDATE"
	}
	row, err := scanDirectorySource(runner.QueryRowContext(ctx, statement, directoryIntegrationCode(provider)))
	if errors.Is(err, sql.ErrNoRows) {
		return row, httperror.New(http.StatusNotFound, "console_directory_source_not_found", "Directory source was not found")
	}
	return row, err
}

func (a *Adapter) ListDirectorySources(ctx context.Context) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, directorySourceSelect+
		" WHERE i.category='directory' ORDER BY FIELD(i.provider_code,'ldap','wecom','dingtalk'),i.integration_code")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		row, scanErr := scanDirectorySource(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, mapDirectorySource(row))
	}
	return items, rows.Err()
}

func (a *Adapter) DirectorySource(ctx context.Context, provider any) (map[string]any, error) {
	normalized, err := normalizeDirectoryProvider(provider)
	if err != nil {
		return nil, err
	}
	row, err := queryDirectorySource(ctx, a.db, normalized, false)
	if err != nil {
		return nil, err
	}
	return mapDirectorySource(row), nil
}

func (a *Adapter) UpsertDirectorySource(
	ctx context.Context,
	pathProvider string,
	body map[string]any,
	meta MutationMeta,
) (result map[string]any, err error) {
	if err = rejectDirectorySourceFields(body); err != nil {
		return nil, err
	}
	providerValue := body["providerCode"]
	if strings.TrimSpace(pathProvider) != "" {
		if vaultText(providerValue) != "" && !strings.EqualFold(vaultText(providerValue), pathProvider) {
			return nil, httperror.New(http.StatusBadRequest, "console_directory_source_provider_mismatch", "Directory source provider does not match request path")
		}
		providerValue = pathProvider
	}
	provider, err := normalizeDirectoryProvider(providerValue)
	if err != nil {
		return nil, err
	}
	definition := directorySourceProviders[provider]
	integrationName := vaultFirstText(body["integrationName"], definition.Name)
	if len(integrationName) > 255 {
		return nil, httperror.New(http.StatusBadRequest, "console_directory_source_name_too_long", "Directory source name is too long")
	}
	baseURL := vaultText(body["baseUrl"])
	if len(baseURL) > 255 {
		return nil, httperror.New(http.StatusBadRequest, "console_directory_source_url_too_long", "Directory source baseUrl is too long")
	}
	status, err := normalizeDirectorySourceStatus(body["status"])
	if err != nil {
		return nil, err
	}
	_, configJSON, err := normalizeDirectorySourceConfig(body["config"])
	if err != nil {
		return nil, err
	}
	credential := vaultRecord(body["credential"])
	hasCredential := body["credential"] != nil && len(credential) > 0
	var secretCode, secretName, storageBackend string
	var material vaultMaterial
	if hasCredential {
		for key := range credential {
			if !directorySourceCredentialFields[key] {
				return nil, httperror.New(http.StatusBadRequest, "console_directory_source_credential_field_invalid", "Directory source credential field is invalid: "+key)
			}
		}
		secretCode, err = normalizeVaultCode(vaultFirstText(credential["secretCode"], definition.SecretCode))
		if err != nil {
			return nil, err
		}
		secretName = vaultFirstText(credential["secretName"], integrationName+" Secret")
		storageBackend, err = normalizeVaultStorageBackend(credential["storageBackend"], "")
		if err != nil {
			return nil, err
		}
		material, err = normalizeVaultMaterial(storageBackend, map[string]any{
			"plaintext":        credential["plaintext"],
			"backendSecretRef": credential["backendSecretRef"],
		}, a)
		if err != nil {
			return nil, err
		}
	}
	payload := map[string]any{
		"providerCode": provider, "integrationName": integrationName,
		"baseUrl": nullableVaultText(baseURL), "status": status,
		"config": json.RawMessage(configJSON), "credentialSupplied": hasCredential,
		"secretCode": nullableVaultText(secretCode), "storageBackend": nullableVaultText(storageBackend),
	}
	session, replay, err := a.beginMutation(ctx, "console.directory-source.upsert",
		meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()

	var integrationID uint64
	var currentCredentialID sql.NullInt64
	queryErr := session.tx.QueryRowContext(ctx,
		"SELECT id,current_credential_id FROM integrations WHERE integration_code=? LIMIT 1 FOR UPDATE",
		directoryIntegrationCode(provider)).Scan(&integrationID, &currentCredentialID)
	if errors.Is(queryErr, sql.ErrNoRows) {
		insert, insertErr := session.tx.ExecContext(ctx, `INSERT INTO integrations (
			integration_code,integration_type,integration_name,category,provider_code,
			base_url,config_json,status,created_by,created_at,updated_at
		) VALUES (?,'directory_source',?,'directory',?,?,CAST(? AS JSON),?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			directoryIntegrationCode(provider), integrationName, provider, nullableVaultText(baseURL),
			string(configJSON), status, truncateDirectoryActor(meta.ActorID))
		if insertErr != nil {
			return nil, insertErr
		}
		insertID, insertErr := insert.LastInsertId()
		if insertErr != nil {
			return nil, insertErr
		}
		integrationID = uint64(insertID)
	} else if queryErr != nil {
		return nil, queryErr
	} else {
		if _, err = session.tx.ExecContext(ctx, `UPDATE integrations SET
			integration_name=?,provider_code=?,base_url=?,config_json=CAST(? AS JSON),
			status=?,updated_at=UTC_TIMESTAMP() WHERE id=?`,
			integrationName, provider, nullableVaultText(baseURL), string(configJSON), status, integrationID); err != nil {
			return nil, err
		}
	}

	if hasCredential {
		secretID, secretVersionID, persistErr := a.persistDirectorySourceSecret(
			ctx, session.tx, provider, secretCode, secretName, storageBackend, material, meta.ActorID,
		)
		if persistErr != nil {
			return nil, persistErr
		}
		var credentialVersion uint64
		if err = session.tx.QueryRowContext(ctx,
			"SELECT COALESCE(MAX(version_no),0)+1 FROM integration_credentials WHERE integration_id=? FOR UPDATE",
			integrationID).Scan(&credentialVersion); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx,
			"UPDATE integration_credentials SET status='inactive' WHERE integration_id=? AND status='active'",
			integrationID); err != nil {
			return nil, err
		}
		credentialInsert, insertErr := session.tx.ExecContext(ctx, `INSERT INTO integration_credentials (
			integration_id,credential_name,credential_role,version_no,secret_id,secret_version_id,
			rotated_from_id,status,issued_at
		) VALUES (?,'primary','primary',?,?,?,?, 'active',UTC_TIMESTAMP())`,
			integrationID, credentialVersion, secretID, secretVersionID, nullableVaultInt64(currentCredentialID))
		if insertErr != nil {
			return nil, insertErr
		}
		credentialID, insertErr := credentialInsert.LastInsertId()
		if insertErr != nil {
			return nil, insertErr
		}
		if _, err = session.tx.ExecContext(ctx,
			"UPDATE integrations SET current_credential_id=?,updated_at=UTC_TIMESTAMP() WHERE id=?",
			credentialID, integrationID); err != nil {
			return nil, err
		}
	}

	source, err := queryDirectorySource(ctx, session.tx, provider, false)
	if err != nil {
		return nil, err
	}
	result = mapDirectorySource(source)
	result["receiptId"] = session.receiptID
	err = a.finishMutation(ctx, session, "integration", "upsert", "directory_source",
		directoryIntegrationCode(provider), map[string]any{
			"providerCode": provider, "status": status, "credentialUpdated": hasCredential,
		}, result)
	return result, err
}

func (a *Adapter) persistDirectorySourceSecret(
	ctx context.Context,
	tx *sql.Tx,
	provider string,
	secretCode string,
	secretName string,
	storageBackend string,
	material vaultMaterial,
	actorID string,
) (uint64, uint64, error) {
	ownerKey := directoryIntegrationCode(provider)
	var secretID uint64
	var currentVersionID sql.NullInt64
	var usageType, ownerType string
	var existingOwnerKey sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT id,current_version_id,usage_type,owner_type,owner_key
		FROM vault_secrets WHERE secret_code=? LIMIT 1 FOR UPDATE`, secretCode).
		Scan(&secretID, &currentVersionID, &usageType, &ownerType, &existingOwnerKey)
	if errors.Is(err, sql.ErrNoRows) {
		insert, insertErr := tx.ExecContext(ctx, `INSERT INTO vault_secrets (
			secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
			storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at
		) VALUES (?,? ,?,'client_secret','integration','integration',?,?,'approval',?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			secretCode, "hzybase://vault/"+secretCode, secretName, ownerKey,
			storageBackend, material.MaskedPreview, truncateDirectoryActor(actorID))
		if insertErr != nil {
			return 0, 0, insertErr
		}
		insertID, insertErr := insert.LastInsertId()
		if insertErr != nil {
			return 0, 0, insertErr
		}
		secretID = uint64(insertID)
	} else if err != nil {
		return 0, 0, err
	} else {
		if usageType != "integration" || ownerType != "integration" ||
			(existingOwnerKey.Valid && existingOwnerKey.String != ownerKey) {
			return 0, 0, httperror.New(http.StatusConflict, "console_directory_source_secret_owner_conflict", "Vault secret is owned by another purpose")
		}
	}
	var versionNo uint64
	if err = tx.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version_no),0)+1 FROM vault_secret_versions WHERE secret_id=? FOR UPDATE",
		secretID).Scan(&versionNo); err != nil {
		return 0, 0, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vault_secret_versions
		SET status='retired',retired_at=COALESCE(retired_at,UTC_TIMESTAMP())
		WHERE secret_id=? AND status='active'`, secretID); err != nil {
		return 0, 0, err
	}
	versionInsert, err := tx.ExecContext(ctx, `INSERT INTO vault_secret_versions (
		secret_id,version_no,ciphertext_blob,backend_secret_ref,content_hash,encryption_scheme,
		key_fingerprint,rotated_from_id,status,activated_at,created_by,created_at
	) VALUES (?,?,?,?,?,?,?,?, 'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())`,
		secretID, versionNo, nullableVaultBytes(material.CiphertextBlob), material.BackendSecretRef,
		material.ContentHash, material.EncryptionScheme, material.KeyFingerprint,
		nullableVaultInt64(currentVersionID), truncateDirectoryActor(actorID))
	if err != nil {
		return 0, 0, err
	}
	versionID, err := versionInsert.LastInsertId()
	if err != nil {
		return 0, 0, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vault_secrets SET
		secret_name=?,storage_backend=?,masked_preview=?,current_version_id=?,
		last_rotated_at=UTC_TIMESTAMP(),status='active',updated_at=UTC_TIMESTAMP()
		WHERE id=?`, secretName, storageBackend, material.MaskedPreview, versionID, secretID); err != nil {
		return 0, 0, err
	}
	if err = insertVaultAccessLog(ctx, tx, int64(secretID), versionID, "rotate",
		VaultAccessMeta{
			ActorType: "human", ActorID: actorID, AppCode: "console",
			Reason: "directory_source_credential_update",
		}, "success"); err != nil {
		return 0, 0, err
	}
	return secretID, uint64(versionID), nil
}

func truncateDirectoryActor(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 64 {
		return value[:64]
	}
	return value
}

func (a *Adapter) DirectoryConnectorConfiguration(
	ctx context.Context,
	connectorID string,
	tenantCode string,
	deploymentCode string,
) (map[string]any, error) {
	var publicKeyPEM string
	err := a.db.QueryRowContext(ctx, `SELECT public_key_pem
		FROM directory_connectors
		WHERE connector_id=? AND tenant_code=? AND deployment_code=? AND status='active'
		LIMIT 1`, connectorID, tenantCode, deploymentCode).Scan(&publicKeyPEM)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_not_registered", "Directory Connector is not registered")
	}
	if err != nil {
		return nil, err
	}
	source, err := queryDirectorySource(ctx, a.db, "ldap", false)
	if err != nil {
		return nil, err
	}
	if source.Status != "active" {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_inactive", "LDAP directory source is not active")
	}
	config := map[string]any{}
	if len(source.ConfigJSON) > 0 {
		if err = json.Unmarshal(source.ConfigJSON, &config); err != nil {
			return nil, httperror.New(http.StatusConflict, "directory_ldap_config_invalid", "LDAP directory source config is invalid")
		}
	}
	if vaultText(config["managementMode"]) != "managed" {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_not_managed", "LDAP directory source is not enabled in managed mode")
	}
	host := vaultText(config["host"])
	baseDN := vaultText(config["baseDN"])
	userBase := vaultFirstText(config["userBase"], baseDN)
	bindDN := vaultText(config["bindDN"])
	if host == "" || userBase == "" || bindDN == "" || !source.SecretCode.Valid {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_config_incomplete", "LDAP directory source is missing host, bind DN, user base, or credential")
	}
	resolved, err := a.ResolveVaultSecret(ctx, source.SecretCode.String, nil, VaultAccessMeta{
		ActorType: "service", ActorID: connectorID, AppCode: "directory-connector",
		Reason: "directory_connector_configuration",
	})
	if err != nil {
		return nil, err
	}
	secretValue := vaultText(resolved["value"])
	ciphertext, err := encryptDirectoryConnectorSecret(publicKeyPEM, secretValue)
	if err != nil {
		return nil, err
	}
	useTLS, hasUseTLS := config["useTLS"].(bool)
	if !hasUseTLS {
		useTLS = true
	}
	transport := vaultText(config["transport"])
	if transport == "" {
		if useTLS {
			transport = "ldaps"
		} else {
			transport = "starttls"
		}
	}
	port := directoryConfigInt(config["port"], 0)
	if port == 0 {
		if useTLS {
			port = 636
		} else {
			port = 389
		}
	}
	directoryType := vaultFirstText(config["directoryType"], "openldap")
	userFilter := vaultText(config["userFilter"])
	if userFilter == "" {
		if directoryType == "active-directory" {
			userFilter = "(&(objectCategory=person)(objectClass=user))"
		} else {
			userFilter = "(objectClass=inetOrgPerson)"
		}
	}
	syncInterval := directoryConfigInt(config["syncIntervalSeconds"], 300)
	if syncInterval < 60 {
		syncInterval = 60
	}
	pageSize := directoryConfigInt(config["pageSize"], 500)
	if pageSize < 50 {
		pageSize = 50
	}
	if pageSize > 1000 {
		pageSize = 1000
	}
	if _, err = a.db.ExecContext(ctx, `UPDATE directory_connectors
		SET last_seen_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE connector_id=?`, connectorID); err != nil {
		return nil, err
	}
	return map[string]any{
		"providerCode": "ldap", "integrationId": source.ID,
		"directoryType": directoryType, "host": host, "port": port,
		"transport": transport, "baseDN": baseDN, "userBase": userBase,
		"userFilter": userFilter, "userDnTemplate": vaultText(config["userDnTemplate"]),
		"userPrincipalNameSuffix": vaultText(config["userPrincipalNameSuffix"]),
		"caPem":                   vaultText(config["caPem"]), "serverName": vaultText(config["serverName"]),
		"syncIntervalSeconds": syncInterval, "pageSize": pageSize,
		"bindDN": bindDN, "bindPasswordCiphertext": ciphertext,
	}, nil
}

func directoryConfigInt(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		var result int
		if _, err := fmt.Sscan(string(typed), &result); err == nil {
			return result
		}
	default:
		var result int
		if _, err := fmt.Sscan(vaultText(value), &result); err == nil {
			return result
		}
	}
	return fallback
}

func encryptDirectoryConnectorSecret(publicKeyPEM string, value string) (string, error) {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return "", httperror.New(http.StatusConflict, "directory_connector_key_invalid", "Directory Connector public key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(*rsa.PublicKey)
	if err != nil || !ok || publicKey.N.BitLen() < 3072 {
		return "", httperror.New(http.StatusConflict, "directory_connector_key_invalid", "Directory Connector public key is invalid")
	}
	ciphertext, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, publicKey, []byte(value), nil)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}
