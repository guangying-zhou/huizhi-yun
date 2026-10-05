package directory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type operationRow struct {
	OperationID      string
	OperationCode    string
	SourceBizCode    string
	CommandJSON      []byte
	CommandSHA256    string
	Status           string
	AttemptCount     uint64
	FencingToken     uint64
	OriginalActorUID sql.NullString
}

func (a *Adapter) Lease(ctx context.Context, identity ConnectorIdentity) (map[string]any, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_connectors
		WHERE connector_id=? AND tenant_code=? AND deployment_code=? AND status='active' FOR UPDATE`,
		identity.ConnectorID, identity.TenantCode, identity.DeploymentCode).Scan(&active); err != nil {
		return nil, err
	}
	if active != 1 {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_not_registered", "Directory Connector is not registered")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_connectors
		SET last_seen_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE connector_id=?`, identity.ConnectorID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE integration_operation
		SET status=IF(attempt_count>=8,'dead_letter','retry_wait'),next_attempt_at=UTC_TIMESTAMP(3),locked_until=NULL,updated_at=UTC_TIMESTAMP(3)
		WHERE target_app='directory-connector' AND tenant_code=? AND deployment_code=?
		AND status='processing' AND locked_until<UTC_TIMESTAMP(3)`, identity.TenantCode, identity.DeploymentCode); err != nil {
		return nil, err
	}

	var row operationRow
	err = tx.QueryRowContext(ctx, `SELECT operation_id,operation_code,source_biz_code,command_json,command_sha256,
		status,attempt_count,fencing_token,original_actor_uid
		FROM integration_operation
		WHERE target_app='directory-connector' AND tenant_code=? AND deployment_code=?
		AND attempt_count<8 AND status IN ('pending','retry_wait','partial_unknown')
		AND next_attempt_at<=UTC_TIMESTAMP(3)
		ORDER BY created_at,operation_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
		identity.TenantCode, identity.DeploymentCode).
		Scan(&row.OperationID, &row.OperationCode, &row.SourceBizCode, &row.CommandJSON, &row.CommandSHA256,
			&row.Status, &row.AttemptCount, &row.FencingToken, &row.OriginalActorUID)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fencingToken := row.FencingToken + 1
	attemptNo := row.AttemptCount + 1
	if _, err := tx.ExecContext(ctx, `UPDATE integration_operation
		SET status='processing',attempt_count=?,fencing_token=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),
		service_client_id=?,updated_at=UTC_TIMESTAMP(3) WHERE operation_id=?`,
		attemptNo, fencingToken, identity.ConnectorID, row.OperationID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO integration_operation_attempt
		(attempt_id,operation_id,attempt_no,fencing_token,result_status,started_at,created_at)
		VALUES (?,?,?,?, 'processing',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		uuid.NewString(), row.OperationID, attemptNo, fencingToken); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	command := map[string]any{}
	if err := json.Unmarshal(row.CommandJSON, &command); err != nil {
		return nil, httperror.New(http.StatusConflict, "directory_connector_command_invalid", "Stored Directory Connector command is invalid")
	}
	return map[string]any{
		"operationId": row.OperationID, "operationCode": row.OperationCode,
		"commandSchemaVersion": "v1", "commandSha256": row.CommandSHA256,
		"fencingToken": fencingToken, "command": command,
	}, nil
}

func (a *Adapter) Complete(ctx context.Context, identity ConnectorIdentity, operationID string, body map[string]any) (map[string]any, error) {
	fencingToken := uint64(number(body["fencingToken"]))
	success := text(body["status"]) == "succeeded"
	result := object(body["result"])

	var current operationRow
	err := a.db.QueryRowContext(ctx, `SELECT operation_id,operation_code,source_biz_code,command_json,command_sha256,
		status,attempt_count,fencing_token,original_actor_uid
		FROM integration_operation WHERE operation_id=? AND target_app='directory-connector'
		AND tenant_code=? AND deployment_code=? LIMIT 1`,
		operationID, identity.TenantCode, identity.DeploymentCode).
		Scan(&current.OperationID, &current.OperationCode, &current.SourceBizCode, &current.CommandJSON, &current.CommandSHA256,
			&current.Status, &current.AttemptCount, &current.FencingToken, &current.OriginalActorUID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_connector_operation_not_found", "Directory Connector operation was not found")
	}
	if err != nil {
		return nil, err
	}
	if current.Status == "succeeded" {
		return map[string]any{"operationId": operationID, "status": "succeeded", "idempotent": true}, nil
	}
	if current.Status != "processing" || current.FencingToken != fencingToken {
		return nil, httperror.New(http.StatusConflict, "directory_connector_lease_fenced", "Directory Connector lease is stale")
	}

	if success && current.OperationCode == "console.directory-connector.create-user.v1" {
		user := object(result["user"])
		requested := map[string]any{}
		_ = json.Unmarshal(current.CommandJSON, &requested)
		if _, err := a.applyUser(ctx, user, requested); err != nil {
			return nil, err
		}
		if err := a.rebuildUserSubjectExports(ctx); err != nil {
			return nil, err
		}
	}

	finalStatus := "dead_letter"
	if success {
		finalStatus = "succeeded"
	} else if current.OperationCode != "console.directory-connector.test-connection.v1" && boolDefault(body["retryable"], true) && current.AttemptCount < 8 {
		finalStatus = "retry_wait"
	}
	errorCode := safeText(body["errorCode"], 100)
	errorMessage := safeText(body["errorMessage"], 500)
	responseDigest := ""
	if success {
		encoded, _ := json.Marshal(result)
		responseDigest = sha256Hex(encoded)
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	update, err := tx.ExecContext(ctx, `UPDATE integration_operation SET status=?,
		next_attempt_at=CASE WHEN ?='retry_wait' THEN DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND) ELSE next_attempt_at END,
		locked_until=NULL,target_biz_type=CASE WHEN ?='succeeded' THEN 'directory_user' ELSE target_biz_type END,
		target_biz_code=CASE WHEN ?='succeeded' THEN source_biz_code ELSE target_biz_code END,
		response_summary_sha256=CASE WHEN ?='succeeded' THEN ? ELSE response_summary_sha256 END,
		last_error_code=?,last_error_class=CASE WHEN ?='succeeded' THEN NULL ELSE ? END,
		last_error_summary=?,succeeded_at=CASE WHEN ?='succeeded' THEN UTC_TIMESTAMP(3) ELSE succeeded_at END,
		updated_at=UTC_TIMESTAMP(3)
		WHERE operation_id=? AND status='processing' AND fencing_token=? AND service_client_id=?`,
		finalStatus, finalStatus, finalStatus, finalStatus, finalStatus, nullable(responseDigest), nullable(errorCode), finalStatus,
		func() string {
			if boolDefault(body["retryable"], true) {
				return "transient"
			}
			return "permanent"
		}(),
		nullable(errorMessage), finalStatus, operationID, fencingToken, identity.ConnectorID)
	if err != nil {
		return nil, err
	}
	affected, _ := update.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "directory_connector_lease_fenced", "Directory Connector lease is stale")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE integration_operation_attempt SET result_status=?,error_code=?,finished_at=UTC_TIMESTAMP(3)
		WHERE operation_id=? AND fencing_token=? AND result_status='processing'`, finalStatus, nullable(errorCode), operationID, fencingToken); err != nil {
		return nil, err
	}
	if current.OperationCode == "console.directory-connector.test-connection.v1" {
		status := "failed"
		if success {
			status = "healthy"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE integrations SET connectivity_status=?,last_checked_at=UTC_TIMESTAMP(),
			last_error_message=?,updated_at=UTC_TIMESTAMP() WHERE integration_code='directory.ldap'`, status, nullable(errorMessage)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "status": finalStatus, "affectedRows": affected}, nil
}

func safeText(value any, limit int) string {
	valueText := strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(text(value))
	if len(valueText) > limit {
		valueText = valueText[:limit]
	}
	return valueText
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
