package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/gatewaykeys"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const GatewayExchangeScope = "console:service-token:gateway-exchange"

func (a *Adapter) VerifyGatewayExchangeCaller(ctx context.Context, credentialID int64) error {
	identity, installed, err := a.readConsoleRuntimeServiceIdentity(ctx)
	if err != nil {
		return err
	}
	if !installed || credentialID <= 0 || uint64(credentialID) != identity.CredentialID {
		return httperror.New(403, "console_exchange_identity_inactive", "Console Runtime credential is inactive")
	}
	for _, scope := range identity.Scopes {
		if scope == GatewayExchangeScope {
			return nil
		}
	}
	return httperror.New(403, "console_exchange_grant_inactive", "Console Runtime Gateway exchange grant is inactive")
}

// Binding is the result of Runtime verification, never JSON supplied by Console.
func (a *Adapter) ExchangeGatewayServiceToken(ctx context.Context, body map[string]any, assertion gatewaykeys.Assertion, authTenant, authDeployment string, meta AuditMutationMeta) (map[string]any, error) {
	allowed := map[string]bool{"assertion": true, "audience": true, "scope": true, "clientId": true, "issuer": true, "ttlSeconds": true, "policyVersion": true, "caps": true}
	for k := range body {
		if !allowed[k] {
			return nil, httperror.New(400, "gateway_exchange_body_invalid", "Untrusted exchange fields")
		}
	}
	if authTenant != a.tenant || authTenant != assertion.Tenant || authDeployment == "" {
		return nil, httperror.New(403, "gateway_exchange_binding_mismatch", "Gateway tenant binding differs")
	}
	if stringField(body["audience"]) != assertion.OAuthAudience || stringField(body["scope"]) != assertion.Scope || stringField(body["clientId"]) != assertion.ClientID {
		return nil, httperror.New(403, "gateway_exchange_request_mismatch", "OAuth request differs from the signed assertion")
	}
	for _, field := range []string{"issuer", "policyVersion", "caps"} {
		if _, err := requiredAuthString(body[field], field, 1000); err != nil {
			return nil, err
		}
	}
	ttl, ok := integerField(body["ttlSeconds"])
	if !ok || ttl < 30 || ttl > 3600 {
		return nil, httperror.New(400, "gateway_exchange_ttl_invalid", "Invalid token lifetime")
	}
	key, err := a.loadCurrentOIDCSigningKey(ctx, meta.ActorID)
	if err != nil {
		return nil, httperror.New(503, "console_exchange_signing_key_unavailable", "OIDC signing key is unavailable")
	}
	return a.exchangeConsoleServiceTokenWithKey(ctx, body, authTenant, authDeployment, key, &assertion)
}

// Cleanup is bounded and stays in the issuing transaction. Only rows older than
// the assertion expiry plus its 30-second skew can be deleted. Old assertions
// still fail their time checks after replay tombstones have been removed.
func cleanupGatewayReplay(ctx context.Context, tx *sql.Tx, now time.Time) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM gateway_service_assertion_replay WHERE expires_at < ? ORDER BY expires_at LIMIT 100`, now.UnixMilli()-30000)
	return gatewayReplayError(err)
}
func insertGatewayReplay(ctx context.Context, tx *sql.Tx, a gatewaykeys.Assertion) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO gateway_service_assertion_replay (gateway_deployment_code,jti,tenant_code,environment,kid,expires_at) VALUES(?,?,?,?,?,?)`, a.GatewayDeployment, a.JTI, a.Tenant, a.Environment, a.KID, a.ExpiresAt*1000)
	return gatewayReplayError(err)
}
func gatewayReplayError(err error) error {
	if err == nil {
		return nil
	}
	var dbErr *mysql.MySQLError
	if errors.As(err, &dbErr) {
		if dbErr.Number == 1062 {
			return httperror.New(http.StatusUnauthorized, "gateway_assertion_replayed", "Gateway assertion was already consumed")
		}
		if dbErr.Number == 1146 {
			return httperror.New(http.StatusServiceUnavailable, "gateway_replay_storage_unavailable", "Gateway replay storage is not installed")
		}
	}
	return err
}
func gatewaySubject(ctx context.Context, tx *sql.Tx, a gatewaykeys.Assertion) (consumedServiceClient, error) {
	var subject consumedServiceClient
	// No client-code fallback may select a different app. The signed source must
	// equal the active client's stored app_code; aliases remain compatible.
	err := tx.QueryRowContext(ctx, `SELECT sc.id,scc.id,scc.client_id,sc.client_code,sc.client_name,sc.client_type,sc.app_code,scc.expires_at
 FROM service_clients sc INNER JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
 WHERE BINARY sc.app_code=? AND sc.status='active' AND scc.status='active' AND (scc.expires_at IS NULL OR scc.expires_at>UTC_TIMESTAMP())
 ORDER BY sc.id LIMIT 1 FOR UPDATE`, a.AppCode).Scan(&subject.ServiceClientID, &subject.CredentialID, &subject.ClientID, &subject.ClientCode, &subject.ClientName, &subject.ClientType, &subject.AppCode, &subject.ExpiresAt)
	if err == sql.ErrNoRows {
		return subject, httperror.New(401, "invalid_client", "Runtime app identity is inactive")
	}
	if err != nil {
		return subject, err
	}
	if !subject.AppCode.Valid || subject.AppCode.String != a.AppCode || !(a.ClientID == subject.ClientID || a.ClientID == subject.ClientCode || a.ClientID == a.AppCode || a.ClientID == a.AppCode+".runtime") {
		return subject, httperror.New(401, "invalid_client", "Client does not match signed Gateway source")
	}
	if strings.TrimSpace(a.Deployment) == "" {
		return subject, httperror.New(403, "gateway_exchange_binding_mismatch", "Source deployment is missing")
	}
	return subject, nil
}
