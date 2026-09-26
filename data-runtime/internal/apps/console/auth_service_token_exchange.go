package console

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/gatewaykeys"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// ExchangeConsoleServiceClientToken is the credential-backed client_credentials
// path. The authenticated caller is always console.runtime; the represented
// source app comes only from the active client and its bound grants. A missing
// secret cannot select another app by naming it in a request body.
func (a *Adapter) VerifyConsoleExchangeCaller(ctx context.Context, credentialID int64) error {
	identity, installed, err := a.readConsoleRuntimeServiceIdentity(ctx)
	if err != nil {
		return err
	}
	if !installed || credentialID <= 0 || uint64(credentialID) != identity.CredentialID {
		return httperror.New(http.StatusForbidden, "console_exchange_identity_inactive", "Console Runtime credential is inactive")
	}
	for _, scope := range identity.Scopes {
		if scope == "console:service-token:exchange" {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "console_exchange_grant_inactive", "Console Runtime exchange grant is inactive")
}

func (a *Adapter) ExchangeConsoleServiceClientToken(
	ctx context.Context, body map[string]any, authTenant, authDeployment string, meta AuditMutationMeta,
) (map[string]any, error) {
	if authTenant == "" || authTenant != a.tenant || authDeployment == "" {
		return nil, httperror.New(http.StatusForbidden, "console_exchange_binding_mismatch", "Authenticated Console Runtime binding is invalid")
	}
	if body["appCode"] != nil || body["app_code"] != nil || body["tenant"] != nil || body["deployment"] != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_exchange_untrusted_binding", "Exchange cannot select a source binding")
	}
	if stringField(body["sourceBinding"]) != "service-client-policy" {
		return nil, httperror.New(http.StatusBadRequest, "console_exchange_source_binding_invalid", "Credential policy binding is required")
	}
	if _, err := requiredAuthString(body["clientId"], "client_id", 128); err != nil {
		return nil, err
	}
	if _, err := requiredAuthString(body["clientSecret"], "client_secret", 4096); err != nil {
		return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client")
	}
	if _, err := requiredAuthString(body["audience"], "audience", 191); err != nil {
		return nil, err
	}
	scope := stringField(body["scope"])
	if len(scope) > 4096 {
		return nil, httperror.New(http.StatusBadRequest, "console_exchange_scope_invalid", "scope is too long")
	}
	if _, err := requiredAuthString(body["issuer"], "issuer", 1000); err != nil {
		return nil, err
	}
	if _, err := requiredAuthString(body["policyVersion"], "policyVersion", 191); err != nil {
		return nil, err
	}
	if _, err := requiredAuthString(body["caps"], "caps", 191); err != nil {
		return nil, err
	}
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 30 || ttlSeconds > 3600 {
		return nil, httperror.New(http.StatusBadRequest, "console_exchange_ttl_invalid", "ttlSeconds must be between 30 and 3600")
	}

	// Exchange never provisions a key for an unauthenticated client. The token
	// remains private until grant validation and the audit transaction commit.
	key, err := a.loadCurrentOIDCSigningKey(ctx, meta.ActorID)
	if err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_exchange_signing_key_unavailable", "Current OIDC signing key is unavailable")
	}
	return a.exchangeConsoleServiceClientTokenWithKey(ctx, body, authTenant, authDeployment, key)
}

func (a *Adapter) exchangeConsoleServiceClientTokenWithKey(
	ctx context.Context, body map[string]any, authTenant, authDeployment string, key oidcSigningKey,
) (map[string]any, error) {
	return a.exchangeConsoleServiceTokenWithKey(ctx, body, authTenant, authDeployment, key, nil)
}

// Shared claim construction, key validation, policy digest and audit contract.
// Gateway verification only replaces the secret-backed identity preparation.
func (a *Adapter) exchangeConsoleServiceTokenWithKey(ctx context.Context, body map[string]any, authTenant, authDeployment string, key oidcSigningKey, gateway *gatewaykeys.Assertion) (map[string]any, error) {
	clientID := stringField(body["clientId"])
	clientSecret := stringField(body["clientSecret"])
	audience := stringField(body["audience"])
	scope := stringField(body["scope"])
	issuer := stringField(body["issuer"])
	policyVersion := stringField(body["policyVersion"])
	policyHash := stringField(body["caps"])
	ttlSeconds, _ := integerField(body["ttlSeconds"])
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var subject consumedServiceClient
	if gateway != nil {
		subject, err = gatewaySubject(ctx, tx, *gateway)
		if err != nil {
			return nil, err
		}
	} else {
		var secretID, versionID uint64
		var storageBackend, encryptionScheme string
		var ciphertext []byte
		var backendRef, contentHash sql.NullString
		err = tx.QueryRowContext(ctx, `
		SELECT sc.id,scc.id,scc.client_id,sc.client_code,sc.client_name,sc.client_type,
			sc.app_code,scc.expires_at,vs.id,vsv.id,vs.storage_backend,vsv.encryption_scheme,
			vsv.ciphertext_blob,vsv.backend_secret_ref,vsv.content_hash
		FROM service_client_credentials scc
		INNER JOIN service_clients sc
			ON sc.id=scc.service_client_id AND sc.current_credential_id=scc.id AND sc.status='active'
		INNER JOIN vault_secrets vs ON vs.id=scc.secret_id AND vs.status='active'
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
		if !a.serviceClientSecretMatches(storageBackend, encryptionScheme, ciphertext,
			backendRef.String, contentHash.String, clientSecret) {
			return nil, httperror.New(http.StatusUnauthorized, "invalid_client", "invalid_client")
		}
		if !subject.AppCode.Valid || strings.TrimSpace(subject.AppCode.String) == "" {
			return nil, httperror.New(http.StatusForbidden, "console_exchange_source_missing", "Service client has no bound source app")
		}
		if err := insertVaultAccessLog(ctx, tx, int64(secretID), int64(versionID), "validate", VaultAccessMeta{
			ActorType: "service", ActorID: subject.ClientCode, AppCode: subject.AppCode.String,
			Reason: "oauth.client_credentials.exchange",
		}, "success"); err != nil {
			return nil, err
		}
	}
	selected, err := a.authorizeServiceClientScopesUsing(ctx, tx, subject, audience, scope, true)
	if err != nil {
		return nil, err
	}
	binding, ok := selected["policyBinding"].(map[string]any)
	if !ok || stringField(binding["tenantCode"]) != authTenant || strings.TrimSpace(stringField(binding["deploymentCode"])) == "" {
		return nil, httperror.New(http.StatusForbidden, "console_exchange_grant_binding_invalid", "Service grant is not bound to the authenticated tenant and source deployment")
	}
	if gateway != nil {
		if binding["deploymentCode"] != gateway.Deployment {
			return nil, httperror.New(403, "gateway_exchange_grant_binding_mismatch", "Grant does not bind the signed source deployment")
		}
		if err := cleanupGatewayReplay(ctx, tx, time.Now()); err != nil {
			return nil, err
		}
		if err := insertGatewayReplay(ctx, tx, *gateway); err != nil {
			return nil, err
		}
	}
	var storedVersion, storedHash string
	if err := tx.QueryRowContext(ctx, `
		SELECT bundle_version,bundle_hash FROM policy_bundle_snapshots
		WHERE tenant_code=? AND deployment_code=?
		ORDER BY synced_at_ms DESC LIMIT 1
	`, authTenant, authDeployment).Scan(&storedVersion, &storedHash); err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_exchange_policy_unavailable", "Verified Console policy summary is unavailable")
	}
	if storedVersion != policyVersion || storedHash != policyHash {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_exchange_policy_mismatch", "Verified Console policy summary differs from Runtime storage")
	}
	var currentKey uint64
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM auth_signing_keys WHERE id=? AND status='current'
			AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
			AND (not_after IS NULL OR not_after>UTC_TIMESTAMP()) LIMIT 1
	`, key.ID).Scan(&currentKey); err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_exchange_signing_key_unavailable", "Current OIDC signing key is unavailable")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE service_client_credentials SET last_used_at=UTC_TIMESTAMP() WHERE id=?`, subject.CredentialID); err != nil {
		return nil, err
	}
	claims, err := a.normalizeOIDCSigningClaims(map[string]any{
		"iss": issuer, "sub": "client:" + subject.ClientCode, "aud": audience,
		"azp": subject.ClientID, "client_id": subject.ClientID,
		"scope": selected["scope"], "source_app": subject.AppCode.String, "target_app": audience,
		"tenant": authTenant, "deployment": binding["deploymentCode"],
		"policy_ver": policyVersion, "caps": policyHash, "token_use": "service",
		"hzy": map[string]any{
			"subjectType": "service", "subjectCode": subject.ClientCode,
			"clientCode": subject.ClientCode, "clientName": subject.ClientName,
			"clientType": subject.ClientType, "appCode": subject.AppCode.String,
			"credentialId": subject.CredentialID,
		},
	})
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	claims["iat"] = now.Unix()
	claims["exp"] = now.Add(time.Duration(ttlSeconds) * time.Second).Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims(claims))
	token.Header["kid"] = key.Kid
	token.Header["typ"] = "JWT"
	signed, err := token.SignedString(key.PrivateKey)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO auth_token_events(event_type,client_id,result,created_at)
		VALUES ('issue_service',?,'success',UTC_TIMESTAMP())
	`, subject.ClientID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"accessToken": signed, "tokenType": "Bearer", "expiresIn": ttlSeconds,
		"scope": selected["scope"],
	}, nil
}
