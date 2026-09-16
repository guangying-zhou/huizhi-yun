package directory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	consoleEmploymentOperation           = "people.directory.employment-sync.v1"
	consoleEmploymentCapability          = "console:directory-employment:sync"
	consoleEmploymentPlatformOperation   = "console.platform.employment-sync.v1"
	consoleEmploymentPlatformCapability  = "platform:employment-authorization:sync"
	consoleOffboardingOperation          = "people.directory.offboarding-disable.v1"
	consoleOffboardingCapability         = "console:directory-offboarding:disable"
	consoleOffboardingPlatformOperation  = "console.platform.offboarding-revoke.v1"
	consoleOffboardingPlatformCapability = "platform:offboarding-authorization:revoke"
)

type ConsoleLifecycleKind string

const (
	ConsoleLifecycleEmployment  ConsoleLifecycleKind = "employment"
	ConsoleLifecycleOffboarding ConsoleLifecycleKind = "offboarding"
)

type consoleLifecycleContract struct {
	operationCode      string
	capability         string
	platformOperation  string
	platformCapability string
	auditAction        string
}

type consoleLifecycleWatermark struct {
	revision uint64
	hash     string
}

func (a *Adapter) ConsoleApplyPeopleLifecycle(
	ctx context.Context,
	uid string,
	kind ConsoleLifecycleKind,
	consoleDeployment string,
	body map[string]any,
) (map[string]any, error) {
	contract, err := consoleLifecycleContractFor(kind)
	if err != nil {
		return nil, err
	}
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"console",
		contract.operationCode,
		contract.capability,
	)
	if err != nil {
		return nil, consoleLifecycleReceiptError(err)
	}
	serviceContext, err := integrationoperation.TrustedServiceCommandContextFromMap(body)
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "service_command_context_invalid", "trusted People service command context is invalid")
	}
	if receiptInput.TrustedContext.SourceApp != "people" || serviceContext.SourceApp != "people" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be People")
	}
	if serviceContext.TargetApp != "console" || serviceContext.TargetDeploymentCode == "" {
		return nil, httperror.New(http.StatusForbidden, "service_command_target_forbidden", "service command target must be the enrolled Console deployment")
	}
	consoleDeployment = strings.TrimSpace(consoleDeployment)
	if consoleDeployment == "" {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_deployment_binding_unavailable", "Console application deployment binding is unavailable")
	}
	if a.tenant != "" && receiptInput.TrustedContext.TenantCode != a.tenant {
		return nil, httperror.New(http.StatusForbidden, "service_command_tenant_mismatch", "People lifecycle command tenant does not match this Runtime")
	}
	uid = strings.TrimSpace(uid)
	commandUID := text(command["employeeUid"])
	if uid == "" || len(uid) > 128 || uid != commandUID {
		return nil, httperror.New(http.StatusConflict, "service_command_path_mismatch", "route uid does not match the frozen People command")
	}
	revision, err := positiveConsoleLifecycleRevision(command["sourceRevision"])
	if err != nil {
		return nil, err
	}
	snapshotHash := text(command["snapshotHash"])
	if len(snapshotHash) != 64 || !isLowerHex(snapshotHash) {
		return nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "People lifecycle snapshot hash is invalid")
	}
	if declared := text(command["lifecycleType"]); declared != "" && declared != string(kind) {
		return nil, httperror.New(http.StatusConflict, "service_command_path_mismatch", "People lifecycle type does not match the target path")
	}
	receiptInput.OriginalActorUID = text(command["originalActorUid"])
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, applyErr := a.applyPeopleLifecycleTx(
			ctx,
			tx,
			uid,
			kind,
			contract,
			command,
			revision,
			snapshotHash,
			receiptInput,
			serviceContext,
			consoleDeployment,
		)
		if applyErr != nil {
			return integrationoperation.ReceiptBusinessResult{}, applyErr
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "directory_user",
			TargetBizCode: uid,
			HTTPStatus:    http.StatusOK,
			Value:         result,
		}, nil
	})
	if err != nil {
		return nil, consoleLifecycleReceiptError(err)
	}
	result, _ := executed.Value.(map[string]any)
	if result == nil {
		result, err = a.replayedPeopleLifecycleResult(ctx, uid, revision)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded",
		"operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode,
		"idempotencyKey":        receiptInput.IdempotencyKey,
		"commandSchemaVersion":  receiptInput.CommandSchemaVersion,
		"commandSha256":         receiptInput.CommandSHA256,
		"idempotent":            executed.Existing,
		"targetBizType":         executed.TargetBizType,
		"targetBizCode":         executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256,
		"result":                result,
	}, nil
}

func (a *Adapter) applyPeopleLifecycleTx(
	ctx context.Context,
	tx *sql.Tx,
	uid string,
	kind ConsoleLifecycleKind,
	contract consoleLifecycleContract,
	command map[string]any,
	revision uint64,
	snapshotHash string,
	receiptInput integrationoperation.ReceiptCommandInput,
	serviceContext integrationoperation.TrustedServiceCommandContext,
	consoleDeployment string,
) (map[string]any, error) {
	if _, err := tx.ExecContext(ctx, `INSERT IGNORE INTO directory_lifecycle_scope_versions
		(employee_uid,applied_revision,snapshot_hash,lifecycle_type)
		VALUES (?,0,REPEAT('0',64),'none')`, uid); err != nil {
		return nil, err
	}
	var watermark consoleLifecycleWatermark
	if err := tx.QueryRowContext(ctx, `SELECT applied_revision,snapshot_hash
		FROM directory_lifecycle_scope_versions WHERE employee_uid=? FOR UPDATE`, uid).
		Scan(&watermark.revision, &watermark.hash); err != nil {
		return nil, err
	}
	if revision < watermark.revision {
		return map[string]any{"staleSkipped": true, "appliedRevision": watermark.revision}, nil
	}
	if revision == watermark.revision {
		if snapshotHash != watermark.hash {
			return nil, httperror.New(http.StatusConflict, "lifecycle_source_version_hash_mismatch", "same lifecycle revision has a different hash")
		}
		return map[string]any{"idempotent": true, "appliedRevision": watermark.revision}, nil
	}
	if kind == ConsoleLifecycleEmployment {
		if err := applyConsoleEmploymentTx(ctx, tx, uid, command); err != nil {
			return nil, err
		}
	} else if err := applyConsoleOffboardingTx(ctx, tx, uid); err != nil {
		return nil, err
	}
	if err := upsertConsoleUserSubject(ctx, tx, uid); err != nil {
		return nil, err
	}
	platformCommand := map[string]any{
		"employeeUid": uid, "lifecycleType": string(kind),
		"sourceRevision": revision, "snapshotHash": snapshotHash,
		"positionCode":         text(command["positionCode"]),
		"positionName":         text(command["positionName"]),
		"deptCode":             text(command["deptCode"]),
		"effectiveDate":        text(command["effectiveDate"]),
		"originalActorUid":     text(command["originalActorUid"]),
		"sourceDeploymentCode": consoleDeployment,
	}
	platformHash, err := integrationoperation.ValidateAndDigestCommand(platformCommand)
	if err != nil {
		return nil, err
	}
	platformJSON, err := json.Marshal(platformCommand)
	if err != nil {
		return nil, err
	}
	platformKey := consoleLifecyclePlatformKey(uid, revision)
	platformOperationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO integration_operation
		(operation_id,operation_key,tenant_code,deployment_code,source_app,target_app,
		 operation_code,required_capability,source_biz_type,source_biz_code,
		 idempotency_key,command_schema_version,command_json,command_sha256,status,
		 next_attempt_at,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,
		 created_at,updated_at)
		VALUES (?,?,?,?, 'console','platform',?,?, 'directory_user',?,?,
		 'v1',CAST(? AS JSON),?,'pending',UTC_TIMESTAMP(3),?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		platformOperationID, platformKey, receiptInput.TrustedContext.TenantCode,
		serviceContext.TargetDeploymentCode, contract.platformOperation,
		contract.platformCapability, uid, platformKey, string(platformJSON), platformHash,
		nullableConsoleText(receiptInput.TrustedContext.RequestID),
		nullableConsoleText(receiptInput.OriginalActorUID),
		nullableConsoleText(receiptInput.TrustedContext.ServiceClientID),
		nullableConsoleText(receiptInput.TrustedContext.ServiceClientID),
		nullableConsoleText(receiptInput.TrustedContext.ServiceClientID)); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_lifecycle_scope_versions
		SET applied_revision=?,snapshot_hash=?,lifecycle_type=?,updated_at=UTC_TIMESTAMP(3)
		WHERE employee_uid=?`, revision, snapshotHash, string(kind), uid); err != nil {
		return nil, err
	}
	detail, err := json.Marshal(map[string]any{
		"source": "people", "sourceRevision": revision, "snapshotHash": snapshotHash,
		"platformOperationKey": platformKey, "receiptOperationId": receiptInput.OperationID,
	})
	if err != nil {
		return nil, err
	}
	actorID := receiptInput.OriginalActorUID
	actorType := "human"
	if actorID == "" {
		actorID = receiptInput.TrustedContext.ServiceClientID
		actorType = "service"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at)
		VALUES ('directory',?,'directory_user',?,?,?,?,CAST(? AS JSON),UTC_TIMESTAMP())`,
		contract.auditAction, uid, actorType, actorID,
		nullableConsoleText(receiptInput.TrustedContext.RequestID), string(detail)); err != nil {
		return nil, err
	}
	return map[string]any{
		"platformOperationKey": platformKey,
		"platformStatus":       "pending",
		"appliedRevision":      revision,
	}, nil
}

func applyConsoleEmploymentTx(ctx context.Context, tx *sql.Tx, uid string, command map[string]any) error {
	deptCode := text(command["deptCode"])
	emailState := consoleLifecycleFieldState(command["emailSourceState"], command["email"])
	mobileState := consoleLifecycleFieldState(command["mobileSourceState"], command["mobile"])
	identityProvider := strings.ToLower(text(command["identityProvider"]))
	identitySubject := text(command["identitySubject"])
	if identityProvider != "" && identityProvider != "dingtalk" {
		return httperror.New(http.StatusConflict, "directory_identity_provider_invalid", "People lifecycle identity provider is not allowed")
	}
	if identitySubject != "" && (identityProvider == "" || len(identitySubject) > 255 || strings.ContainsAny(identitySubject, "\r\n\x00")) {
		return httperror.New(http.StatusConflict, "directory_identity_subject_invalid", "People lifecycle identity subject is invalid")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO directory_users
		(uid,username,display_name,real_name,email,mobile,mobile_tail4,position_title,primary_dept_code,user_type,
		 source_provider,external_ref,synced_at,status,created_at,updated_at)
		VALUES (?,?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,NULLIF(?,''),'employee','people',?,UTC_TIMESTAMP(),'active',
		 UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE
		 username=COALESCE(NULLIF(VALUES(username),''),username),
		 display_name=COALESCE(NULLIF(VALUES(display_name),''),display_name),
		 real_name=COALESCE(NULLIF(VALUES(real_name),''),real_name),
		 email=CASE WHEN ?='absent' THEN email ELSE VALUES(email) END,
		 mobile=CASE WHEN ?='absent' THEN mobile ELSE VALUES(mobile) END,
		 mobile_tail4=CASE WHEN ?='absent' THEN mobile_tail4 ELSE VALUES(mobile_tail4) END,
		 position_title=COALESCE(NULLIF(VALUES(position_title),''),position_title),
		 primary_dept_code=NULLIF(VALUES(primary_dept_code),''),
		 source_provider='people',synced_at=UTC_TIMESTAMP(),status='active',
		 updated_at=UTC_TIMESTAMP()`,
		uid,
		nullableConsoleText(text(command["loginName"])),
		coalesceConsoleLifecycleName(command["displayName"], uid),
		coalesceConsoleLifecycleName(command["displayName"], uid),
		text(command["email"]),
		text(command["mobile"]),
		consoleMobileTail4(text(command["mobile"]), ""),
		nullableConsoleText(text(command["positionName"])),
		deptCode,
		uid,
		emailState,
		mobileState,
		mobileState); err != nil {
		return err
	}
	if identitySubject != "" {
		var mappedUID string
		err := tx.QueryRowContext(ctx, `SELECT uid FROM directory_identities
			WHERE provider_code=? AND provider_subject=? AND status<>'deleted'
			LIMIT 1 FOR UPDATE`, identityProvider, identitySubject).Scan(&mappedUID)
		if err == nil && mappedUID != uid {
			return httperror.New(http.StatusConflict, "directory_identity_already_mapped", "DingTalk identity is already mapped to another Directory user")
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO directory_identities
			(uid,provider_code,provider_subject,provider_username,email,mobile_tail4,last_synced_at,status,created_at,updated_at)
			VALUES (?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),UTC_TIMESTAMP(),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE provider_subject=VALUES(provider_subject),
				provider_username=COALESCE(NULLIF(VALUES(provider_username),''),provider_username),
				email=CASE WHEN ?='absent' THEN email ELSE VALUES(email) END,
				mobile_tail4=CASE WHEN ?='absent' THEN mobile_tail4 ELSE VALUES(mobile_tail4) END,
				last_synced_at=UTC_TIMESTAMP(),status='active',updated_at=UTC_TIMESTAMP()`,
			uid, identityProvider, identitySubject, text(command["loginName"]),
			text(command["email"]), consoleMobileTail4(text(command["mobile"]), ""),
			emailState, mobileState); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE directory_departments departments
			INNER JOIN directory_department_identities identities
				ON identities.dept_code=departments.dept_code
			SET departments.manager_uid=?,departments.updated_at=UTC_TIMESTAMP()
			WHERE identities.provider_code='dingtalk'
				AND identities.manager_external_subject=?
				AND identities.status='active' AND departments.status<>'deleted'`, uid, identitySubject); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_user_departments memberships
		INNER JOIN directory_departments departments ON departments.dept_code=memberships.dept_code
		SET memberships.is_primary=0,memberships.status='inactive',
			memberships.left_at=COALESCE(memberships.left_at,UTC_TIMESTAMP()),memberships.updated_at=UTC_TIMESTAMP()
		WHERE memberships.uid=? AND memberships.relation_type='member'
			AND departments.org_type='department'
			AND (memberships.source_provider='people' OR memberships.is_primary=1)
			AND (?='' OR memberships.dept_code<>?)`, uid, deptCode, deptCode); err != nil {
		return err
	}
	if deptCode == "" {
		return nil
	}
	if err := assertConsoleDepartmentTx(ctx, tx, deptCode); err != nil {
		return err
	}
	var targetStatus, targetOrgType string
	if err := tx.QueryRowContext(ctx, `SELECT status,org_type FROM directory_departments
		WHERE dept_code=? LIMIT 1 FOR UPDATE`, deptCode).Scan(&targetStatus, &targetOrgType); err != nil {
		return err
	}
	if targetStatus != "active" || targetOrgType != "department" {
		return httperror.New(http.StatusConflict, "directory_formal_department_required", "DingTalk primary department must resolve to an active formal department")
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO directory_user_departments
		(uid,dept_code,relation_type,is_primary,source_provider,external_ref,status,created_at,updated_at)
		VALUES (?,?,'member',1,'people',?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE is_primary=1,status='active',left_at=NULL,
		 source_provider='people',updated_at=UTC_TIMESTAMP()`,
		uid, deptCode, uid+":"+deptCode+":member")
	return err
}

func consoleLifecycleFieldState(rawState any, value any) string {
	state := strings.ToLower(strings.TrimSpace(text(rawState)))
	switch state {
	case "provided", "empty", "absent":
		return state
	default:
		// Backward-compatible commands did not carry presence metadata. A
		// non-empty value remains authoritative; an empty value must not erase
		// an existing Directory fact unless the source explicitly says empty.
		if strings.TrimSpace(text(value)) != "" {
			return "provided"
		}
		return "absent"
	}
}

func applyConsoleOffboardingTx(ctx context.Context, tx *sql.Tx, uid string) error {
	result, err := tx.ExecContext(ctx, `UPDATE directory_users
		SET status='inactive',source_provider='people',synced_at=UTC_TIMESTAMP(),
		 updated_at=UTC_TIMESTAMP() WHERE uid=?`, uid)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return httperror.New(http.StatusNotFound, "directory_user_not_found", "Directory user was not found")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_identities SET status='inactive',
		last_synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status='active'`, uid); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_refresh_tokens rt
		INNER JOIN local_sessions ls ON ls.id=rt.session_id
		SET rt.status='revoked',rt.revoked_at=COALESCE(rt.revoked_at,UTC_TIMESTAMP())
		WHERE ls.uid=? AND rt.status IN ('active','rotated')`, uid); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE local_sessions
		SET status='revoked',revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()),
		 updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status='active'`, uid)
	return err
}

// ConsoleReadEmploymentLifecycleStatus 只读地报告某员工的目录生命周期与其
// 下一跳 Platform 授权操作的状态。
//
// People 需要它来判定入职单能否收口：Platform 操作归 Console 所有，People
// 不得直接访问 Platform。返回稳定状态串与 revision，不返回命令、receipt 或
// 任何目录内部字段。
func (a *Adapter) ConsoleReadEmploymentLifecycleStatus(ctx context.Context, uid string) (map[string]any, error) {
	normalized := strings.TrimSpace(uid)
	if normalized == "" {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_required", "uid is required")
	}
	result := map[string]any{"uid": normalized, "directoryApplied": false, "platformStatus": ""}

	var appliedRevision uint64
	err := a.db.QueryRowContext(ctx, `SELECT applied_revision
		FROM directory_lifecycle_scope_versions WHERE employee_uid=?`, normalized).Scan(&appliedRevision)
	if err == nil {
		result["directoryApplied"] = appliedRevision > 0
		result["appliedRevision"] = appliedRevision
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// 取该员工最近一次 employment 下一跳的状态。offboarding 走另一条 operation
	// code，不参与入职收口判定。
	var status string
	err = a.db.QueryRowContext(ctx, `SELECT status FROM integration_operation
		WHERE tenant_code=? AND source_app='console' AND target_app='platform'
		  AND operation_code=? AND source_biz_code=?
		ORDER BY created_at DESC LIMIT 1`,
		a.tenant, consoleEmploymentPlatformOperation, normalized).Scan(&status)
	if err == nil {
		result["platformStatus"] = status
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) replayedPeopleLifecycleResult(
	ctx context.Context,
	uid string,
	revision uint64,
) (map[string]any, error) {
	result := map[string]any{}
	var applied uint64
	if err := a.db.QueryRowContext(ctx, `SELECT applied_revision
		FROM directory_lifecycle_scope_versions WHERE employee_uid=?`, uid).Scan(&applied); err == nil {
		result["appliedRevision"] = applied
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	platformKey := consoleLifecyclePlatformKey(uid, revision)
	var status string
	err := a.db.QueryRowContext(ctx, `SELECT status FROM integration_operation
		WHERE tenant_code=? AND source_app='console' AND operation_key=? LIMIT 1`,
		a.tenant, platformKey).Scan(&status)
	if err == nil {
		result["platformOperationKey"] = platformKey
		result["platformStatus"] = status
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return result, nil
}

func consoleLifecycleContractFor(kind ConsoleLifecycleKind) (consoleLifecycleContract, error) {
	switch kind {
	case ConsoleLifecycleEmployment:
		return consoleLifecycleContract{
			operationCode: consoleEmploymentOperation, capability: consoleEmploymentCapability,
			platformOperation:  consoleEmploymentPlatformOperation,
			platformCapability: consoleEmploymentPlatformCapability,
			auditAction:        "directory.user.employment.from_people",
		}, nil
	case ConsoleLifecycleOffboarding:
		return consoleLifecycleContract{
			operationCode: consoleOffboardingOperation, capability: consoleOffboardingCapability,
			platformOperation:  consoleOffboardingPlatformOperation,
			platformCapability: consoleOffboardingPlatformCapability,
			auditAction:        "directory.user.disable.from_people",
		}, nil
	default:
		return consoleLifecycleContract{}, httperror.New(http.StatusBadRequest, "directory_lifecycle_kind_invalid", "Directory lifecycle kind is invalid")
	}
}

func positiveConsoleLifecycleRevision(value any) (uint64, error) {
	var revision uint64
	switch typed := value.(type) {
	case float64:
		if typed > 0 && typed == float64(uint64(typed)) {
			revision = uint64(typed)
		}
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil && parsed > 0 {
			revision = uint64(parsed)
		}
	default:
		_, _ = fmt.Sscan(strings.TrimSpace(fmt.Sprint(value)), &revision)
	}
	if revision == 0 {
		return 0, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "People lifecycle source revision is invalid")
	}
	return revision, nil
}

func isLowerHex(value string) bool {
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func coalesceConsoleLifecycleName(value any, fallback string) string {
	if normalized := text(value); normalized != "" {
		return normalized
	}
	return fallback
}

func consoleLifecyclePlatformKey(uid string, revision uint64) string {
	digest := sha256.Sum256([]byte(uid))
	return fmt.Sprintf("console:platform-lifecycle:%s:r%d", hex.EncodeToString(digest[:16]), revision)
}

func consoleLifecycleReceiptError(err error) error {
	switch {
	case errors.Is(err, integrationoperation.ErrInvalidOperationID):
		return httperror.New(http.StatusBadRequest, "service_command_operation_id_invalid", "Service command operationId must be a lowercase UUIDv4")
	case errors.Is(err, integrationoperation.ErrInvalidIdentity):
		return httperror.New(http.StatusForbidden, "service_command_identity_invalid", "Service command identity is invalid")
	case errors.Is(err, integrationoperation.ErrUnsafePersistenceContent):
		return httperror.New(http.StatusUnprocessableEntity, "service_command_payload_unsafe", "Service command contains content that cannot be persisted safely")
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Service command identity or payload does not match the receipt")
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return httperror.New(http.StatusConflict, "service_command_in_progress", "Service command is already processing")
	case errors.Is(err, integrationoperation.ErrReceiptRejected):
		return httperror.New(http.StatusConflict, "service_command_rejected", "Service command receipt was rejected")
	default:
		return err
	}
}
