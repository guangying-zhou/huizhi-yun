package console

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var integrationCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{1,126}[A-Za-z0-9]$`)
var integrationCreateFields = map[string]bool{
	"integrationCode": true, "integrationType": true, "integrationName": true,
	"category": true, "providerCode": true, "baseUrl": true, "config": true,
	"credential": true, "status": true,
}
var integrationUpdateFields = map[string]bool{
	"integrationName": true, "category": true, "providerCode": true,
	"baseUrl": true, "config": true, "status": true,
}
var integrationCredentialFields = map[string]bool{
	"secretCode": true, "versionNo": true, "expiresAt": true,
}

var integrationHTTPClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type integrationProjection struct {
	ID                  uint64
	IntegrationCode     string
	IntegrationType     string
	IntegrationName     string
	Category            string
	ProviderCode        sql.NullString
	BaseURL             sql.NullString
	ConfigJSON          []byte
	ConnectivityStatus  string
	LastCheckedAt       sql.NullString
	LastErrorMessage    sql.NullString
	Status              string
	CredentialName      sql.NullString
	CredentialVersionNo sql.NullInt64
	SecretCode          sql.NullString
	SecretRef           sql.NullString
	SecretUsageType     sql.NullString
	SecretVersionNo     sql.NullInt64
	CredentialStatus    sql.NullString
	CreatedAt           sql.NullString
	UpdatedAt           sql.NullString
}

const integrationProjectionSelect = `SELECT
	i.id,i.integration_code,i.integration_type,i.integration_name,i.category,
	i.provider_code,i.base_url,CAST(i.config_json AS CHAR),i.connectivity_status,
	DATE_FORMAT(i.last_checked_at,'%Y-%m-%dT%H:%i:%s.%fZ'),i.last_error_message,i.status,
	ic.credential_name,ic.version_no,vs.secret_code,vs.secret_ref,vs.usage_type,
	COALESCE(bound_v.version_no,current_v.version_no),ic.status,
	DATE_FORMAT(i.created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
	DATE_FORMAT(i.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
	FROM integrations i
	LEFT JOIN integration_credentials ic ON ic.id=i.current_credential_id
	LEFT JOIN vault_secrets vs ON vs.id=ic.secret_id
	LEFT JOIN vault_secret_versions bound_v ON bound_v.id=ic.secret_version_id
	LEFT JOIN vault_secret_versions current_v ON current_v.id=vs.current_version_id`

func scanIntegrationProjection(scanner interface{ Scan(...any) error }) (integrationProjection, error) {
	var row integrationProjection
	err := scanner.Scan(
		&row.ID, &row.IntegrationCode, &row.IntegrationType, &row.IntegrationName,
		&row.Category, &row.ProviderCode, &row.BaseURL, &row.ConfigJSON,
		&row.ConnectivityStatus, &row.LastCheckedAt, &row.LastErrorMessage, &row.Status,
		&row.CredentialName, &row.CredentialVersionNo, &row.SecretCode, &row.SecretRef,
		&row.SecretUsageType, &row.SecretVersionNo, &row.CredentialStatus,
		&row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

func mapIntegrationProjection(row integrationProjection) map[string]any {
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	var credential any
	if row.SecretCode.Valid {
		secretRef := row.SecretRef.String
		if row.SecretVersionNo.Valid {
			secretRef += "@v" + strconv.FormatInt(row.SecretVersionNo.Int64, 10)
		}
		credential = map[string]any{
			"credentialName":      firstIntegrationText(row.CredentialName.String, "primary"),
			"credentialVersionNo": nullableVaultInt(row.CredentialVersionNo),
			"versionNo":           nullableVaultInt(row.SecretVersionNo),
			"secretCode":          row.SecretCode.String,
			"secretRef":           secretRef,
			"secretUsageType":     nullableVaultString(row.SecretUsageType),
			"status":              firstIntegrationText(row.CredentialStatus.String, "unknown"),
		}
	}
	return map[string]any{
		"integrationCode": row.IntegrationCode, "integrationType": row.IntegrationType,
		"integrationName": row.IntegrationName, "category": row.Category,
		"providerCode": nullableVaultString(row.ProviderCode), "baseUrl": nullableVaultString(row.BaseURL),
		"config": config, "connectivityStatus": row.ConnectivityStatus,
		"lastCheckedAt":    nullableVaultString(row.LastCheckedAt),
		"lastErrorMessage": nullableVaultString(row.LastErrorMessage), "status": row.Status,
		"currentCredential": credential, "createdAt": nullableVaultString(row.CreatedAt),
		"updatedAt": nullableVaultString(row.UpdatedAt),
	}
}

func (a *Adapter) ListIntegrations(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{}
	args := []any{}
	for _, filter := range []struct {
		value  string
		column string
	}{
		{firstIntegrationText(query.Get("integrationType"), query.Get("type")), "i.integration_type"},
		{query.Get("category"), "i.category"},
		{query.Get("status"), "i.status"},
	} {
		value := strings.TrimSpace(filter.value)
		if value != "" {
			conditions = append(conditions, filter.column+"=?")
			args = append(args, value)
		}
	}
	if search := strings.TrimSpace(firstIntegrationText(query.Get("search"), query.Get("keyword"))); search != "" {
		if len(search) > 100 {
			return nil, httperror.New(http.StatusBadRequest, "console_integration_search_too_long", "Integration search is too long")
		}
		conditions = append(conditions, "(i.integration_code LIKE ? OR i.integration_name LIKE ? OR i.provider_code LIKE ?)")
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern, pattern)
	}
	statement := integrationProjectionSelect
	if len(conditions) > 0 {
		statement += " WHERE " + strings.Join(conditions, " AND ")
	}
	statement += " ORDER BY i.category,i.integration_type,i.integration_code LIMIT 200"
	rows, err := a.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		row, err := scanIntegrationProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, mapIntegrationProjection(row))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) GetIntegration(ctx context.Context, integrationCode string) (map[string]any, error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return nil, err
	}
	row, err := scanIntegrationProjection(a.db.QueryRowContext(
		ctx, integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1", code,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "console_integration_not_found", "Integration not found")
	}
	if err != nil {
		return nil, err
	}
	return mapIntegrationProjection(row), nil
}

func (a *Adapter) ListServiceIntegrations(
	ctx context.Context,
	query url.Values,
	actorID string,
	appCode string,
) (map[string]any, error) {
	allowed, err := a.authorizedIntegrationCodes(
		ctx, actorID, appCode, "integration_config", "view",
	)
	if err != nil {
		return nil, err
	}
	result, err := a.ListIntegrations(ctx, query)
	if err != nil {
		return nil, err
	}
	items, _ := result["items"].([]map[string]any)
	filtered := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if allowed[integrationText(item["integrationCode"])] {
			filtered = append(filtered, item)
		}
	}
	result["items"] = filtered
	return result, nil
}

func (a *Adapter) GetServiceIntegration(
	ctx context.Context,
	integrationCode string,
	actorID string,
	appCode string,
) (map[string]any, error) {
	code, err := a.requireAuthorizedIntegration(
		ctx, integrationCode, actorID, appCode, "integration_config", "view",
	)
	if err != nil {
		return nil, err
	}
	return a.GetIntegration(ctx, code)
}

func (a *Adapter) ResolveServiceIntegrationCredential(
	ctx context.Context,
	integrationCode string,
	actorID string,
	appCode string,
	requestIP string,
	userAgent string,
) (map[string]any, error) {
	code, err := a.requireAuthorizedIntegration(
		ctx, integrationCode, actorID, appCode, "credential_vault", "resolve",
	)
	if err != nil {
		return nil, err
	}
	var secretCode, secretRef, usageType, ownerType string
	var ownerKey sql.NullString
	var versionNo int64
	err = a.db.QueryRowContext(ctx, `SELECT
			vs.secret_code,vs.secret_ref,vs.usage_type,vs.owner_type,vs.owner_key,bound_v.version_no
		FROM integrations i
		INNER JOIN integration_credentials ic
			ON ic.id=i.current_credential_id AND ic.integration_id=i.id AND ic.status='active'
		INNER JOIN vault_secrets vs
			ON vs.id=ic.secret_id AND vs.status='active'
		INNER JOIN vault_secret_versions bound_v
			ON bound_v.id=ic.secret_version_id AND bound_v.secret_id=vs.id AND bound_v.status='active'
		WHERE i.integration_code=? AND i.status='active'
		LIMIT 1`, code).Scan(
		&secretCode, &secretRef, &usageType, &ownerType, &ownerKey, &versionNo,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(
			http.StatusForbidden,
			"console_service_integration_binding_unavailable",
			"Integration credential binding is unavailable",
		)
	}
	if err != nil {
		return nil, err
	}
	if usageType != "integration" || ownerType != "integration" ||
		!ownerKey.Valid || ownerKey.String != code {
		return nil, httperror.New(
			http.StatusForbidden,
			"console_service_integration_binding_invalid",
			"Integration credential binding is unavailable",
		)
	}
	return a.ResolveVaultSecret(ctx, secretRef, versionNo, VaultAccessMeta{
		ActorType: "service",
		ActorID:   actorID,
		AppCode:   appCode,
		RequestIP: requestIP,
		UserAgent: userAgent,
		Reason:    "integration_resolve:" + code,
	})
}

func (a *Adapter) requireAuthorizedIntegration(
	ctx context.Context,
	integrationCode string,
	actorID string,
	appCode string,
	resourceCode string,
	action string,
) (string, error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return "", err
	}
	allowed, err := a.authorizedIntegrationCodes(ctx, actorID, appCode, resourceCode, action)
	if err != nil {
		return "", err
	}
	if !allowed[code] {
		return "", httperror.New(
			http.StatusForbidden,
			"console_service_integration_not_granted",
			"Integration access is not granted to this service client",
		)
	}
	return code, nil
}

func (a *Adapter) requireAuthorizedIntegrationOperation(
	ctx context.Context,
	integrationCode string,
	operation string,
	actorID string,
	appCode string,
) (string, error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return "", err
	}
	operation = strings.TrimSpace(operation)
	if operation == "" || len(operation) > 128 {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_integration_operation_invalid",
			"Integration operation is invalid",
		)
	}
	actorID = integrationServiceClientCode(actorID)
	appCode = strings.TrimSpace(appCode)
	if actorID == "" || appCode == "" {
		return "", httperror.New(
			http.StatusForbidden,
			"console_service_integration_identity_incomplete",
			"Service integration identity is incomplete",
		)
	}
	rows, err := a.db.QueryContext(ctx, `SELECT CAST(scg.scope_json AS CHAR)
		FROM service_clients sc
		INNER JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
		INNER JOIN service_client_grants scg ON scg.service_client_id=sc.id
		WHERE (sc.client_code=? OR scc.client_id=?)
			AND sc.app_code=?
			AND sc.status='active'
			AND scc.status='active'
			AND scg.resource_code='integration_operations'
			AND scg.action='execute'
			AND scg.status='active'`,
		actorID, actorID, appCode)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return "", err
		}
		var scope map[string]any
		if len(raw) == 0 || json.Unmarshal(raw, &scope) != nil {
			continue
		}
		hasCode := false
		for _, value := range integrationList(scope["integrationCodes"]) {
			if integrationText(value) == code {
				hasCode = true
				break
			}
		}
		if !hasCode {
			continue
		}
		for _, value := range integrationList(scope["operations"]) {
			if integrationText(value) == operation {
				return code, nil
			}
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return "", httperror.New(
		http.StatusForbidden,
		"console_service_integration_operation_not_granted",
		"Integration operation is not granted to this service client",
	)
}

func (a *Adapter) authorizedIntegrationCodes(
	ctx context.Context,
	actorID string,
	appCode string,
	resourceCode string,
	action string,
) (map[string]bool, error) {
	actorID = integrationServiceClientCode(actorID)
	appCode = strings.TrimSpace(appCode)
	if actorID == "" || appCode == "" {
		return nil, httperror.New(
			http.StatusForbidden,
			"console_service_integration_identity_incomplete",
			"Service integration identity is incomplete",
		)
	}
	rows, err := a.db.QueryContext(ctx, `SELECT CAST(scg.scope_json AS CHAR)
		FROM service_clients sc
		INNER JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
		INNER JOIN service_client_grants scg ON scg.service_client_id=sc.id
		WHERE (sc.client_code=? OR scc.client_id=?)
			AND sc.app_code=?
			AND sc.status='active'
			AND scc.status='active'
			AND scg.resource_code=?
			AND scg.action=?
			AND scg.status='active'`,
		actorID, actorID, appCode, resourceCode, action)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var scope map[string]any
		if len(raw) == 0 || json.Unmarshal(raw, &scope) != nil {
			continue
		}
		for _, value := range integrationList(scope["integrationCodes"]) {
			if code, codeErr := normalizeIntegrationCode(value, "integrationCode"); codeErr == nil {
				allowed[code] = true
			}
		}
	}
	return allowed, rows.Err()
}

func integrationServiceClientCode(actorID string) string {
	actorID = strings.TrimSpace(actorID)
	return strings.TrimSpace(strings.TrimPrefix(actorID, "client:"))
}

func integrationList(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []string:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return nil
	}
}

func (a *Adapter) CreateIntegration(
	ctx context.Context,
	body map[string]any,
	meta MutationMeta,
) (result map[string]any, err error) {
	if err = rejectIntegrationFields(body, integrationCreateFields); err != nil {
		return nil, err
	}
	code, err := normalizeIntegrationCode(body["integrationCode"], "integrationCode")
	if err != nil {
		return nil, err
	}
	integrationType, err := normalizeIntegrationCode(body["integrationType"], "integrationType")
	if err != nil {
		return nil, err
	}
	name := firstIntegrationText(integrationText(body["integrationName"]), code)
	category := firstIntegrationText(integrationText(body["category"]), "general")
	status, err := normalizeIntegrationStatus(body["status"])
	if err != nil {
		return nil, err
	}
	config, err := normalizeIntegrationConfig(body["config"], code)
	if err != nil {
		return nil, err
	}
	credential := integrationRecord(body["credential"])
	if len(credential) > 0 {
		if err := rejectIntegrationFields(credential, integrationCredentialFields); err != nil {
			return nil, err
		}
	}
	payload := map[string]any{
		"integrationCode": code, "integrationType": integrationType,
		"integrationName": name, "category": category,
		"providerCode": nullableVaultText(body["providerCode"]),
		"baseUrl":      nullableVaultText(body["baseUrl"]), "config": config,
		"status": status, "credentialSupplied": integrationText(credential["secretCode"]) != "",
	}
	session, replay, err := a.beginMutation(
		ctx, "console.integration.create", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, payload,
	)
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
		"SELECT COUNT(*) FROM integrations WHERE integration_code=?", code,
	).Scan(&existing); err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, httperror.New(http.StatusConflict, "console_integration_exists", "Integration already exists")
	}
	configJSON, _ := json.Marshal(config)
	insert, err := session.tx.ExecContext(ctx, `INSERT INTO integrations (
		integration_code,integration_type,integration_name,category,provider_code,
		base_url,config_json,connectivity_status,status,created_by,created_at,updated_at
	) VALUES (?,?,?,?,?,?,CAST(? AS JSON),'unknown',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		code, integrationType, name, category, nullableVaultText(body["providerCode"]),
		nullableVaultText(body["baseUrl"]), string(configJSON), status, meta.ActorID)
	if err != nil {
		return nil, err
	}
	integrationID, err := insert.LastInsertId()
	if err != nil {
		return nil, err
	}
	if integrationText(credential["secretCode"]) != "" {
		if err = bindIntegrationCredential(
			ctx, session.tx, uint64(integrationID), credential, true,
		); err != nil {
			return nil, err
		}
	}
	result, err = loadIntegrationProjectionTx(ctx, session.tx, code)
	if err != nil {
		return nil, err
	}
	result["receiptId"] = session.receiptID
	err = a.finishMutation(ctx, session, "integration", "create", "integration", code,
		map[string]any{"integrationCode": code, "credentialSupplied": integrationText(credential["secretCode"]) != ""}, result)
	return result, err
}

func (a *Adapter) UpdateIntegration(
	ctx context.Context,
	integrationCode string,
	body map[string]any,
	meta MutationMeta,
) (result map[string]any, err error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return nil, err
	}
	if err = rejectIntegrationFields(body, integrationUpdateFields); err != nil {
		return nil, err
	}
	config := map[string]any(nil)
	if _, supplied := body["config"]; supplied {
		config, err = normalizeIntegrationConfig(body["config"], code)
		if err != nil {
			return nil, err
		}
	}
	payload := map[string]any{"integrationCode": code, "updates": body}
	if config != nil {
		payload["config"] = config
	}
	session, replay, err := a.beginMutation(
		ctx, "console.integration.update", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()
	var integrationID uint64
	if err = session.tx.QueryRowContext(ctx,
		"SELECT id FROM integrations WHERE integration_code=? LIMIT 1 FOR UPDATE", code,
	).Scan(&integrationID); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "console_integration_not_found", "Integration not found")
	}
	if err != nil {
		return nil, err
	}
	updates := []string{}
	args := []any{}
	for _, field := range []struct {
		key    string
		column string
		value  func(any) (any, error)
	}{
		{"integrationName", "integration_name", func(value any) (any, error) {
			return firstIntegrationText(integrationText(value), code), nil
		}},
		{"category", "category", func(value any) (any, error) {
			return firstIntegrationText(integrationText(value), "general"), nil
		}},
		{"providerCode", "provider_code", func(value any) (any, error) { return nullableVaultText(value), nil }},
		{"baseUrl", "base_url", func(value any) (any, error) { return nullableVaultText(value), nil }},
		{"status", "status", func(value any) (any, error) { return normalizeIntegrationStatus(value) }},
	} {
		if value, supplied := body[field.key]; supplied {
			normalized, normalizeErr := field.value(value)
			if normalizeErr != nil {
				return nil, normalizeErr
			}
			updates = append(updates, field.column+"=?")
			args = append(args, normalized)
		}
	}
	if config != nil {
		configJSON, _ := json.Marshal(config)
		updates = append(updates, "config_json=CAST(? AS JSON)")
		args = append(args, string(configJSON))
	}
	if len(updates) > 0 {
		args = append(args, integrationID)
		if _, err = session.tx.ExecContext(ctx,
			"UPDATE integrations SET "+strings.Join(updates, ",")+
				",updated_at=UTC_TIMESTAMP() WHERE id=?", args...,
		); err != nil {
			return nil, err
		}
	}
	result, err = loadIntegrationProjectionTx(ctx, session.tx, code)
	if err != nil {
		return nil, err
	}
	result["receiptId"] = session.receiptID
	err = a.finishMutation(ctx, session, "integration", "update", "integration", code,
		map[string]any{"integrationCode": code, "updatedFields": sortedIntegrationKeys(body)}, result)
	return result, err
}

func (a *Adapter) RotateIntegrationCredential(
	ctx context.Context,
	integrationCode string,
	body map[string]any,
	meta MutationMeta,
) (result map[string]any, err error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return nil, err
	}
	if err = rejectIntegrationFields(body, integrationCredentialFields); err != nil {
		return nil, err
	}
	payload := map[string]any{
		"integrationCode": code, "secretCode": integrationText(body["secretCode"]),
		"versionNo": body["versionNo"], "expiresAt": body["expiresAt"],
	}
	session, replay, err := a.beginMutation(
		ctx, "console.integration.credential.rotate", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()
	var integrationID uint64
	if err = session.tx.QueryRowContext(ctx,
		"SELECT id FROM integrations WHERE integration_code=? LIMIT 1 FOR UPDATE", code,
	).Scan(&integrationID); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "console_integration_not_found", "Integration not found")
	}
	if err != nil {
		return nil, err
	}
	if err = bindIntegrationCredential(ctx, session.tx, integrationID, body, false); err != nil {
		return nil, err
	}
	result, err = loadIntegrationProjectionTx(ctx, session.tx, code)
	if err != nil {
		return nil, err
	}
	result["receiptId"] = session.receiptID
	err = a.finishMutation(ctx, session, "integration", "rotate_credential", "integration", code,
		map[string]any{"integrationCode": code, "secretCode": integrationText(body["secretCode"])}, result)
	return result, err
}

func (a *Adapter) CheckIntegration(
	ctx context.Context,
	integrationCode string,
	meta MutationMeta,
) (result map[string]any, err error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return nil, err
	}
	session, replay, err := a.beginMutation(
		ctx, "console.integration.check", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, map[string]any{"integrationCode": code},
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			_ = session.tx.Rollback()
		}
	}()
	row, err := scanIntegrationProjection(session.tx.QueryRowContext(
		ctx, integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1 FOR UPDATE", code,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "console_integration_not_found", "Integration not found")
	}
	if err != nil {
		return nil, err
	}
	if !row.SecretCode.Valid || !row.SecretVersionNo.Valid {
		return nil, httperror.New(http.StatusConflict, "console_integration_credential_missing", "Integration has no active credential")
	}
	secret, err := queryVaultSecret(ctx, session.tx, row.SecretCode.String, row.SecretVersionNo.Int64, false)
	if err != nil {
		return nil, err
	}
	secretValue, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend, secret.CiphertextBlob,
		secret.BackendSecretRef.String, secret.ContentHash.String,
	)
	if resolveErr != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_integration_credential_unavailable", "Integration credential cannot be resolved")
	}
	if err = insertVaultAccessLog(ctx, session.tx, int64(secret.ID), secret.VersionID.Int64, "resolve",
		VaultAccessMeta{
			ActorType: "human", ActorID: meta.ActorID, AppCode: "console",
			Reason: "integration_check:" + code,
		}, "success"); err != nil {
		return nil, err
	}
	summary, publicError := a.runIntegrationConnectivityCheck(ctx, session.tx, row, secretValue)
	status := "healthy"
	if publicError != "" {
		status = "failed"
	}
	summaryJSON, _ := json.Marshal(summary)
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO integration_check_logs (
		integration_id,check_type,trigger_source,status,request_summary_json,
		response_summary_json,error_message,checked_at
	) VALUES (?,'connectivity','manual',?,CAST(? AS JSON),CAST(? AS JSON),?,UTC_TIMESTAMP())`,
		row.ID, status, `{"operation":"fixed-connectivity-check"}`, string(summaryJSON),
		nullableVaultText(publicError)); err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE integrations SET
		connectivity_status=?,last_checked_at=UTC_TIMESTAMP(),last_error_message=?,
		updated_at=UTC_TIMESTAMP() WHERE id=?`,
		status, nullableVaultText(publicError), row.ID); err != nil {
		return nil, err
	}
	result = map[string]any{
		"integrationCode": code, "status": status,
		"checkedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"summary":   summary, "errorMessage": nullableVaultText(publicError),
		"receiptId": session.receiptID,
	}
	err = a.finishMutation(ctx, session, "integration", "check", "integration", code,
		map[string]any{"integrationCode": code, "status": status}, result)
	return result, err
}

func (a *Adapter) runIntegrationConnectivityCheck(
	ctx context.Context,
	tx *sql.Tx,
	row integrationProjection,
	secret string,
) (map[string]any, string) {
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	summary := map[string]any{
		"checkMode": "vault_resolve",
		"provider":  row.IntegrationType,
	}
	switch row.IntegrationType {
	case "gitlab":
		base, err := safeIntegrationBaseURL(row.BaseURL.String)
		if err != nil {
			return summary, "GitLab baseUrl must be a safe HTTPS origin"
		}
		summary["checkMode"] = "gitlab_api_version"
		if err := integrationHTTPStatus(ctx, base+"/api/v4/version", map[string]string{"PRIVATE-TOKEN": secret}); err != nil {
			return summary, "GitLab endpoint is unavailable"
		}
	case "wecom":
		corpID := integrationConfigText(config, "corpid", "corpId")
		agentID := integrationConfigText(config, "agentid", "agentId")
		if corpID == "" || agentID == "" {
			return summary, "WeCom Corp ID and Agent ID are required"
		}
		summary["checkMode"] = "wecom_gettoken"
		endpoint := "https://qyapi.weixin.qq.com/cgi-bin/gettoken?" + url.Values{
			"corpid": {corpID}, "corpsecret": {secret},
		}.Encode()
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		response, err := integrationHTTPClient.Do(request)
		if err != nil {
			return summary, "WeCom endpoint is unavailable"
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(response.Body, 32*1024))
		var provider struct {
			ErrCode int `json:"errcode"`
		}
		if response.StatusCode/100 != 2 || json.Unmarshal(body, &provider) != nil || provider.ErrCode != 0 {
			return summary, "WeCom rejected the configured credential"
		}
		summary["agentIdConfigured"] = true
	case "dingtalk":
		clientID := integrationConfigText(config, "oauthClientId", "loginClientId", "appKey")
		if clientID == "" {
			return summary, "DingTalk Client ID / AppKey is required"
		}
		setting, err := loadSettingValueTx(ctx, tx, "connector.runtimeApiUrl", tenantSettingScope)
		if err != nil || integrationText(setting.Value) == "" {
			return summary, "Connector Runtime must be configured before DingTalk can be enabled"
		}
		summary["checkMode"] = "dingtalk_config_vault_connector_configured"
		summary["clientIdLast4"] = lastIntegrationCharacters(clientID, 4)
	case "oss":
		accessKeyID := integrationConfigText(config, "accessKeyId")
		bucket := integrationConfigText(config, "bucketName", "bucket")
		endpoint := firstIntegrationText(integrationConfigText(config, "endpoint"), row.BaseURL.String)
		if accessKeyID == "" || bucket == "" || endpoint == "" {
			return summary, "OSS accessKeyId, bucketName and endpoint are required"
		}
		summary["checkMode"] = "oss_list"
		if err := checkOSSConnectivity(ctx, endpoint, bucket, accessKeyID, secret); err != nil {
			return summary, "OSS endpoint or credential is unavailable"
		}
	case "ai_provider":
		base, err := safeIntegrationBaseURL(row.BaseURL.String)
		if err != nil {
			return summary, "AI Provider baseUrl must be a safe HTTPS origin"
		}
		path := firstIntegrationText(integrationConfigText(config, "checkPath", "modelsPath"), "/v1/models")
		if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.Contains(path, `\`) {
			return summary, "AI Provider checkPath is invalid"
		}
		summary["checkMode"] = "ai_provider_models"
		if err := integrationHTTPStatus(ctx, base+path, map[string]string{"Authorization": "Bearer " + secret}); err != nil {
			return summary, "AI Provider endpoint is unavailable"
		}
	default:
		summary["checkMode"] = "vault_resolve_only"
	}
	return summary, ""
}

func safeIntegrationBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("unsafe integration URL")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/"), nil
}

func integrationHTTPStatus(ctx context.Context, endpoint string, headers map[string]string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
	if response.StatusCode/100 != 2 {
		return errors.New("provider rejected connectivity check")
	}
	return nil
}

func checkOSSConnectivity(
	ctx context.Context,
	endpoint string,
	bucket string,
	accessKeyID string,
	accessKeySecret string,
) error {
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`).MatchString(bucket) {
		return errors.New("invalid OSS bucket")
	}
	rawEndpoint := strings.TrimSpace(endpoint)
	if !strings.Contains(rawEndpoint, "://") {
		rawEndpoint = "https://" + rawEndpoint
	}
	base, err := url.Parse(rawEndpoint)
	if err != nil || base.Scheme != "https" || base.Hostname() == "" ||
		base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return errors.New("invalid OSS endpoint")
	}
	base.Host = bucket + "." + base.Host
	base.Path = "/"
	base.RawQuery = "max-keys=1"
	date := time.Now().UTC().Format(http.TimeFormat)
	canonical := "GET\n\n\n" + date + "\n/" + bucket + "/"
	mac := hmac.New(sha1.New, []byte(accessKeySecret))
	_, _ = mac.Write([]byte(canonical))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Date", date)
	request.Header.Set("Authorization", "OSS "+accessKeyID+":"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
	if response.StatusCode/100 != 2 {
		return errors.New("OSS rejected connectivity check")
	}
	return nil
}

func integrationConfigText(config map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := integrationText(config[key]); value != "" {
			return value
		}
	}
	return ""
}

func lastIntegrationCharacters(value string, count int) string {
	if len(value) <= count {
		return value
	}
	return value[len(value)-count:]
}

func bindIntegrationCredential(
	ctx context.Context,
	tx *sql.Tx,
	integrationID uint64,
	body map[string]any,
	initial bool,
) error {
	secretCode, err := normalizeVaultCode(body["secretCode"])
	if err != nil {
		return err
	}
	requestedVersion, err := positiveIntegrationVersion(body["versionNo"])
	if err != nil {
		return err
	}
	versionCondition := "v.id=vs.current_version_id"
	args := []any{secretCode}
	if requestedVersion > 0 {
		versionCondition = "v.secret_id=vs.id AND v.version_no=?"
		args = []any{requestedVersion, secretCode}
	}
	var secretID, secretVersionID uint64
	var usageType string
	err = tx.QueryRowContext(ctx, `SELECT vs.id,v.id,vs.usage_type
		FROM vault_secrets vs INNER JOIN vault_secret_versions v ON `+versionCondition+`
		WHERE vs.secret_code=? AND vs.status='active' AND v.status='active'
		LIMIT 1 FOR UPDATE`, args...).Scan(&secretID, &secretVersionID, &usageType)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "console_integration_secret_not_found", "Secret or secret version not found")
	}
	if err != nil {
		return err
	}
	if usageType != "integration" {
		return httperror.New(http.StatusBadRequest, "console_integration_secret_usage_invalid", "Integration credential must bind usageType=integration secret")
	}
	var currentID sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM integration_credentials
		WHERE integration_id=? AND status='active' LIMIT 1 FOR UPDATE`,
		integrationID).Scan(&currentID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE integration_credentials SET status='retired'
		WHERE integration_id=? AND status='active'`, integrationID); err != nil {
		return err
	}
	var versionNo uint64
	if initial {
		versionNo = 1
	} else if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_no),0)+1
		FROM integration_credentials WHERE integration_id=? FOR UPDATE`, integrationID).Scan(&versionNo); err != nil {
		return err
	}
	expiresAt, err := integrationExpiry(body["expiresAt"])
	if err != nil {
		return err
	}
	insert, err := tx.ExecContext(ctx, `INSERT INTO integration_credentials (
		integration_id,credential_name,credential_role,version_no,secret_id,
		secret_version_id,rotated_from_id,issued_at,expires_at,status
	) VALUES (?,'primary','primary',?,?,?,?,UTC_TIMESTAMP(),?,'active')`,
		integrationID, versionNo, secretID, secretVersionID, nullableVaultInt64(currentID), expiresAt)
	if err != nil {
		return err
	}
	credentialID, err := insert.LastInsertId()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE integrations
		SET current_credential_id=?,updated_at=UTC_TIMESTAMP() WHERE id=?`,
		credentialID, integrationID)
	return err
}

func loadIntegrationProjectionTx(ctx context.Context, tx *sql.Tx, code string) (map[string]any, error) {
	row, err := scanIntegrationProjection(tx.QueryRowContext(
		ctx, integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1", code,
	))
	if err != nil {
		return nil, err
	}
	return mapIntegrationProjection(row), nil
}

func normalizeIntegrationCode(value any, field string) (string, error) {
	code := integrationText(value)
	if !integrationCodePattern.MatchString(code) {
		return "", httperror.New(http.StatusBadRequest, "console_integration_code_invalid", field+" is invalid")
	}
	return code, nil
}

func normalizeIntegrationStatus(value any) (string, error) {
	status := firstIntegrationText(integrationText(value), "active")
	if status != "active" && status != "inactive" {
		return "", httperror.New(http.StatusBadRequest, "console_integration_status_invalid", "Integration status is invalid")
	}
	return status, nil
}

func normalizeIntegrationConfig(value any, code string) (map[string]any, error) {
	config := integrationRecord(value)
	if err := rejectIntegrationSecrets(config, "config"); err != nil {
		return nil, err
	}
	if code == "dingtalk.identity" {
		clientID := firstIntegrationText(
			integrationText(config["oauthClientId"]),
			integrationText(config["loginClientId"]),
			integrationText(config["clientId"]),
			integrationText(config["appId"]),
			integrationText(config["appKey"]),
		)
		if clientID == "" || !plausibleDingTalkOAuthClientID(clientID) {
			return nil, httperror.New(http.StatusBadRequest, "console_dingtalk_client_id_invalid", "DingTalk OAuth Client ID / AppKey is invalid; AgentId and UnifiedAppId are not accepted")
		}
	}
	return config, nil
}

func rejectIntegrationSecrets(value any, path string) error {
	secretField := regexp.MustCompile(`(?i)(secret|password|private[_-]?key|access[_-]?key[_-]?secret|api[_-]?key|token)$`)
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if secretField.MatchString(key) {
				return httperror.New(http.StatusBadRequest, "console_integration_config_secret_forbidden", path+"."+key+" must be stored in Vault")
			}
			if err := rejectIntegrationSecrets(child, path+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := rejectIntegrationSecrets(child, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	}
	return nil
}

func plausibleDingTalkOAuthClientID(value string) bool {
	if regexp.MustCompile(`^[0-9]+$`).MatchString(value) {
		return false
	}
	return !regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(value)
}

func positiveIntegrationVersion(value any) (uint64, error) {
	text := integrationText(value)
	if text == "" {
		return 0, nil
	}
	version, err := strconv.ParseUint(text, 10, 64)
	if err != nil || version == 0 {
		return 0, httperror.New(http.StatusBadRequest, "console_integration_version_invalid", "Integration credential versionNo is invalid")
	}
	return version, nil
}

func integrationExpiry(value any) (any, error) {
	text := integrationText(value)
	if text == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_integration_expiry_invalid", "Integration credential expiresAt is invalid")
	}
	return parsed.UTC(), nil
}

func rejectIntegrationFields(body map[string]any, allowed map[string]bool) error {
	for key := range body {
		if !allowed[key] {
			return httperror.New(http.StatusBadRequest, "console_integration_field_not_writable", "Integration field is not writable: "+key)
		}
	}
	return nil
}

func sortedIntegrationKeys(body map[string]any) []string {
	keys := make([]string, 0, len(body))
	for _, key := range []string{"integrationName", "category", "providerCode", "baseUrl", "config", "status"} {
		if _, ok := body[key]; ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func integrationRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func integrationText(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstIntegrationText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
