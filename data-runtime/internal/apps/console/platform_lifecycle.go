package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	platformEmploymentSyncCode = "console.platform.employment-sync.v1"
	platformOffboardingCode    = "console.platform.offboarding-revoke.v1"
)

var lifecycleOperationIDPattern = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

type PlatformLifecycleClaim struct {
	OperationID          string         `json:"operationId"`
	OperationKey         string         `json:"operationKey"`
	TenantCode           string         `json:"tenantCode"`
	DeploymentCode       string         `json:"deploymentCode"`
	OperationCode        string         `json:"operationCode"`
	RequiredCapability   string         `json:"requiredCapability"`
	IdempotencyKey       string         `json:"idempotencyKey"`
	CommandSchemaVersion string         `json:"commandSchemaVersion"`
	Command              map[string]any `json:"command"`
	CommandSHA256        string         `json:"commandSha256"`
	FencingToken         uint64         `json:"fencingToken"`
	AttemptCount         uint64         `json:"attemptCount"`
}

func (a *Adapter) ClaimPlatformLifecycleOperation(
	ctx context.Context,
	tenant string,
	deployment string,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		UPDATE integration_operation_attempt attempt
		INNER JOIN integration_operation operation ON operation.operation_id=attempt.operation_id
		SET attempt.result_status='dead_letter',attempt.error_code='max_attempts_exhausted',
			attempt.finished_at=UTC_TIMESTAMP(3)
		WHERE operation.tenant_code=? AND operation.deployment_code=?
			AND operation.source_app='console' AND operation.target_app='platform'
			AND operation.attempt_count>=8 AND operation.status='processing'
			AND operation.locked_until<UTC_TIMESTAMP(3)
			AND attempt.result_status='processing'
			AND attempt.fencing_token=operation.fencing_token`, tenant, deployment)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE integration_operation
		SET status='dead_letter',locked_until=NULL,updated_at=UTC_TIMESTAMP(3)
		WHERE tenant_code=? AND deployment_code=?
			AND source_app='console' AND target_app='platform'
			AND attempt_count>=8 AND status IN ('processing','retry_wait','partial_unknown')
			AND (locked_until IS NULL OR locked_until<UTC_TIMESTAMP(3))`, tenant, deployment)
	if err != nil {
		return nil, err
	}
	var claim PlatformLifecycleClaim
	var rawCommand []byte
	var currentFencing uint64
	err = tx.QueryRowContext(ctx, `
		SELECT operation_id,operation_key,tenant_code,deployment_code,operation_code,
			required_capability,idempotency_key,command_schema_version,CAST(command_json AS CHAR),
			command_sha256,fencing_token,attempt_count
		FROM integration_operation
		WHERE tenant_code=? AND deployment_code=?
			AND source_app='console' AND target_app='platform'
			AND operation_code IN (?,?) AND attempt_count<8
			AND ((status IN ('pending','retry_wait','partial_unknown') AND next_attempt_at<=UTC_TIMESTAMP(3))
				OR (status='processing' AND locked_until<UTC_TIMESTAMP(3)))
		ORDER BY created_at,operation_id
		LIMIT 1 FOR UPDATE SKIP LOCKED`,
		tenant, deployment, platformEmploymentSyncCode, platformOffboardingCode,
	).Scan(
		&claim.OperationID, &claim.OperationKey, &claim.TenantCode, &claim.DeploymentCode,
		&claim.OperationCode, &claim.RequiredCapability, &claim.IdempotencyKey,
		&claim.CommandSchemaVersion, &rawCommand, &claim.CommandSHA256,
		&currentFencing, &claim.AttemptCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"code": 0, "message": "success", "data": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(rawCommand, &claim.Command); err != nil {
		return nil, httperror.New(http.StatusConflict, "platform_lifecycle_command_invalid", "stored platform lifecycle command is invalid")
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE integration_operation_attempt
		SET result_status='partial_unknown',error_code='lease_expired',finished_at=UTC_TIMESTAMP(3)
		WHERE operation_id=? AND fencing_token=? AND result_status='processing'`,
		claim.OperationID, currentFencing)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE integration_operation
		SET status='processing',attempt_count=attempt_count+1,fencing_token=fencing_token+1,
			locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),updated_at=UTC_TIMESTAMP(3)
		WHERE operation_id=? AND tenant_code=? AND deployment_code=?`,
		claim.OperationID, tenant, deployment)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "platform_lifecycle_claim_conflict", "platform lifecycle claim is stale")
	}
	claim.FencingToken = currentFencing + 1
	claim.AttemptCount++
	_, err = tx.ExecContext(ctx, `
		INSERT INTO integration_operation_attempt
			(attempt_id,operation_id,attempt_no,fencing_token,result_status,started_at,created_at)
		VALUES (UUID(),?,?,?,'processing',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		claim.OperationID, claim.AttemptCount, claim.FencingToken)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": claim}, nil
}

func (a *Adapter) CheckpointPlatformLifecycleOperation(
	ctx context.Context,
	tenant string,
	deployment string,
	body map[string]any,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	operationID := strings.TrimSpace(stringField(body["operationId"]))
	if !lifecycleOperationIDPattern.MatchString(operationID) {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_operation_id_invalid", "operationId is invalid")
	}
	fencingToken := uint64(numberField(body["fencingToken"]))
	if fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_fencing_token_invalid", "fencingToken is invalid")
	}
	outcome := strings.TrimSpace(stringField(body["outcome"]))
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var result sql.Result
	var attemptStatus, errorCode string
	if outcome == "succeeded" {
		receipt := objectField(body["receipt"])
		receiptID := limitedLifecycleValue(receipt["receiptId"], 191)
		targetBizType := limitedLifecycleValue(receipt["targetBizType"], 64)
		targetBizCode := limitedLifecycleValue(receipt["targetBizCode"], 191)
		responseHash := limitedLifecycleValue(receipt["responseSummarySha256"], 64)
		if receiptID == "" || targetBizType == "" || targetBizCode == "" || responseHash == "" {
			return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_receipt_invalid", "receipt is invalid")
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE integration_operation
			SET status='succeeded',target_receipt_id=?,target_biz_type=?,target_biz_code=?,
				response_summary_sha256=?,succeeded_at=UTC_TIMESTAMP(3),locked_until=NULL,updated_at=UTC_TIMESTAMP(3)
			WHERE tenant_code=? AND deployment_code=? AND operation_id=?
				AND status='processing' AND fencing_token=?`,
			receiptID, targetBizType, targetBizCode, responseHash,
			tenant, deployment, operationID, fencingToken)
		attemptStatus = "succeeded"
	} else if outcome == "failed" {
		failure := objectField(body["failure"])
		attemptStatus = strings.TrimSpace(stringField(failure["status"]))
		if attemptStatus != "retry_wait" && attemptStatus != "partial_unknown" && attemptStatus != "failed_permanent" {
			return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_failure_status_invalid", "failure status is invalid")
		}
		errorCode = limitedLifecycleValue(failure["code"], 128)
		errorClass := limitedLifecycleValue(failure["classification"], 64)
		summary := limitedLifecycleValue(failure["summary"], 1000)
		result, err = tx.ExecContext(ctx, `
			UPDATE integration_operation
			SET status=?,next_attempt_at=CASE WHEN ? IN ('retry_wait','partial_unknown')
					THEN DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND) ELSE next_attempt_at END,
				last_error_code=?,last_error_class=?,last_error_summary=?,
				locked_until=NULL,updated_at=UTC_TIMESTAMP(3)
			WHERE tenant_code=? AND deployment_code=? AND operation_id=?
				AND status='processing' AND fencing_token=?`,
			attemptStatus, attemptStatus, errorCode, errorClass, summary,
			tenant, deployment, operationID, fencingToken)
	} else {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_outcome_invalid", "outcome is invalid")
	}
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "platform_lifecycle_checkpoint_stale", "platform lifecycle checkpoint is stale")
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE integration_operation_attempt
		SET result_status=?,error_code=?,finished_at=UTC_TIMESTAMP(3)
		WHERE operation_id=? AND fencing_token=? AND result_status='processing'`,
		attemptStatus, nullableText(errorCode), operationID, fencingToken)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"operationId": operationID, "status": attemptStatus,
	}}, nil
}

func (a *Adapter) PlatformLifecycleOperations(
	ctx context.Context,
	tenant string,
	deployment string,
	query url.Values,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	args := []any{tenant, deployment, platformEmploymentSyncCode, platformOffboardingCode}
	statement := `
		SELECT operation_id,operation_code,source_biz_code,status,attempt_count,
			last_error_code,last_error_class,created_at,updated_at,succeeded_at
		FROM integration_operation
		WHERE tenant_code=? AND deployment_code=? AND source_app='console' AND target_app='platform'
			AND operation_code IN (?,?)`
	if uid := limitedLifecycleValue(query.Get("uid"), 128); uid != "" {
		statement += " AND source_biz_code=?"
		args = append(args, uid)
	}
	limit := positiveIntQuery(query.Get("limit"), 20)
	if limit > 100 {
		limit = 100
	}
	statement += " ORDER BY updated_at DESC,operation_id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := a.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var operationID, operationCode, uid, status string
		var attemptCount uint64
		var lastErrorCode, lastErrorClass sql.NullString
		var createdAt, updatedAt time.Time
		var succeededAt sql.NullTime
		if err := rows.Scan(&operationID, &operationCode, &uid, &status, &attemptCount,
			&lastErrorCode, &lastErrorClass, &createdAt, &updatedAt, &succeededAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"operationId": operationID, "operationCode": operationCode, "uid": uid,
			"status": status, "attemptCount": attemptCount,
			"lastErrorCode": nullableTextFromSQL(lastErrorCode), "lastErrorClass": nullableTextFromSQL(lastErrorClass),
			"createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano),
			"succeededAt": nullableAuditTime(succeededAt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{"items": items}}, nil
}

func (a *Adapter) PlatformLifecycleAttempts(
	ctx context.Context,
	tenant string,
	deployment string,
	operationID string,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	if !lifecycleOperationIDPattern.MatchString(operationID) {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_operation_id_invalid", "operationId is invalid")
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT attempt.operation_id,attempt.attempt_no,attempt.result_status,attempt.error_code,
			attempt.started_at,attempt.finished_at
		FROM integration_operation operation
		INNER JOIN integration_operation_attempt attempt ON attempt.operation_id=operation.operation_id
		WHERE operation.tenant_code=? AND operation.deployment_code=?
			AND operation.source_app='console' AND operation.target_app='platform'
			AND operation.operation_code IN (?,?) AND operation.operation_id=?
		ORDER BY attempt.attempt_no DESC`,
		tenant, deployment, platformEmploymentSyncCode, platformOffboardingCode, operationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, status string
		var attemptNo uint64
		var errorCode sql.NullString
		var startedAt time.Time
		var finishedAt sql.NullTime
		if err := rows.Scan(&id, &attemptNo, &status, &errorCode, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"operationId": id, "attemptNo": attemptNo, "status": status,
			"errorCode": nullableTextFromSQL(errorCode), "startedAt": startedAt.UTC().Format(time.RFC3339Nano),
			"finishedAt": nullableAuditTime(finishedAt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{"items": items}}, nil
}

func (a *Adapter) PlatformLifecycleRetrySource(
	ctx context.Context,
	tenant string,
	deployment string,
	uid string,
	phase string,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	uid = limitedLifecycleValue(uid, 128)
	operationCode, err := lifecycleOperationCodeForPhase(phase)
	if err != nil || uid == "" {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_retry_identity_invalid", "retry identity is invalid")
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT operation_id,tenant_code,deployment_code,operation_code,required_capability,
			idempotency_key,command_schema_version,CAST(command_json AS CHAR),command_sha256
		FROM integration_operation
		WHERE tenant_code=? AND deployment_code=? AND source_app='console' AND target_app='platform'
			AND status='dead_letter' AND operation_code=? AND source_biz_code=?
		ORDER BY updated_at DESC,operation_id DESC LIMIT 2`,
		tenant, deployment, operationCode, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type source struct {
		id                   string
		tenantCode           string
		deploymentCode       string
		operationCode        string
		requiredCapability   string
		idempotencyKey       string
		commandSchemaVersion string
		command              []byte
		commandSHA256        string
	}
	found := make([]source, 0, 2)
	for rows.Next() {
		var row source
		if err := rows.Scan(
			&row.id,
			&row.tenantCode,
			&row.deploymentCode,
			&row.operationCode,
			&row.requiredCapability,
			&row.idempotencyKey,
			&row.commandSchemaVersion,
			&row.command,
			&row.commandSHA256,
		); err != nil {
			return nil, err
		}
		found = append(found, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(found) != 1 {
		return map[string]any{"code": 0, "message": "success", "data": nil}, nil
	}
	command := map[string]any{}
	if json.Unmarshal(found[0].command, &command) != nil || strings.TrimSpace(stringField(command["employeeUid"])) != uid {
		return map[string]any{"code": 0, "message": "success", "data": nil}, nil
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"operationId":          found[0].id,
		"tenantCode":           found[0].tenantCode,
		"deploymentCode":       found[0].deploymentCode,
		"operationCode":        found[0].operationCode,
		"requiredCapability":   found[0].requiredCapability,
		"idempotencyKey":       found[0].idempotencyKey,
		"commandSchemaVersion": found[0].commandSchemaVersion,
		"command":              command,
		"commandSha256":        found[0].commandSHA256,
		"positionCode":         strings.TrimSpace(stringField(command["positionCode"])),
		"positionName":         strings.TrimSpace(stringField(command["positionName"])),
		"deptCode":             strings.TrimSpace(stringField(command["deptCode"])),
	}}, nil
}

func (a *Adapter) CancelPlatformLifecycleRetry(
	ctx context.Context,
	tenant string,
	deployment string,
	body map[string]any,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	uid := limitedLifecycleValue(body["uid"], 128)
	operationID := strings.TrimSpace(stringField(body["operationId"]))
	operationCode, phaseErr := lifecycleOperationCodeForPhase(stringField(body["phase"]))
	if uid == "" || !lifecycleOperationIDPattern.MatchString(operationID) || phaseErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_retry_identity_invalid", "retry identity is invalid")
	}
	result, err := a.db.ExecContext(ctx, `
		UPDATE integration_operation
		SET status='cancelled',locked_until=NULL,updated_at=UTC_TIMESTAMP(3)
		WHERE tenant_code=? AND deployment_code=? AND source_app='console' AND target_app='platform'
			AND status='dead_letter' AND operation_id=? AND operation_code=? AND source_biz_code=?`,
		tenant, deployment, operationID, operationCode, uid)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{"cancelled": affected}}, nil
}

func validLifecycleBinding(enrolledTenant string, tenant string, deployment string) (string, string, error) {
	tenant = strings.TrimSpace(tenant)
	deployment = strings.TrimSpace(deployment)
	if tenant == "" || deployment == "" || tenant != strings.TrimSpace(enrolledTenant) {
		return "", "", httperror.New(http.StatusForbidden, "platform_lifecycle_binding_invalid", "platform lifecycle binding is invalid")
	}
	return tenant, deployment, nil
}

func lifecycleOperationCodeForPhase(phase string) (string, error) {
	switch strings.TrimSpace(phase) {
	case "employment_authorization_sync":
		return platformEmploymentSyncCode, nil
	case "offboarding_authorization_reclaim":
		return platformOffboardingCode, nil
	default:
		return "", errors.New("invalid phase")
	}
}

func limitedLifecycleValue(value any, max int) string {
	text := strings.TrimSpace(stringField(value))
	if len(text) > max {
		return text[:max]
	}
	return text
}

func numberField(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	case json.Number:
		result, _ := typed.Int64()
		return result
	default:
		result, _ := strconv.ParseInt(strings.TrimSpace(stringField(value)), 10, 64)
		return result
	}
}

func objectField(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}
