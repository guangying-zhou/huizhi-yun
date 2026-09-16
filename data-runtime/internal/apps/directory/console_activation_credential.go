package directory

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 目录账号一次性激活凭据。
//
// People 受控入职不得接收明文初始密码，因此账号以 Console 生成、谁都不知道
// 也不留存的一次性口令创建，员工凭激活凭据自行设定真实密码。库里只保存令牌
// 的 SHA-256，明文令牌只在签发响应里出现一次并直接投递给员工本人。
const (
	consoleActivationTokenBytes  = 32
	consoleActivationTTL         = 72 * time.Hour
	consoleActivationMaxAttempts = 10
)

type consoleActivationCredential struct {
	CredentialID string
	UID          string
	Purpose      string
	AttemptCount int
}

func consoleActivationTokenHash(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func newConsoleActivationToken() (string, error) {
	buffer := make([]byte, consoleActivationTokenBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

// issueConsoleActivationCredentialTx 作废该 uid 现存的 active 凭据后签发一条新的。
// 同一账号并行有效的激活路径只允许一条，否则一条被泄露的旧链接仍可改密。
func issueConsoleActivationCredentialTx(
	ctx context.Context,
	tx *sql.Tx,
	uid string,
	purpose string,
	sourceApp string,
	issuedOperationID string,
) (string, string, time.Time, error) {
	if _, err := tx.ExecContext(ctx, `UPDATE directory_activation_credentials
		SET status='revoked',updated_at=UTC_TIMESTAMP(3)
		WHERE uid=? AND status='active'`, uid); err != nil {
		return "", "", time.Time{}, err
	}
	token, err := newConsoleActivationToken()
	if err != nil {
		return "", "", time.Time{}, err
	}
	credentialID, err := randomConsoleMutationUUID()
	if err != nil {
		return "", "", time.Time{}, err
	}
	expiresAt := time.Now().UTC().Add(consoleActivationTTL)
	if _, err := tx.ExecContext(ctx, `INSERT INTO directory_activation_credentials
		(credential_id,uid,token_sha256,purpose,source_app,issued_operation_id,status,expires_at,created_at,updated_at)
		VALUES (?,?,?,?,?,?,'active',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		credentialID, uid, consoleActivationTokenHash(token), purpose,
		nullableConsoleText(sourceApp), nullableConsoleText(issuedOperationID), expiresAt); err != nil {
		return "", "", time.Time{}, err
	}
	return token, credentialID, expiresAt, nil
}

// ConsoleIssueOnboardingActivationCredential only issues a bearer credential
// after the matching LDAP create operation and LDAP identity are both durable.
// Each explicit delivery attempt rotates the prior credential, so a failed or
// lost delivery can be retried without retaining plaintext server-side.
func (a *Adapter) ConsoleIssueOnboardingActivationCredential(
	ctx context.Context,
	uid string,
	operationID string,
	onboardingCode string,
	sourceApp string,
) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	operationID = strings.TrimSpace(operationID)
	onboardingCode = strings.TrimSpace(onboardingCode)
	if !consoleLDAPUIDPattern.MatchString(uid) || !consoleConnectorOperationIDPattern.MatchString(operationID) || onboardingCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "directory_activation_operation_invalid", "Activation UID or operation id is invalid")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var operationStatus string
	err = tx.QueryRowContext(ctx, `SELECT status FROM integration_operation
		WHERE operation_id=? AND operation_code='console.directory-connector.create-user.v1'
		  AND target_app='directory-connector' AND source_biz_code=?
		  AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.sourceApp'))='people'
		  AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.sourceBizCode'))=? FOR UPDATE`, operationID, uid, onboardingCode).
		Scan(&operationStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_connector_operation_not_found", "LDAP onboarding operation was not found")
	}
	if err != nil {
		return nil, err
	}
	if operationStatus != "succeeded" {
		return nil, httperror.New(http.StatusConflict, "directory_activation_operation_pending", "LDAP account creation has not succeeded")
	}

	var ldapIdentity int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_identities
		WHERE uid=? AND provider_code='ldap' AND status='active' AND provider_dn IS NOT NULL`, uid).Scan(&ldapIdentity); err != nil {
		return nil, err
	}
	if ldapIdentity != 1 {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_identity_missing", "Account has no manageable LDAP identity yet")
	}

	token, credentialID, expiresAt, err := issueConsoleActivationCredentialTx(ctx, tx, uid, "initial_activation", sourceApp, operationID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"uid": uid, "activationToken": token, "activationCredentialId": credentialID,
		"activationExpiresAt": expiresAt.UTC().Format(time.RFC3339),
	}, nil
}

// ConsoleInspectActivationCredential 供激活页在渲染表单前判断令牌是否仍可用。
// 它只返回 uid 和过期时间，不泄露任何其他目录字段。
func (a *Adapter) ConsoleInspectActivationCredential(ctx context.Context, token string) (map[string]any, error) {
	credential, expiresAt, err := a.loadActiveConsoleActivationCredential(ctx, token)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"uid":       credential.UID,
		"purpose":   credential.Purpose,
		"expiresAt": expiresAt.UTC().Format(time.RFC3339),
	}, nil
}

func (a *Adapter) loadActiveConsoleActivationCredential(ctx context.Context, token string) (consoleActivationCredential, time.Time, error) {
	normalized := strings.TrimSpace(token)
	if normalized == "" || len(normalized) > 512 {
		return consoleActivationCredential{}, time.Time{}, consoleActivationInvalid()
	}
	var credential consoleActivationCredential
	var status string
	var expiresAt time.Time
	err := a.db.QueryRowContext(ctx, `SELECT credential_id,uid,purpose,status,attempt_count,expires_at
		FROM directory_activation_credentials WHERE token_sha256=? LIMIT 1`,
		consoleActivationTokenHash(normalized)).
		Scan(&credential.CredentialID, &credential.UID, &credential.Purpose, &status, &credential.AttemptCount, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return consoleActivationCredential{}, time.Time{}, consoleActivationInvalid()
	}
	if err != nil {
		return consoleActivationCredential{}, time.Time{}, err
	}
	if status != "active" || credential.AttemptCount >= consoleActivationMaxAttempts {
		return consoleActivationCredential{}, time.Time{}, consoleActivationInvalid()
	}
	if !expiresAt.After(time.Now().UTC()) {
		return consoleActivationCredential{}, time.Time{}, consoleActivationInvalid()
	}
	return credential, expiresAt, nil
}

// consoleActivationInvalid 对「不存在」「已兑换」「已过期」「已作废」返回同一个
// 错误码。区分这些状态会把有效令牌的存在性泄露给暴力尝试者。
func consoleActivationInvalid() error {
	return httperror.New(http.StatusNotFound, "directory_activation_credential_invalid",
		"Activation link is invalid or has expired")
}

// ConsoleRedeemActivationCredential 校验令牌后排队一次管理员改密，并把凭据置为
// 已兑换。校验、消费和排队在同一事务内完成，令牌无法被并发兑换两次。
func (a *Adapter) ConsoleRedeemActivationCredential(
	ctx context.Context,
	token string,
	newPassword string,
	deployment string,
	requestID string,
) (map[string]any, error) {
	credential, _, err := a.loadActiveConsoleActivationCredential(ctx, token)
	if err != nil {
		return nil, err
	}
	if _, _, err := consoleLDAPPassword(newPassword, credential.UID); err != nil {
		return nil, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// 重新在事务内锁定并复核状态：两个并发兑换只有一个能把 active 改成 redeemed。
	var status string
	var attemptCount int
	var expiresAt time.Time
	if err = tx.QueryRowContext(ctx, `SELECT status,attempt_count,expires_at
		FROM directory_activation_credentials WHERE credential_id=? FOR UPDATE`,
		credential.CredentialID).Scan(&status, &attemptCount, &expiresAt); err != nil {
		return nil, err
	}
	if status != "active" || attemptCount >= consoleActivationMaxAttempts || !expiresAt.After(time.Now().UTC()) {
		return nil, consoleActivationInvalid()
	}

	state, err := a.consoleLDAPState(ctx, tx, deployment, true)
	if err != nil {
		return nil, err
	}
	if err = requireManagedConsoleLDAP(state); err != nil {
		return nil, err
	}
	// DN 与自助改密同源，来自 LDAP identity；directory_users 不保存 DN。
	var dn string
	err = tx.QueryRowContext(ctx, `SELECT provider_dn FROM directory_identities
		WHERE uid=? AND provider_code='ldap' AND status='active' LIMIT 1 FOR UPDATE`, credential.UID).Scan(&dn)
	if errors.Is(err, sql.ErrNoRows) || strings.TrimSpace(dn) == "" {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_identity_missing",
			"Account has no manageable LDAP identity yet")
	}
	if err != nil {
		return nil, err
	}
	ciphertext, err := encryptConsoleConnectorSecret(state.PublicKeyPEM, newPassword)
	if err != nil {
		return nil, err
	}
	command := map[string]any{
		"uid": credential.UID, "dn": dn, "newPasswordCiphertext": ciphertext,
	}
	operation, err := a.insertConsoleConnectorOperationTx(
		ctx, tx, deployment, credential.UID, "reset_password", credential.UID, command,
	)
	if err != nil {
		return nil, err
	}

	result, err := tx.ExecContext(ctx, `UPDATE directory_activation_credentials
		SET status='redeemed',redeemed_at=UTC_TIMESTAMP(3),redeem_operation_id=?,
			attempt_count=attempt_count+1,updated_at=UTC_TIMESTAMP(3)
		WHERE credential_id=? AND status='active'`, text(operation["operationId"]), credential.CredentialID)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, consoleActivationInvalid()
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at)
		VALUES ('directory','directory.activation.redeem','directory_user',?,'activation_credential',?,?,
			JSON_OBJECT('credentialId',?,'operationId',?),UTC_TIMESTAMP())`,
		credential.UID, credential.UID, nullableConsoleText(requestID),
		credential.CredentialID, text(operation["operationId"])); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"uid":         credential.UID,
		"operationId": operation["operationId"],
		"status":      operation["status"],
	}, nil
}
