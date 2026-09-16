package directory

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
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleLDAPUIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{2,64}$`)
var consoleConnectorOperationIDPattern = regexp.MustCompile(`^[A-Fa-f0-9-]{36}$`)

type consoleLDAPSourceState struct {
	Config          map[string]any
	Status          string
	ConnectorID     string
	PublicKeyPEM    string
	ConnectorStatus string
}

func (a *Adapter) ConsoleDirectoryProvisioningState(
	ctx context.Context,
	deployment string,
) (map[string]any, error) {
	state, err := a.consoleLDAPState(ctx, a.db, deployment, false)
	if err != nil {
		return nil, err
	}
	managementMode := text(state.Config["managementMode"])
	directoryType := text(state.Config["directoryType"])
	if directoryType == "" {
		directoryType = "openldap"
	}
	managed := state.Status == "active" && managementMode == "managed"
	return map[string]any{
		"ldapConfigured": state.Status != "",
		"ldapManaged":    managed,
		"connectorReady": state.ConnectorStatus == "active",
		"directoryType":  directoryType,
		"defaultTarget":  map[bool]string{true: "ldap", false: "console"}[managed],
	}, nil
}

func (a *Adapter) ConsoleSelfLDAPPasswordCapability(
	ctx context.Context,
	uid string,
	deployment string,
) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "A trusted Console user is required")
	}
	state, err := a.consoleLDAPState(ctx, a.db, deployment, false)
	if err != nil {
		return nil, err
	}
	var providerDN sql.NullString
	err = a.db.QueryRowContext(ctx, `SELECT provider_dn FROM directory_identities
		WHERE uid=? AND provider_code='ldap' AND status='active' LIMIT 1`, uid).Scan(&providerDN)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	managed := state.Status == "active" && text(state.Config["managementMode"]) == "managed"
	available := managed && state.ConnectorStatus == "active" && providerDN.Valid && strings.TrimSpace(providerDN.String) != ""
	var reason any
	if !available {
		switch {
		case !providerDN.Valid || strings.TrimSpace(providerDN.String) == "":
			reason = "当前账号未绑定 LDAP 身份"
		case !managed:
			reason = "LDAP 目录源未启用托管模式"
		default:
			reason = "Directory Connector 尚未就绪"
		}
	}
	return map[string]any{"available": available, "provider": "ldap", "reason": reason}, nil
}

func (a *Adapter) ConsoleDirectoryConnectorOperation(
	ctx context.Context,
	operationID string,
	actorUID string,
) (map[string]any, error) {
	operationID = strings.TrimSpace(operationID)
	actorUID = strings.TrimSpace(actorUID)
	if !consoleConnectorOperationIDPattern.MatchString(operationID) {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_operation_id_invalid", "Directory Connector operation id is invalid")
	}
	var operationCode, sourceBizCode, status string
	var createdAt, updatedAt time.Time
	var attemptCount uint64
	var errorCode, errorSummary sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT operation_code,source_biz_code,status,attempt_count,
		created_at,updated_at,last_error_code,last_error_summary
		FROM integration_operation
		WHERE operation_id=? AND target_app='directory-connector' AND original_actor_uid=?
		LIMIT 1`, operationID, actorUID).Scan(
		&operationCode, &sourceBizCode, &status, &attemptCount,
		&createdAt, &updatedAt, &errorCode, &errorSummary,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_connector_operation_not_found", "LDAP operation was not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": operationID, "operationCode": operationCode, "uid": sourceBizCode,
		"status": status, "attemptCount": attemptCount,
		"createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano),
		"errorCode": nullableSQLString(errorCode), "errorMessage": nullableSQLString(errorSummary),
	}, nil
}

// ConsoleDirectoryOnboardingOperation is the redacted service-command view used
// by People recovery. Authorization is established at the runtime boundary; the
// operation is additionally bound to the onboarding UID instead of the HR user
// who happened to start it, so another authorized administrator can recover it.
func (a *Adapter) ConsoleDirectoryOnboardingOperation(
	ctx context.Context,
	operationID string,
	uid string,
	onboardingCode string,
) (map[string]any, error) {
	operationID = strings.TrimSpace(operationID)
	uid = strings.TrimSpace(uid)
	onboardingCode = strings.TrimSpace(onboardingCode)
	if !consoleConnectorOperationIDPattern.MatchString(operationID) || !consoleLDAPUIDPattern.MatchString(uid) || onboardingCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_operation_id_invalid", "Directory Connector operation id or UID is invalid")
	}
	var operationCode, sourceBizCode, status string
	var createdAt, updatedAt time.Time
	var attemptCount uint64
	var errorCode, errorSummary sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT operation_code,source_biz_code,status,attempt_count,
		created_at,updated_at,last_error_code,last_error_summary
		FROM integration_operation
		WHERE operation_id=? AND target_app='directory-connector' AND source_biz_code=?
		  AND operation_code='console.directory-connector.create-user.v1'
		  AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.sourceApp'))='people'
		  AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.sourceBizCode'))=?
		LIMIT 1`, operationID, uid, onboardingCode).Scan(
		&operationCode, &sourceBizCode, &status, &attemptCount,
		&createdAt, &updatedAt, &errorCode, &errorSummary,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_connector_operation_not_found", "LDAP onboarding operation was not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": operationID, "operationCode": operationCode, "uid": sourceBizCode,
		"status": status, "attemptCount": attemptCount,
		"createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano),
		"errorCode": nullableSQLString(errorCode), "errorMessage": nullableSQLString(errorSummary),
	}, nil
}

func (a *Adapter) ConsoleQueueLDAPUserCreate(
	ctx context.Context,
	body map[string]any,
	deployment string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	uid := text(body["uid"])
	if !consoleLDAPUIDPattern.MatchString(uid) {
		return nil, httperror.New(http.StatusBadRequest, "directory_ldap_uid_invalid", "LDAP UID is invalid")
	}
	issueActivation := isTrueConsoleFlag(body["issueActivationCredential"])
	password, generated, err := consoleLDAPPassword(body["initialPassword"], uid)
	if err != nil {
		return nil, err
	}
	payload := cloneWithoutConsoleSecrets(body, "initialPassword")
	payload["uid"] = uid
	session, replay, err := a.beginConsoleMutation(ctx, "directory.connector.user-create.queue", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	state, err := a.consoleLDAPState(ctx, session.tx, deployment, true)
	if err != nil {
		return nil, err
	}
	if err = requireManagedConsoleLDAP(state); err != nil {
		return nil, err
	}
	reservationID, err := requireActiveConsoleReservationTx(ctx, session.tx, body)
	if err != nil {
		return nil, err
	}
	var exists int
	if err = session.tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_users WHERE uid=?", uid).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_user_exists", "Directory user already exists")
	}
	primaryDeptCode := text(body["primaryDeptCode"])
	if primaryDeptCode != "" {
		var active int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_departments
			WHERE dept_code=? AND status='active'`, primaryDeptCode).Scan(&active); err != nil {
			return nil, err
		}
		if active != 1 {
			return nil, httperror.New(http.StatusBadRequest, "directory_primary_department_invalid", "Primary department does not exist or is inactive")
		}
	}
	var pending int
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM integration_operation
		WHERE target_app='directory-connector' AND source_biz_type='directory_user' AND source_biz_code=?
		AND operation_code='console.directory-connector.create-user.v1'
		AND status IN ('pending','processing','retry_wait','partial_unknown')`, uid).Scan(&pending); err != nil {
		return nil, err
	}
	if pending > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_connector_operation_pending", "An LDAP create operation is already pending for this user")
	}
	ciphertext, err := encryptConsoleConnectorSecret(state.PublicKeyPEM, password)
	if err != nil {
		return nil, err
	}
	command := map[string]any{
		"uid": uid, "username": firstText(body["username"], uid),
		"displayName": firstText(body["displayName"], body["realName"], uid),
		"realName":    nullable(text(body["realName"])), "email": nullable(text(body["email"])),
		"mobile": nullable(text(body["mobile"])), "positionTitle": nullable(text(body["positionTitle"])),
		"primaryDeptCode": nullable(primaryDeptCode), "userType": firstText(body["userType"], "employee"),
		"status": firstText(body["status"], "active"), "initialPasswordCiphertext": ciphertext,
		"reservationId": nullable(reservationID),
		"sourceApp":     nullable(text(body["sourceApp"])), "sourceBizCode": nullable(text(body["sourceBizCode"])),
		"providerCode": nullable(strings.ToLower(text(body["providerCode"]))), "providerSubject": nullable(text(body["providerSubject"])),
	}
	result, err = a.insertConsoleConnectorOperationTx(
		ctx, session.tx, deployment, meta.ActorID, "create_user", uid, command,
	)
	if err != nil {
		return nil, err
	}
	// 排队成功后消费该 UID 的预留：此后由 directory_users 与 pending operation
	// 接管冲突排斥，预留不必继续占位。
	if err = consumeConsoleReservationTx(ctx, session.tx, reservationID, uid); err != nil {
		return nil, err
	}
	// 激活模式下 Console 生成的口令是一次性抛弃值，谁都不会看到：员工凭激活
	// 凭据自行设定真实密码。此时明文绝不返回给调用方——People 按约束不得接收
	// 明文，而激活令牌会直接投递给员工本人。
	var revealed map[string]any
	if issueActivation {
		if !generated {
			return nil, httperror.New(http.StatusBadRequest, "directory_activation_password_conflict",
				"An activation credential cannot be issued together with a caller supplied password")
		}
		token, credentialID, expiresAt, activationErr := issueConsoleActivationCredentialTx(
			ctx, session.tx, uid, "initial_activation", text(body["sourceApp"]), text(result["operationId"]),
		)
		if activationErr != nil {
			return nil, activationErr
		}
		revealed = make(map[string]any, len(result)+3)
		for key, value := range result {
			revealed[key] = value
		}
		revealed["activationToken"] = token
		revealed["activationCredentialId"] = credentialID
		revealed["activationExpiresAt"] = expiresAt.UTC().Format(time.RFC3339)
		revealed["initialPasswordGenerated"] = true
	}
	if err = finishConsoleMutation(ctx, session, "directory.connector.user-create.queue",
		"directory_connector_operation", text(result["operationId"]),
		map[string]any{"uid": uid, "operationId": result["operationId"], "initialPasswordGenerated": generated},
		result); err != nil {
		return nil, err
	}
	if issueActivation {
		return revealed, nil
	}
	if !generated {
		return result, nil
	}
	// Console 生成的初始密码只在本次响应里出现一次。它绝不能进入 result，
	// 因为 finishConsoleMutation 会把 result 持久化到 console_mutation_receipts
	// 供幂等重放读取——重放同一个 Idempotency-Key 只会拿到不含密码的结果。
	revealed = make(map[string]any, len(result)+2)
	for key, value := range result {
		revealed[key] = value
	}
	revealed["initialPassword"] = password
	revealed["initialPasswordGenerated"] = true
	return revealed, nil
}

func (a *Adapter) ConsoleQueueSelfLDAPPasswordChange(
	ctx context.Context,
	body map[string]any,
	deployment string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	uid := strings.TrimSpace(meta.ActorID)
	currentPassword := fmt.Sprint(body["currentPassword"])
	if body["currentPassword"] == nil || currentPassword == "" || currentPassword == "<nil>" {
		return nil, httperror.New(http.StatusBadRequest, "directory_current_password_required", "Current password is required")
	}
	// 自助改密由用户自己设定新密码，缺值必须报错而不是替他生成一个他不知道的密码。
	if body["newPassword"] == nil || strings.TrimSpace(fmt.Sprint(body["newPassword"])) == "" {
		return nil, httperror.New(http.StatusBadRequest, "directory_password_invalid", "Password must contain 10 to 128 characters")
	}
	newPassword, _, err := consoleLDAPPassword(body["newPassword"], uid)
	if err != nil {
		return nil, err
	}
	if currentPassword == newPassword {
		return nil, httperror.New(http.StatusBadRequest, "directory_password_unchanged", "New password must differ from current password")
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.connector.password-change.queue", meta, map[string]any{"uid": uid})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	state, err := a.consoleLDAPState(ctx, session.tx, deployment, true)
	if err != nil {
		return nil, err
	}
	if err = requireManagedConsoleLDAP(state); err != nil {
		return nil, err
	}
	var providerDN string
	err = session.tx.QueryRowContext(ctx, `SELECT provider_dn FROM directory_identities
		WHERE uid=? AND provider_code='ldap' AND status='active' LIMIT 1 FOR UPDATE`, uid).Scan(&providerDN)
	if errors.Is(err, sql.ErrNoRows) || strings.TrimSpace(providerDN) == "" {
		return nil, httperror.New(http.StatusConflict, "directory_ldap_identity_missing", "Current user has no manageable LDAP identity")
	}
	if err != nil {
		return nil, err
	}
	currentCiphertext, err := encryptConsoleConnectorSecret(state.PublicKeyPEM, currentPassword)
	if err != nil {
		return nil, err
	}
	newCiphertext, err := encryptConsoleConnectorSecret(state.PublicKeyPEM, newPassword)
	if err != nil {
		return nil, err
	}
	result, err = a.insertConsoleConnectorOperationTx(ctx, session.tx, deployment, uid,
		"change_password", uid, map[string]any{
			"uid": uid, "dn": providerDN,
			"currentPasswordCiphertext": currentCiphertext, "newPasswordCiphertext": newCiphertext,
		})
	if err != nil {
		return nil, err
	}
	err = finishConsoleMutation(ctx, session, "directory.connector.password-change.queue",
		"directory_connector_operation", text(result["operationId"]),
		map[string]any{"uid": uid, "operationId": result["operationId"]}, result)
	return result, err
}

func (a *Adapter) ConsoleQueueLDAPSync(
	ctx context.Context,
	deployment string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	return a.consoleQueueSimpleLDAPOperation(ctx, deployment, meta, "sync_now", "__ldap_directory__", false)
}

func (a *Adapter) ConsoleQueueLDAPConnectionTest(
	ctx context.Context,
	deployment string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	return a.consoleQueueSimpleLDAPOperation(ctx, deployment, meta, "test_connection", "__ldap_connection__", true)
}

func (a *Adapter) consoleQueueSimpleLDAPOperation(
	ctx context.Context,
	deployment string,
	meta ConsoleMutationMeta,
	operationType string,
	sourceBizCode string,
	singleton bool,
) (result map[string]any, err error) {
	operation := "directory.connector." + strings.ReplaceAll(operationType, "_", "-") + ".queue"
	session, replay, err := a.beginConsoleMutation(ctx, operation, meta, map[string]any{
		"deployment": deployment, "sourceBizCode": sourceBizCode,
	})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	state, err := a.consoleLDAPState(ctx, session.tx, deployment, true)
	if err != nil {
		return nil, err
	}
	if err = requireManagedConsoleLDAP(state); err != nil {
		return nil, err
	}
	if singleton {
		var pending int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM integration_operation
			WHERE target_app='directory-connector' AND tenant_code=? AND deployment_code=?
			AND operation_code='console.directory-connector.test-connection.v1'
			AND status IN ('pending','processing','retry_wait','partial_unknown')`,
			a.tenant, deployment).Scan(&pending); err != nil {
			return nil, err
		}
		if pending > 0 {
			return nil, httperror.New(http.StatusConflict, "directory_connector_test_pending", "An LDAP connection test is already pending")
		}
	}
	result, err = a.insertConsoleConnectorOperationTx(ctx, session.tx, deployment, meta.ActorID,
		operationType, sourceBizCode, map[string]any{
			"fullSync": operationType == "sync_now", "requestedBy": meta.ActorID,
		})
	if err != nil {
		return nil, err
	}
	if singleton {
		if _, err = session.tx.ExecContext(ctx, `UPDATE integrations
			SET connectivity_status='checking',updated_at=UTC_TIMESTAMP()
			WHERE integration_code='directory.ldap'`); err != nil {
			return nil, err
		}
	}
	err = finishConsoleMutation(ctx, session, operation, "directory_connector_operation",
		text(result["operationId"]), map[string]any{"operationId": result["operationId"]}, result)
	return result, err
}

func (a *Adapter) insertConsoleConnectorOperationTx(
	ctx context.Context,
	tx *sql.Tx,
	deployment string,
	actorUID string,
	operationType string,
	sourceBizCode string,
	command map[string]any,
) (map[string]any, error) {
	operationID := uuid.NewString()
	operationCode := "console.directory-connector." + strings.ReplaceAll(operationType, "_", "-") + ".v1"
	operationKey := "directory-connector:" + operationType + ":" + sourceBizCode + ":" + operationID
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	commandDigest := sha256.Sum256(commandJSON)
	if _, err := tx.ExecContext(ctx, `INSERT INTO integration_operation (
		operation_id,operation_key,tenant_code,deployment_code,source_app,target_app,
		operation_code,required_capability,source_biz_type,source_biz_code,
		idempotency_key,command_schema_version,command_json,command_sha256,status,
		original_actor_uid,next_attempt_at,created_at,updated_at
	) VALUES (?, ?, ?, ?, 'console', 'directory-connector', ?,
		'console:directory-connector:execute','directory_user', ?, ?, 'v1', CAST(? AS JSON), ?,
		'pending', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
		operationID, operationKey, a.tenant, deployment, operationCode, sourceBizCode,
		operationKey, string(commandJSON), fmt.Sprintf("%x", commandDigest), actorUID); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": operationID, "operationCode": operationCode,
		"status": "pending", "uid": sourceBizCode,
	}, nil
}

func (a *Adapter) consoleLDAPState(
	ctx context.Context,
	runner sqlRunner,
	deployment string,
	lock bool,
) (consoleLDAPSourceState, error) {
	var state consoleLDAPSourceState
	var configJSON []byte
	query := `SELECT status,config_json FROM integrations
		WHERE integration_code='directory.ldap' LIMIT 1`
	if lock {
		query += " FOR UPDATE"
	}
	err := runner.QueryRowContext(ctx, query).Scan(&state.Status, &configJSON)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	if err == nil && len(configJSON) > 0 {
		if jsonErr := json.Unmarshal(configJSON, &state.Config); jsonErr != nil {
			return state, httperror.New(http.StatusConflict, "directory_ldap_config_invalid", "LDAP source configuration is invalid")
		}
	}
	if state.Config == nil {
		state.Config = map[string]any{}
	}
	connectorQuery := `SELECT connector_id,public_key_pem,status FROM directory_connectors
		WHERE tenant_code=? AND deployment_code=? AND status='active'
		ORDER BY updated_at DESC LIMIT 1`
	if lock {
		connectorQuery += " FOR UPDATE"
	}
	connectorErr := runner.QueryRowContext(ctx, connectorQuery, a.tenant, deployment).
		Scan(&state.ConnectorID, &state.PublicKeyPEM, &state.ConnectorStatus)
	if connectorErr != nil && !errors.Is(connectorErr, sql.ErrNoRows) {
		return state, connectorErr
	}
	return state, nil
}

func requireManagedConsoleLDAP(state consoleLDAPSourceState) error {
	if state.Status != "active" || text(state.Config["managementMode"]) != "managed" {
		return httperror.New(http.StatusConflict, "directory_ldap_not_managed", "LDAP directory source is not enabled in managed mode")
	}
	if state.ConnectorStatus != "active" || state.ConnectorID == "" {
		return httperror.New(http.StatusServiceUnavailable, "directory_connector_not_ready", "LDAP Directory Connector is not registered or active")
	}
	return nil
}

// consoleLDAPPassword 解析初始密码，并返回该密码是否由 Console 生成。
//
// 调用方不再必须提供密码：People 受控入职要求 People 的数据库、operation
// command 和日志都不得经手明文初始密码，因此缺省时由 Console 就地生成一个
// 符合策略的随机密码，只在内存中用 Connector 公钥加密。
func consoleLDAPPassword(value any, uid string) (string, bool, error) {
	if value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" || fmt.Sprint(value) == "<nil>" {
		password, err := generateConsoleLDAPPassword(uid)
		if err != nil {
			return "", false, err
		}
		return password, true, nil
	}
	password := fmt.Sprint(value)
	if len(password) < 10 || len(password) > 128 {
		return "", false, httperror.New(http.StatusBadRequest, "directory_password_invalid", "Password must contain 10 to 128 characters")
	}
	if uid != "" && strings.Contains(strings.ToLower(password), strings.ToLower(uid)) {
		return "", false, httperror.New(http.StatusBadRequest, "directory_password_contains_uid", "Password must not contain the user id")
	}
	return password, false, nil
}

// 生成用的字符集刻意排除 O/0/l/1/I 等易混字符：初始密码需要人工转交，
// 转录错误会直接变成一次无法登录的入职失败。
const (
	consoleLDAPPasswordUpper  = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	consoleLDAPPasswordLower  = "abcdefghijkmnpqrstuvwxyz"
	consoleLDAPPasswordDigit  = "23456789"
	consoleLDAPPasswordSymbol = "!@#$%^&*-_=+?"
	consoleLDAPPasswordLength = 20
)

// generateConsoleLDAPPassword 生成四类字符齐备的随机密码，满足常见 AD/LDAP
// 复杂度策略，并保证不包含 uid。
func generateConsoleLDAPPassword(uid string) (string, error) {
	classes := []string{
		consoleLDAPPasswordUpper,
		consoleLDAPPasswordLower,
		consoleLDAPPasswordDigit,
		consoleLDAPPasswordSymbol,
	}
	all := consoleLDAPPasswordUpper + consoleLDAPPasswordLower + consoleLDAPPasswordDigit + consoleLDAPPasswordSymbol

	// uid 出现在随机串里的概率极低，但一旦出现就会被下游策略拒绝，
	// 因此重试而不是返回一个注定失败的密码。
	for attempt := 0; attempt < 8; attempt++ {
		password := make([]byte, 0, consoleLDAPPasswordLength)
		for _, class := range classes {
			character, err := randomConsoleCharacter(class)
			if err != nil {
				return "", err
			}
			password = append(password, character)
		}
		for len(password) < consoleLDAPPasswordLength {
			character, err := randomConsoleCharacter(all)
			if err != nil {
				return "", err
			}
			password = append(password, character)
		}
		if err := shuffleConsolePassword(password); err != nil {
			return "", err
		}
		candidate := string(password)
		if uid == "" || !strings.Contains(strings.ToLower(candidate), strings.ToLower(uid)) {
			return candidate, nil
		}
	}
	return "", httperror.New(http.StatusInternalServerError, "directory_password_generation_failed", "Failed to generate an initial password")
}

func randomConsoleCharacter(charset string) (byte, error) {
	index, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
	if err != nil {
		return 0, err
	}
	return charset[index.Int64()], nil
}

// shuffleConsolePassword 用 Fisher-Yates 打乱，避免四类字符固定落在前四位。
func shuffleConsolePassword(password []byte) error {
	for i := len(password) - 1; i > 0; i-- {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return err
		}
		j := index.Int64()
		password[i], password[j] = password[j], password[i]
	}
	return nil
}

func encryptConsoleConnectorSecret(publicKeyPEM string, value string) (string, error) {
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

func isTrueConsoleFlag(value any) bool {
	if value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	default:
		return strings.EqualFold(strings.TrimSpace(fmt.Sprint(value)), "true")
	}
}

func cloneWithoutConsoleSecrets(body map[string]any, fields ...string) map[string]any {
	excluded := map[string]bool{}
	for _, field := range fields {
		excluded[field] = true
	}
	result := make(map[string]any, len(body))
	for key, value := range body {
		if !excluded[key] {
			result[key] = value
		}
	}
	return result
}

func nullableSQLString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
