package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var sha256HexPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var externalLoginTargetPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

func (a *Adapter) IssueExternalLoginTransaction(
	ctx context.Context,
	body map[string]any,
	deployment string,
) (map[string]any, error) {
	provider, err := normalizeExternalLoginProvider(body["provider"])
	if err != nil {
		return nil, err
	}
	integrationCode, err := normalizeOptionalIntegrationCode(body["integrationCode"])
	if err != nil {
		return nil, err
	}
	stateHash, err := normalizeSHA256Hex(body["stateSha256"])
	if err != nil {
		return nil, err
	}
	browserHash, err := normalizeSHA256Hex(body["browserBindingSha256"])
	if err != nil {
		return nil, err
	}
	targetApp := strings.ToLower(strings.TrimSpace(integrationText(body["targetApp"])))
	if !externalLoginTargetPattern.MatchString(targetApp) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_external_login_target_invalid",
			"External login target app is invalid",
		)
	}
	redirectPath, err := normalizeExternalLoginRedirect(body["redirect"])
	if err != nil {
		return nil, err
	}
	deployment = strings.TrimSpace(deployment)
	if deployment == "" || a.tenant == "" {
		return nil, httperror.New(
			http.StatusForbidden,
			"console_external_login_binding_incomplete",
			"External login runtime binding is incomplete",
		)
	}
	transactionID := uuid.NewString()
	expiresAt := time.Now().UTC().Add(5 * time.Minute)
	_, err = a.db.ExecContext(ctx, `INSERT INTO auth_external_login_transactions (
		transaction_id,provider_code,integration_code,state_sha256,browser_binding_sha256,
		tenant_code,deployment_code,target_app_code,redirect_path,status,expires_at,
		issued_at,created_at,updated_at
	) VALUES (?,?,?,?,?,?,?,?,?,'issued',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		transactionID, provider, nullableVaultText(integrationCode), stateHash, browserHash,
		a.tenant, deployment, targetApp, redirectPath, expiresAt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"transactionId": transactionID,
		"expiresAt":     expiresAt.Format(time.RFC3339Nano),
	}, nil
}

func (a *Adapter) ConsumeExternalLoginTransaction(
	ctx context.Context,
	body map[string]any,
	deployment string,
) (result map[string]any, err error) {
	provider, err := normalizeExternalLoginProvider(body["provider"])
	if err != nil {
		return nil, err
	}
	stateHash, err := normalizeSHA256Hex(body["stateSha256"])
	if err != nil {
		return nil, err
	}
	browserHash, err := normalizeSHA256Hex(body["browserBindingSha256"])
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var transactionID, storedBrowserHash, tenantCode, deploymentCode string
	var targetApp, redirectPath, status string
	var integrationCode sql.NullString
	var expiresAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT
			transaction_id,integration_code,browser_binding_sha256,tenant_code,
			deployment_code,target_app_code,redirect_path,status,expires_at
		FROM auth_external_login_transactions
		WHERE provider_code=? AND state_sha256=?
		LIMIT 1 FOR UPDATE`,
		provider, stateHash).Scan(
		&transactionID, &integrationCode, &storedBrowserHash, &tenantCode,
		&deploymentCode, &targetApp, &redirectPath, &status, &expiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_external_login_state_invalid",
			"External login state is invalid or already used",
		)
	}
	if err != nil {
		return nil, err
	}
	if status != "issued" {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_external_login_state_invalid",
			"External login state is invalid or already used",
		)
	}
	if !expiresAt.After(time.Now().UTC()) {
		if _, err = tx.ExecContext(ctx, `UPDATE auth_external_login_transactions
			SET status='expired',updated_at=UTC_TIMESTAMP(3)
			WHERE transaction_id=? AND status='issued'`, transactionID); err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_external_login_state_expired",
			"External login state has expired",
		)
	}
	if tenantCode != a.tenant || deploymentCode != strings.TrimSpace(deployment) ||
		storedBrowserHash != browserHash {
		return nil, httperror.New(
			http.StatusForbidden,
			"console_external_login_binding_mismatch",
			"External login state binding does not match",
		)
	}
	update, err := tx.ExecContext(ctx, `UPDATE auth_external_login_transactions
		SET status='consumed',consumed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE transaction_id=? AND status='issued'`, transactionID)
	if err != nil {
		return nil, err
	}
	affected, err := update.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(
			http.StatusConflict,
			"console_external_login_state_consumed",
			"External login state was already consumed",
		)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"targetApp":       targetApp,
		"integrationCode": nullableVaultString(integrationCode),
		"redirect":        redirectPath,
	}, nil
}

func normalizeExternalLoginProvider(value any) (string, error) {
	provider := strings.ToLower(strings.TrimSpace(integrationText(value)))
	if provider != "wecom" && provider != "dingtalk" {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_external_login_provider_invalid",
			"External login provider is invalid",
		)
	}
	return provider, nil
}

func normalizeOptionalIntegrationCode(value any) (string, error) {
	code := strings.TrimSpace(integrationText(value))
	if code == "" {
		return "", nil
	}
	return normalizeIntegrationCode(code, "integrationCode")
}

func normalizeSHA256Hex(value any) (string, error) {
	hash := strings.ToLower(strings.TrimSpace(integrationText(value)))
	if !sha256HexPattern.MatchString(hash) {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_external_login_hash_invalid",
			"External login hash is invalid",
		)
	}
	return hash, nil
}

func normalizeExternalLoginRedirect(value any) (string, error) {
	redirect := strings.TrimSpace(integrationText(value))
	if redirect == "" {
		redirect = "/"
	}
	if len(redirect) > 2048 || !strings.HasPrefix(redirect, "/") ||
		strings.HasPrefix(redirect, "//") || strings.ContainsAny(redirect, "\r\n\\") {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_external_login_redirect_invalid",
			"External login redirect is invalid",
		)
	}
	return redirect, nil
}
