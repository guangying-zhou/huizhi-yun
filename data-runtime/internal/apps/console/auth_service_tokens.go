package console

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const consoleRuntimeClientCode = "console.runtime"

var consoleRuntimeServiceScopes = []string{
	"console:org-profile:view", "console:org-profile:edit",
	"console:system-setting:view", "console:system-setting:edit", "console:system-setting:manage",
	"console:business-domain:view", "console:business-domain:edit",
	"console:region:view", "console:region:edit",
	"console:work-calendar:view", "console:work-calendar:edit", "console:work-calendar:import",
	"console:audit:view", "console:audit:write",
	"console:notification:read", "console:notification:manage", "console:notification:publish",
	"console:directory-user:view", "console:directory-user:edit", "console:directory-profile:edit",
	"console:directory-department:view", "console:directory-department:edit",
	"console:directory-project:view", "console:directory-project:edit",
	"console:directory-sync:export", "console:directory-sync:view", "console:directory-sync:edit",
	"console:directory-connector:view", "console:directory-connector:execute", "console:directory-connector:enroll",
	"console:directory-source:view", "console:directory-source:edit",
	"console:directory-profiles:sync",
	"console:connector-runtime:view", "console:connector-runtime:admin",
	"console:connector-runtime:enroll", "console:connector-runtime:heartbeat",
	"console:integration:view", "console:integration:edit", "console:integration:rotate", "console:integration:test",
	"console:avatar-object:read", "console:avatar-object:write",
	"console:auth-external-login:write", "console:auth-client:sync", "console:auth-health:view",
	"console:auth-identity:write", "console:auth-session:read", "console:auth-session:write",
	"console:auth-oidc:read", "console:auth-oidc:write", "console:auth-oidc:sign",
	"console:policy-bundle:read", "console:policy-bundle:write",
	"console:service-token:issue", "console:service-client:consume",
	"console:service-client:grant",
	"console.schema.read",
	"console:cutover-disposition:view", "console:cutover-disposition:manage",
	"console:cutover-service-client:retire",
	"console:runtime-compat:read", "console:runtime-compat:manage",
	"console:platform-lifecycle:view", "console:platform-lifecycle:execute",
	"console:vault-secret:view", "console:vault-secret:edit", "console:vault-secret:reveal",
	"console:directory-employment:sync", "console:directory-offboarding:disable",
	"data-runtime:runtime:update", "tenant-runtime:runtime:update",
	"notification-runtime:send", "connector-runtime:notifications:send",
	"connector-runtime:identity:exchange", "connector-runtime:identity:dingtalk:exchange",
	"connector-runtime:people:sync", "connector-runtime:directory:sync",
	"connector-runtime:jobs:view", "connector-runtime:jobs:cancel", "connector-runtime:diagnostics:view",
	"webdev:issue:read", "webdev:issue:write",
	"aims:notification-details:authorize", "assets:notification-details:authorize",
	"altoc:notification-details:authorize", "finance:notification-details:authorize",
	"people:notification-details:authorize", "workflow:action_defs:sync",
	"workflow:notification-details:authorize", "workflow:proxy",
}

type consoleRuntimeServiceIdentity struct {
	ServiceClientID uint64
	CredentialID    uint64
	ClientID        string
	ClientCode      string
	ClientName      string
	ClientType      string
	AppCode         string
	Scopes          []string
}

type consumedServiceClient struct {
	ServiceClientID uint64
	CredentialID    uint64
	ClientID        string
	ClientCode      string
	ClientName      string
	ClientType      string
	AppCode         sql.NullString
	ExpiresAt       sql.NullTime
}

func (a *Adapter) ConsumeServiceClientCredential(ctx context.Context, body map[string]any) (map[string]any, error) {
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	clientSecret, err := requiredAuthString(body["clientSecret"], "client_secret", 4096)
	if err != nil {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client")
	}
	audience, err := requiredAuthString(body["audience"], "audience", 191)
	if err != nil {
		return nil, err
	}
	var (
		subject                 consumedServiceClient
		secretID, versionID     uint64
		storageBackend          string
		encryptionScheme        string
		ciphertext              []byte
		backendRef, contentHash sql.NullString
	)
	err = a.db.QueryRowContext(ctx, `
		SELECT sc.id,scc.id,scc.client_id,sc.client_code,sc.client_name,sc.client_type,
			sc.app_code,scc.expires_at,vs.id,vsv.id,vs.storage_backend,vsv.encryption_scheme,
			vsv.ciphertext_blob,vsv.backend_secret_ref,vsv.content_hash
		FROM service_client_credentials scc
		INNER JOIN service_clients sc
			ON sc.id=scc.service_client_id AND sc.current_credential_id=scc.id AND sc.status='active'
		INNER JOIN vault_secrets vs
			ON vs.id=scc.secret_id AND vs.status='active'
		INNER JOIN vault_secret_versions vsv
			ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id AND vsv.status='active'
		WHERE scc.client_id=? AND scc.status='active'
			AND (scc.expires_at IS NULL OR scc.expires_at>UTC_TIMESTAMP())
		LIMIT 1
	`, clientID).Scan(
		&subject.ServiceClientID, &subject.CredentialID, &subject.ClientID,
		&subject.ClientCode, &subject.ClientName, &subject.ClientType,
		&subject.AppCode, &subject.ExpiresAt, &secretID, &versionID, &storageBackend,
		&encryptionScheme, &ciphertext, &backendRef, &contentHash,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client")
	}
	if err != nil {
		return nil, err
	}
	valid := a.serviceClientSecretMatches(
		storageBackend, encryptionScheme, ciphertext,
		backendRef.String, contentHash.String, clientSecret,
	)
	status := "failed"
	if valid {
		status = "success"
	}
	_ = insertVaultAccessLog(ctx, a.db, int64(secretID), int64(versionID), "validate", VaultAccessMeta{
		ActorType: "service", ActorID: subject.ClientCode, AppCode: subject.AppCode.String,
		Reason: "oauth.client_credentials",
	}, status)
	if !valid {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client")
	}
	result, err := a.authorizeServiceClientScopes(ctx, subject, audience, body["scope"])
	if err != nil {
		return nil, err
	}
	if _, err := a.db.ExecContext(ctx, `
		UPDATE service_client_credentials SET last_used_at=UTC_TIMESTAMP() WHERE id=?
	`, subject.CredentialID); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) serviceClientSecretMatches(
	storageBackend string,
	encryptionScheme string,
	ciphertext []byte,
	backendRef string,
	contentHash string,
	presented string,
) bool {
	if strings.TrimSpace(encryptionScheme) == "sha256-only" {
		stored := strings.TrimPrefix(strings.TrimSpace(contentHash), "sha256_")
		expected, err := hex.DecodeString(stored)
		if err != nil || len(expected) != sha256.Size {
			return false
		}
		actual := sha256.Sum256([]byte(presented))
		return hmac.Equal(expected, actual[:])
	}
	resolved, err := a.resolveVaultMaterial(storageBackend, ciphertext, backendRef, contentHash)
	return err == nil && hmac.Equal([]byte(resolved), []byte(presented))
}

func (a *Adapter) ConsumeRuntimeAppIdentity(ctx context.Context, body map[string]any) (map[string]any, error) {
	appCode, err := requiredAuditCode(body["appCode"], "appCode")
	if err != nil {
		return nil, err
	}
	audience, err := requiredAuthString(body["audience"], "audience", 191)
	if err != nil {
		return nil, err
	}
	subject, err := a.loadActiveServiceClientForApp(ctx, appCode)
	if err != nil {
		return nil, err
	}
	if clientID := strings.TrimSpace(stringField(body["clientId"])); clientID != "" {
		accepted := clientID == subject.ClientID || clientID == subject.ClientCode ||
			clientID == appCode || clientID == appCode+".runtime"
		if !accepted {
			return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client: client_id does not match runtime app identity")
		}
	}
	if _, err := a.db.ExecContext(ctx, `
		UPDATE service_client_credentials SET last_used_at=UTC_TIMESTAMP() WHERE id=?
	`, subject.CredentialID); err != nil {
		return nil, err
	}
	return a.authorizeServiceClientScopes(ctx, subject, audience, body["scope"])
}

func (a *Adapter) ConsumeBootstrapAccessKey(ctx context.Context, body map[string]any) (map[string]any, error) {
	appCode, err := requiredAuditCode(body["appCode"], "appCode")
	if err != nil {
		return nil, err
	}
	deploymentCode, err := requiredAuthString(body["deploymentCode"], "deployment_code", 128)
	if err != nil {
		return nil, err
	}
	accessKey, err := requiredAuthString(body["accessKey"], "access_key", 4096)
	if err != nil {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_bootstrap", "invalid_bootstrap")
	}
	audience, err := requiredAuthString(body["audience"], "audience", 191)
	if err != nil {
		return nil, err
	}
	secret, err := queryVaultSecret(ctx, a.db, "bootstrap."+deploymentCode+".access_key", nil, false)
	if err != nil {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_bootstrap", "invalid_bootstrap")
	}
	resolved, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend, secret.CiphertextBlob, secret.BackendSecretRef.String, secret.ContentHash.String,
	)
	valid := resolveErr == nil && hmac.Equal([]byte(resolved), []byte(accessKey))
	status := "failed"
	if valid {
		status = "success"
	}
	_ = insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "validate", VaultAccessMeta{
		ActorType: "system", ActorID: "bootstrap:" + deploymentCode,
		AppCode: appCode, Reason: "bootstrap_service_token",
	}, status)
	if !valid {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_bootstrap", "invalid_bootstrap")
	}
	subject, err := a.loadActiveServiceClientForApp(ctx, appCode)
	if err != nil {
		return nil, err
	}
	return a.authorizeServiceClientScopes(ctx, subject, audience, body["scope"])
}

func (a *Adapter) loadActiveServiceClientForApp(ctx context.Context, appCode string) (consumedServiceClient, error) {
	var subject consumedServiceClient
	err := a.db.QueryRowContext(ctx, `
		SELECT sc.id,scc.id,scc.client_id,sc.client_code,sc.client_name,sc.client_type,
			sc.app_code,scc.expires_at
		FROM service_clients sc
		INNER JOIN service_client_credentials scc
			ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
		WHERE (sc.app_code=? OR sc.client_code=? OR sc.client_code=?)
			AND sc.status='active' AND scc.status='active'
			AND (scc.expires_at IS NULL OR scc.expires_at>UTC_TIMESTAMP())
		ORDER BY CASE WHEN sc.app_code=? THEN 0 WHEN sc.client_code=? THEN 1 ELSE 2 END
		LIMIT 1
	`, appCode, appCode, appCode+".runtime", appCode, appCode).Scan(
		&subject.ServiceClientID, &subject.CredentialID, &subject.ClientID,
		&subject.ClientCode, &subject.ClientName, &subject.ClientType,
		&subject.AppCode, &subject.ExpiresAt,
	)
	if err == sql.ErrNoRows {
		return subject, httperror.New(http.StatusNotFound, "service_client_not_found", "service client was not found")
	}
	return subject, err
}

func (a *Adapter) authorizeServiceClientScopes(
	ctx context.Context,
	subject consumedServiceClient,
	audience string,
	rawScope any,
) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT resource_code,action,scope_json
		FROM service_client_grants
		WHERE service_client_id=? AND status='active'
		ORDER BY resource_code,action
	`, subject.ServiceClientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type grant struct {
		scope     string
		scopeJSON sql.NullString
	}
	grants := make([]grant, 0)
	allowed := map[string]bool{}
	for rows.Next() {
		var resource, action string
		var scopeJSON sql.NullString
		if err := rows.Scan(&resource, &action, &scopeJSON); err != nil {
			return nil, err
		}
		scope := resource + ":" + action
		grants = append(grants, grant{scope: scope, scopeJSON: scopeJSON})
		allowed[scope] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	requested := strings.Fields(stringField(rawScope))
	if len(requested) == 0 {
		for scope := range allowed {
			if strings.HasPrefix(scope, audience+":") {
				requested = append(requested, scope)
			}
		}
	}
	if len(requested) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_scope", "invalid_scope: no grant available for requested audience")
	}
	sort.Strings(requested)
	selected := map[string]bool{}
	for _, scope := range requested {
		if strings.HasPrefix(scope, audience+":") {
			if !allowed[scope] {
				return nil, httperror.New(http.StatusForbidden, "insufficient_scope", "insufficient_scope: "+scope)
			}
			selected[scope] = true
			continue
		}

		matchedGrant := ""
		for _, grant := range grants {
			if !grant.scopeJSON.Valid {
				continue
			}
			var value map[string]any
			if json.Unmarshal([]byte(grant.scopeJSON.String), &value) != nil ||
				strings.TrimSpace(stringField(value["audience"])) != audience ||
				strings.TrimSpace(stringField(value["semanticScope"])) != scope {
				continue
			}
			if matchedGrant != "" && matchedGrant != grant.scope {
				return nil, httperror.New(http.StatusForbidden, "service_grant_policy_conflict", "service grants have conflicting semantic scope bindings")
			}
			matchedGrant = grant.scope
		}
		if matchedGrant == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_scope", "invalid_scope: scope does not match audience")
		}
		selected[matchedGrant] = true
	}
	var policyBinding map[string]any
	for _, grant := range grants {
		if !selected[grant.scope] || !grant.scopeJSON.Valid {
			continue
		}
		var value map[string]any
		if json.Unmarshal([]byte(grant.scopeJSON.String), &value) != nil {
			return nil, httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "service grant policy binding is invalid")
		}
		tenantCode := strings.TrimSpace(stringField(value["tenantCode"]))
		deploymentCode := strings.TrimSpace(stringField(value["deploymentCode"]))
		if tenantCode == "" && deploymentCode == "" {
			continue
		}
		if tenantCode == "" || deploymentCode == "" {
			return nil, httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "service grant policy binding is incomplete")
		}
		if policyBinding != nil &&
			(policyBinding["tenantCode"] != tenantCode || policyBinding["deploymentCode"] != deploymentCode) {
			return nil, httperror.New(http.StatusForbidden, "service_grant_policy_conflict", "service grants have conflicting policy bindings")
		}
		policyBinding = map[string]any{"tenantCode": tenantCode, "deploymentCode": deploymentCode}
	}
	selectedScopes := make([]string, 0, len(selected))
	for scope := range selected {
		selectedScopes = append(selectedScopes, scope)
	}
	sort.Strings(selectedScopes)
	a.touchServiceClientGrantUsage(ctx, subject.ServiceClientID, selectedScopes)
	return map[string]any{
		"serviceClientId": subject.ServiceClientID, "credentialId": subject.CredentialID,
		"clientId": subject.ClientID, "clientCode": subject.ClientCode,
		"clientName": subject.ClientName, "clientType": subject.ClientType,
		"appCode": authNullableStringValue(subject.AppCode),
		"scope":   strings.Join(requested, " "), "policyBinding": policyBinding,
	}, nil
}

// touchServiceClientGrantUsage 记录每条 grant 最近一次被实际使用的时间。
//
// 授权清理长期缺少判据：grant 授予来源分散在 SQL seed、Go 自动 provision 和
// env 变量三处，而代码里的 scope 有大量是动态拼接的
// （如 altoc 的 `altoc:${resource}:${action}`），**无法靠静态分析判断某条 grant
// 是否仍在使用**。没有使用记录就只能不敢删，权限越积越多。
//
// 这里在 scope 校验通过后按实际签发的 scope 打点。观察足够长的周期
// （建议 2–4 周以覆盖月度任务）后，`last_used_at IS NULL` 的 grant 才可判定为孤儿。
//
// 打点失败不影响令牌签发：可观测性不得成为授权路径的故障点。
func (a *Adapter) touchServiceClientGrantUsage(ctx context.Context, serviceClientID uint64, scopes []string) {
	if serviceClientID == 0 || len(scopes) == 0 {
		return
	}
	for _, scope := range scopes {
		resource, action, err := splitConsoleServiceScope(scope)
		if err != nil {
			continue
		}
		if _, err := a.db.ExecContext(ctx, `
			UPDATE service_client_grants
			SET last_used_at=UTC_TIMESTAMP()
			WHERE service_client_id=? AND resource_code=? AND action=? AND status='active'
		`, serviceClientID, resource, action); err != nil {
			// 仅记录，不阻断签发。
			log.Printf(`{"level":"warn","event":"grant_usage_touch_failed","serviceClientId":%d,"scope":%q,"error":%q}`,
				serviceClientID, scope, err.Error())
			return
		}
	}
}

func (a *Adapter) IssueConsoleRuntimeServiceToken(
	ctx context.Context,
	body map[string]any,
	authDeployment string,
	meta AuditMutationMeta,
) (map[string]any, error) {
	audience, err := requiredAuthString(body["audience"], "audience", 191)
	if err != nil {
		return nil, err
	}
	requestedScopes := strings.Fields(stringField(body["scope"]))
	for _, scope := range requestedScopes {
		if (scope == "console:policy-bundle:read" || scope == "console:policy-bundle:write") && audience != "data-runtime" && audience != "tenant-runtime" {
			return nil, httperror.New(http.StatusForbidden, "console_policy_audience_invalid", "Policy storage requires Runtime audience")
		}
	}
	if len(requestedScopes) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "console_service_token_scope_required", "scope is required")
	}
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 30 || ttlSeconds > 3600 {
		return nil, httperror.New(http.StatusBadRequest, "console_service_token_ttl_invalid", "ttlSeconds must be between 30 and 3600")
	}
	identity, err := a.ensureConsoleRuntimeServiceIdentity(ctx, meta.ActorID)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, scope := range identity.Scopes {
		allowed[scope] = true
	}
	for _, scope := range requestedScopes {
		if !allowed[scope] {
			return nil, httperror.New(http.StatusForbidden, "console_service_token_grant_inactive", "Requested Console Runtime service grant is inactive")
		}
	}
	sort.Strings(requestedScopes)
	authorizedScope := strings.Join(requestedScopes, " ")
	issuedScope, err := resolveConsoleRuntimeIssuedScope(
		audience,
		authorizedScope,
		stringField(body["issuedScope"]),
	)
	if err != nil {
		return nil, err
	}
	sourceBinding := firstValue(stringField(body["sourceBinding"]), "trusted-gateway")
	if sourceBinding != "trusted-gateway" && sourceBinding != "service-client-policy" {
		return nil, httperror.New(http.StatusBadRequest, "console_service_token_source_binding_invalid", "sourceBinding is invalid")
	}
	// This issuer route authenticates Console as both target and source app.
	// Its authenticated deployment is therefore the exact Console binding,
	// including custom test/site codes; never invent a tenant-name deployment.
	deployment := consoleRuntimeServiceDeployment(authDeployment)
	if override := strings.TrimSpace(stringField(body["deploymentCodeOverride"])); override != "" {
		if audience != "data-runtime" || authorizedScope != "data-runtime:runtime:update" ||
			issuedScope != "runtime.update" || override != authDeployment {
			return nil, httperror.New(http.StatusForbidden, "console_service_token_deployment_override_invalid", "deploymentCodeOverride is not bound to the authenticated Runtime")
		}
		deployment = override
	}
	if deployment == "" {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_service_token_deployment_unavailable", "Authenticated Runtime deployment binding is unavailable")
	}
	issuer, err := requiredAuthString(body["issuer"], "issuer", 1000)
	if err != nil {
		return nil, err
	}
	claims := map[string]any{
		"iss": issuer, "sub": "client:" + identity.ClientCode, "aud": audience,
		"azp": identity.ClientID, "client_id": identity.ClientID, "scope": issuedScope,
		"source_app": identity.AppCode, "target_app": audience,
		"tenant": a.tenant, "deployment": deployment,
		"policy_ver": nullableLimitedString(body["policyVersion"], 191),
		"caps":       nullableLimitedString(body["caps"], 191),
		"token_use":  "service",
		"hzy": map[string]any{
			"subjectType": "service", "subjectCode": identity.ClientCode,
			"clientCode": identity.ClientCode, "clientName": identity.ClientName,
			"clientType": identity.ClientType, "appCode": identity.AppCode,
			"credentialId": identity.CredentialID,
		},
	}
	signed, err := a.SignOIDCToken(ctx, map[string]any{
		"claims": claims, "ttlSeconds": ttlSeconds,
	}, meta)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"accessToken": signed["token"], "tokenType": "Bearer",
		"expiresIn": ttlSeconds, "scope": issuedScope,
	}, nil
}

func consoleRuntimeServiceDeployment(authDeployment string) string {
	return strings.TrimSpace(authDeployment)
}

func resolveConsoleRuntimeIssuedScope(
	audience string,
	authorizedScope string,
	requestedIssuedScope string,
) (string, error) {
	issuedScope := strings.TrimSpace(requestedIssuedScope)
	if issuedScope == "" {
		return authorizedScope, nil
	}
	if issuedScope == authorizedScope {
		return issuedScope, nil
	}
	if audience == "data-runtime" &&
		authorizedScope == "data-runtime:runtime:update" &&
		issuedScope == "runtime.update" {
		return issuedScope, nil
	}
	return "", httperror.New(
		http.StatusForbidden,
		"console_service_token_issued_scope_invalid",
		"issuedScope is not derived from the authorized grant",
	)
}

func (a *Adapter) ensureConsoleRuntimeServiceIdentity(
	ctx context.Context,
	actorID string,
) (consoleRuntimeServiceIdentity, error) {
	materialBytes := make([]byte, 32)
	if _, err := rand.Read(materialBytes); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	material, err := a.encryptVaultPlaintext(
		"hzy_console_runtime_" + base64.RawURLEncoding.EncodeToString(materialBytes),
	)
	if err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	defer tx.Rollback()
	var singleton uint64
	if err := tx.QueryRowContext(ctx, `SELECT singleton_key FROM org_profiles WHERE singleton_key=1 FOR UPDATE`).Scan(&singleton); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO service_clients (
			client_code,client_name,client_type,app_code,description,status,created_at,updated_at
		) VALUES (?,'Console Runtime','runtime','console',
			'Customer Tenant Runtime service-token issuer identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE client_name=VALUES(client_name),client_type='runtime',
			app_code='console',description=VALUES(description),status='active',updated_at=UTC_TIMESTAMP()
	`, consoleRuntimeClientCode); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	var serviceClientID uint64
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM service_clients WHERE client_code=? LIMIT 1 FOR UPDATE
	`, consoleRuntimeClientCode).Scan(&serviceClientID); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	for _, scope := range consoleRuntimeServiceScopes {
		resource, action, err := splitConsoleServiceScope(scope)
		if err != nil {
			return consoleRuntimeServiceIdentity{}, err
		}
		if resource == "console:policy-bundle" {
			// Add missing install grants, but never undo an administrator revocation.
			if _, err := tx.ExecContext(ctx, `INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at) VALUES (?,?,?,JSON_OBJECT('source','tenant-runtime-bootstrap'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE resource_code=resource_code`, serviceClientID, resource, action); err != nil {
				return consoleRuntimeServiceIdentity{}, err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO service_client_grants (
				service_client_id,resource_code,action,scope_json,status,created_at,updated_at
			) VALUES (?,?,?,JSON_OBJECT('source','tenant-runtime-bootstrap'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP()
		`, serviceClientID, resource, action); err != nil {
			return consoleRuntimeServiceIdentity{}, err
		}
	}
	var credentialID uint64
	err = tx.QueryRowContext(ctx, `
		SELECT scc.id
		FROM service_clients sc
		INNER JOIN service_client_credentials scc
			ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
		INNER JOIN vault_secrets vs ON vs.id=scc.secret_id AND vs.status='active'
		INNER JOIN vault_secret_versions vsv
			ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id AND vsv.status='active'
		WHERE sc.id=? AND scc.status='active'
			AND (scc.expires_at IS NULL OR scc.expires_at>UTC_TIMESTAMP())
		LIMIT 1
	`, serviceClientID).Scan(&credentialID)
	if err != nil && err != sql.ErrNoRows {
		return consoleRuntimeServiceIdentity{}, err
	}
	if err == sql.ErrNoRows {
		secretCode := "svc.console.runtime.client_secret"
		var secretID uint64
		err = tx.QueryRowContext(ctx, `
			SELECT id FROM vault_secrets WHERE secret_code=? LIMIT 1 FOR UPDATE
		`, secretCode).Scan(&secretID)
		if err != nil && err != sql.ErrNoRows {
			return consoleRuntimeServiceIdentity{}, err
		}
		if err == sql.ErrNoRows {
			insert, insertErr := tx.ExecContext(ctx, `
				INSERT INTO vault_secrets (
					secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
					storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at
				) VALUES (?,?,'Console Runtime client secret','client_secret','service',
					'service_client',?,'db_encrypted','never',?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
			`, secretCode, "hzybase://vault/"+secretCode, consoleRuntimeClientCode,
				material.MaskedPreview, nullableText(actorID))
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			insertedID, insertErr := insert.LastInsertId()
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			secretID = uint64(insertedID)
			versionInsert, insertErr := tx.ExecContext(ctx, `
				INSERT INTO vault_secret_versions (
					secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,
					status,activated_at,created_by,created_at
				) VALUES (?,1,?,?,?,?, 'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())
			`, secretID, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme,
				material.KeyFingerprint, nullableText(actorID))
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			versionID, insertErr := versionInsert.LastInsertId()
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			if _, insertErr = tx.ExecContext(ctx, `
				UPDATE vault_secrets SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP() WHERE id=?
			`, versionID, secretID); insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
		}
		var conflictingServiceClientID uint64
		err = tx.QueryRowContext(ctx, `
			SELECT service_client_id FROM service_client_credentials
			WHERE client_id=? LIMIT 1 FOR UPDATE
		`, consoleRuntimeClientCode).Scan(&conflictingServiceClientID)
		if err != nil && err != sql.ErrNoRows {
			return consoleRuntimeServiceIdentity{}, err
		}
		if err == nil && conflictingServiceClientID != serviceClientID {
			return consoleRuntimeServiceIdentity{}, httperror.New(
				http.StatusConflict, "console_runtime_client_id_conflict",
				"console.runtime client_id belongs to another service client",
			)
		}
		if err == sql.ErrNoRows {
			insert, insertErr := tx.ExecContext(ctx, `
				INSERT INTO service_client_credentials (
					service_client_id,client_id,version_no,secret_id,issued_at,status
				) VALUES (?,?,1,?,UTC_TIMESTAMP(),'active')
			`, serviceClientID, consoleRuntimeClientCode, secretID)
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			insertedID, insertErr := insert.LastInsertId()
			if insertErr != nil {
				return consoleRuntimeServiceIdentity{}, insertErr
			}
			credentialID = uint64(insertedID)
		} else {
			if err := tx.QueryRowContext(ctx, `
				SELECT id FROM service_client_credentials WHERE client_id=? LIMIT 1
			`, consoleRuntimeClientCode).Scan(&credentialID); err != nil {
				return consoleRuntimeServiceIdentity{}, err
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE service_client_credentials
				SET secret_id=?,expires_at=NULL,status='active'
				WHERE id=?
			`, secretID, credentialID); err != nil {
				return consoleRuntimeServiceIdentity{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_client_credentials SET status='retired'
			WHERE service_client_id=? AND id<>? AND status='active'
		`, serviceClientID, credentialID); err != nil {
			return consoleRuntimeServiceIdentity{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_clients SET current_credential_id=?,status='active',updated_at=UTC_TIMESTAMP()
			WHERE id=?
		`, credentialID, serviceClientID); err != nil {
			return consoleRuntimeServiceIdentity{}, err
		}
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT resource_code,action FROM service_client_grants
		WHERE service_client_id=? AND status='active'
	`, serviceClientID)
	if err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	scopes := make([]string, 0)
	for rows.Next() {
		var resource, action string
		if err := rows.Scan(&resource, &action); err != nil {
			rows.Close()
			return consoleRuntimeServiceIdentity{}, err
		}
		scopes = append(scopes, joinConsoleServiceScope(resource, action))
	}
	if err := rows.Close(); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	if err := tx.Commit(); err != nil {
		return consoleRuntimeServiceIdentity{}, err
	}
	return consoleRuntimeServiceIdentity{
		ServiceClientID: serviceClientID, CredentialID: credentialID,
		ClientID: consoleRuntimeClientCode, ClientCode: consoleRuntimeClientCode,
		ClientName: "Console Runtime", ClientType: "runtime", AppCode: "console",
		Scopes: scopes,
	}, nil
}

func splitConsoleServiceScope(scope string) (string, string, error) {
	if scope == "console.schema.read" {
		return "console.schema", "read", nil
	}
	separator := strings.LastIndex(scope, ":")
	if separator <= 0 || separator == len(scope)-1 {
		return "", "", fmt.Errorf("invalid Console Runtime scope %q", scope)
	}
	return scope[:separator], scope[separator+1:], nil
}

func joinConsoleServiceScope(resource string, action string) string {
	if resource == "console.schema" && action == "read" {
		return "console.schema.read"
	}
	return resource + ":" + action
}
