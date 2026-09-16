package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	milestoneReceivableOperationCode      = "aims.milestone.receivable-billable.v1"
	milestoneReceivableRequiredCapability = "altoc:receivable:mark-billable"
)

func (a *Adapter) enqueueMilestoneReceivableBillableOperationTx(
	ctx context.Context,
	tx *sql.Tx,
	milestoneID int64,
	paymentTermID sql.NullInt64,
	projectCode sql.NullString,
	contractCode sql.NullString,
	body map[string]any,
) (map[string]any, error) {
	// The target is derived only from the milestone row locked by the source
	// transaction. Browser fields must never choose an Altoc receivable target.
	if !paymentTermID.Valid {
		return map[string]any{"linked": false}, nil
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, err
	}
	project := strings.TrimSpace(projectCode.String)
	operationKey := fmt.Sprintf("aims:milestone:%s:%d:accepted:v1", project, milestoneID)
	if project == "" {
		operationKey = fmt.Sprintf("aims:milestone:%d:accepted:v1", milestoneID)
	}
	sourceBizCode := fmt.Sprintf("%s:%d", project, milestoneID)
	if project == "" {
		sourceBizCode = fmt.Sprint(milestoneID)
	}

	var existingStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT status
		FROM integration_operation
		WHERE operation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'aims'
		  AND target_app = 'altoc'
		  AND operation_code = 'aims.milestone.receivable-billable.v1'
		  AND source_biz_type = 'milestone'
		  AND source_biz_code = ?
		  AND idempotency_key = ?
		LIMIT 1
		FOR UPDATE
	`, operationKey, trusted.TenantCode, trusted.DeploymentCode, sourceBizCode, operationKey).Scan(&existingStatus)
	if err == nil {
		return milestoneReceivableOperationMetadata(operationKey, existingStatus), nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	command := map[string]any{
		"milestoneId":    milestoneID,
		"projectCode":    nullableText(project),
		"contractCode":   nullableText(strings.TrimSpace(contractCode.String)),
		"idempotencyKey": operationKey,
		"operatorUid":    nullableText(strings.TrimSpace(firstBodyText(body, "current_user"))),
	}
	command["paymentTermId"] = paymentTermID.Int64
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	identity := integrationoperation.Identity{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode,
		SourceApp: "aims", TargetApp: "altoc", OperationCode: milestoneReceivableOperationCode,
		SourceBizType: "milestone", SourceBizCode: sourceBizCode,
		IdempotencyKey: operationKey, CommandSHA256: commandSHA256,
	}
	if err := identity.Validate(); err != nil {
		return nil, err
	}
	actorUID := strings.TrimSpace(firstBodyText(body, "current_user"))
	createdBy := actorUID
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO integration_operation (
		  operation_id, operation_key, correlation_key, sequence_no, depends_on_operation_key,
		  tenant_code, deployment_code, source_app, target_app, operation_code,
		  required_capability, source_biz_type, source_biz_code, idempotency_key,
		  command_schema_version, command_json, command_sha256, status,
		  original_request_id, original_actor_uid, service_client_id, created_by, updated_by,
		  next_attempt_at
		) VALUES (?, ?, ?, 1, NULL, ?, ?, 'aims', 'altoc', ?, ?, 'milestone', ?, ?, 'v1', ?, ?, 'pending', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
	`, operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
		milestoneReceivableOperationCode, milestoneReceivableRequiredCapability,
		sourceBizCode, operationKey, string(commandJSON), commandSHA256,
		nullableText(trusted.RequestID), nullableText(actorUID), nullableText(trusted.ServiceClientID),
		nullableText(createdBy), nullableText(createdBy)); err != nil {
		return nil, err
	}
	return milestoneReceivableOperationMetadata(operationKey, string(integrationoperation.StatusPending)), nil
}

func milestoneReceivableOperationMetadata(operationKey, status string) map[string]any {
	return map[string]any{"linked": true, "operationKey": operationKey, "operationStatus": status}
}
