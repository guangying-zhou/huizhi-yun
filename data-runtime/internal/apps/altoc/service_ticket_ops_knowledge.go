package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	opsKnowledgeCodocsOperationCode = "altoc.ops-knowledge.codocs-link.v1"
	opsKnowledgeAssetsOperationCode = "altoc.ops-knowledge.assets-link.v1"
)

type opsKnowledgeOperationSpec struct {
	suffix             string
	sequence           int
	dependsOnSuffix    string
	targetApp          string
	operationCode      string
	requiredCapability string
}

var opsKnowledgeOperationSpecs = []opsKnowledgeOperationSpec{
	{
		suffix:             ":codocs-link",
		sequence:           1,
		targetApp:          "codocs",
		operationCode:      opsKnowledgeCodocsOperationCode,
		requiredCapability: "codocs:documents:write",
	},
	{
		suffix:             ":assets-link",
		sequence:           2,
		dependsOnSuffix:    ":codocs-link",
		targetApp:          "assets",
		operationCode:      opsKnowledgeAssetsOperationCode,
		requiredCapability: "assets:write",
	},
}

func (a *Adapter) reserveServiceTicketOpsKnowledge(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	return a.mutateServiceTicketOpsKnowledge(ctx, ticketCode, body, false)
}

func (a *Adapter) completeServiceTicketOpsKnowledge(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	return a.mutateServiceTicketOpsKnowledge(ctx, ticketCode, body, true)
}

func (a *Adapter) ackServiceTicketOpsKnowledge(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	documentUUID := strings.TrimSpace(firstBodyText(body, "documentUuid", "document_uuid"))
	targetApp := strings.TrimSpace(firstBodyText(body, "targetApp", "target_app"))
	if ticketCode == "" || documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "ops_knowledge_ack_identity_required", "ticketCode and documentUuid are required")
	}
	if targetApp != "codocs" {
		return nil, httperror.New(http.StatusBadRequest, "ops_knowledge_ack_target_invalid", "only the Codocs step can be acknowledged separately")
	}
	if err := altocRequireActionScope(body, "service_ticket", "edit"); err != nil {
		return nil, err
	}
	trustedContext, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ticket, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_ticket
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if altocDataAccessMode(body) != "" {
		if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
			return nil, err
		}
	}
	existingUUID := strings.TrimSpace(altocMapText(ticket, "codocs_document_uuid"))
	pendingUUID := strings.TrimSpace(altocMapText(ticket, "ops_knowledge_pending_uuid"))
	if existingUUID != documentUUID && pendingUUID != documentUUID {
		return nil, httperror.New(http.StatusConflict, "ops_knowledge_reservation_mismatch", "ops knowledge acknowledgement does not match the reserved document")
	}

	correlationKey := serviceTicketOpsKnowledgeOperationKey(ticketCode, documentUUID)
	result, err := tx.ExecContext(ctx, `
		UPDATE integration_operation
		SET status = 'succeeded',
		    succeeded_at = CURRENT_TIMESTAMP(3),
		    locked_by = NULL,
		    locked_until = NULL,
		    last_error_code = NULL,
		    last_error_class = NULL,
		    last_error_summary = NULL,
		    last_error_at = NULL,
		    version_no = version_no + 1,
		    updated_by = ?
		WHERE operation_key = ?
		  AND correlation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'altoc'
		  AND target_app = 'codocs'
		  AND operation_code = 'altoc.ops-knowledge.codocs-link.v1'
		  AND status IN ('pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded')
	`, nullableText(altocActor(body)), correlationKey+":codocs-link", correlationKey, trustedContext.TenantCode, trustedContext.DeploymentCode)
	if err != nil {
		return nil, err
	}
	acknowledged, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if acknowledged != 1 {
		return nil, httperror.New(http.StatusConflict, "integration_operation_not_acknowledged", "Codocs integration operation was not found or cannot be acknowledged")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"ticketCode":   ticketCode,
		"documentUuid": documentUUID,
		"targetApp":    targetApp,
		"operationKey": correlationKey + ":codocs-link",
		"status":       "succeeded",
	}, nil
}

func (a *Adapter) mutateServiceTicketOpsKnowledge(ctx context.Context, ticketCode string, body map[string]any, complete bool) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	documentUUID := strings.TrimSpace(firstBodyText(body, "documentUuid", "document_uuid", "codocsDocumentUuid", "codocs_document_uuid"))
	if ticketCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_ticket_code", "ticketCode is required")
	}
	if documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "document_uuid_required", "documentUuid is required")
	}
	if err := altocRequireActionScope(body, "service_ticket", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	ticket, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_ticket
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if altocDataAccessMode(body) != "" {
		if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
			return nil, err
		}
	}

	existingUUID := strings.TrimSpace(altocMapText(ticket, "codocs_document_uuid"))
	pendingUUID := strings.TrimSpace(altocMapText(ticket, "ops_knowledge_pending_uuid"))
	if existingUUID != "" && existingUUID != documentUUID {
		return nil, httperror.New(http.StatusConflict, "service_ticket_ops_knowledge_conflict", "service ticket is already bound to another ops knowledge document")
	}
	if existingUUID == documentUUID {
		if complete && (pendingUUID != "" || strings.TrimSpace(altocMapText(ticket, "ops_knowledge_status")) != "linked") {
			if _, err := tx.ExecContext(ctx, `
				UPDATE service_ticket
				SET ops_knowledge_pending_uuid = NULL,
				    ops_knowledge_status = 'linked',
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, nullableText(altocActor(body)), ticket["id"]); err != nil {
				return nil, err
			}
			ticket, err = altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticket["id"])
			if err != nil {
				return nil, err
			}
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{"ticket": ticket, "updated": true, "idempotent": true, "status": "linked"}, nil
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"ticket": ticket, "updated": false, "idempotent": true}, nil
	}
	if pendingUUID != "" && pendingUUID != documentUUID {
		return nil, httperror.New(http.StatusConflict, "service_ticket_ops_knowledge_conflict", "service ticket has another pending ops knowledge document")
	}
	if !complete {
		if pendingUUID == documentUUID {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{"ticket": ticket, "updated": false, "idempotent": true, "status": "pending"}, nil
		}
		idempotencyKey := serviceTicketOpsKnowledgeOperationKey(ticketCode, documentUUID)
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_ticket
			SET ops_knowledge_pending_uuid = ?,
			    ops_knowledge_status = 'pending',
			    ops_knowledge_idempotency_key = ?,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, documentUUID, nullableText(idempotencyKey), nullableText(altocActor(body)), ticket["id"]); err != nil {
			return nil, err
		}
		trustedContext, err := integrationoperation.TrustedContextFromMap(body, "altoc")
		if err != nil {
			return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
		}
		command, err := a.serviceTicketOpsKnowledgeCommandTx(ctx, tx, ticket["id"], ticketCode, documentUUID)
		if err != nil {
			return nil, err
		}
		if err := insertServiceTicketOpsKnowledgeOperationsTx(
			ctx,
			tx,
			trustedContext,
			altocActor(body),
			idempotencyKey,
			ticketCode,
			command,
		); err != nil {
			return nil, err
		}
		ticket, err = altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticket["id"])
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"ticket": ticket, "updated": true, "idempotent": false, "status": "pending"}, nil
	}
	if pendingUUID == "" {
		return nil, httperror.New(http.StatusConflict, "ops_knowledge_reservation_required", "ops knowledge document must be reserved before completion")
	}
	trustedContext, worker, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationID := strings.TrimSpace(firstBodyText(body, "operationId", "operation_id"))
	fencingToken, fenceErr := uint64BodyValue(body, "fencingToken", "fencing_token")
	if !integrationoperation.IsValidOperationID(operationID) || fenceErr != nil || fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId and fencing token are required")
	}
	correlationKey := serviceTicketOpsKnowledgeOperationKey(ticketCode, documentUUID)
	now := time.Now().UTC()
	var attemptCount int
	var versionNo uint64
	var lastAttemptAt time.Time
	var lockedUntil time.Time
	var commandSchemaVersion string
	var commandSHA256 string
	err = tx.QueryRowContext(ctx, `
		SELECT attempt_count, version_no, last_attempt_at, locked_until, command_schema_version, command_sha256
		FROM integration_operation
		WHERE operation_id = ?
		  AND operation_key = ?
		  AND correlation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'altoc'
		  AND target_app = 'assets'
		  AND operation_code = 'altoc.ops-knowledge.assets-link.v1'
		  AND status = 'processing'
		  AND locked_by = ?
		  AND fencing_token = ?
		LIMIT 1
		FOR UPDATE
	`, operationID, correlationKey+":assets-link", correlationKey, trustedContext.TenantCode, trustedContext.DeploymentCode, worker, fencingToken).
		Scan(&attemptCount, &versionNo, &lastAttemptAt, &lockedUntil, &commandSchemaVersion, &commandSHA256)
	if err != nil || attemptCount <= 0 || versionNo == 0 || lastAttemptAt.IsZero() || !now.Before(lockedUntil) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "Assets integration operation lease is missing, expired or stale")
	}
	duration := now.Sub(lastAttemptAt).Milliseconds()
	if duration < 0 {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "Assets integration operation attempt time is invalid")
	}
	targetReceiptID := strings.TrimSpace(firstBodyText(body, "targetReceiptId", "target_receipt_id"))
	responseSummarySHA256 := strings.TrimSpace(firstBodyText(body, "responseSummarySha256", "response_summary_sha256"))
	if integrationoperation.ValidateReceiptEvidence(
		integrationoperation.ReceiptEvidence{
			OperationID: operationID, OperationCode: opsKnowledgeAssetsOperationCode, IdempotencyKey: correlationKey,
			CommandSchemaVersion: commandSchemaVersion, CommandSHA256: commandSHA256,
			TargetBizType: "delivery_document", TargetBizCode: documentUUID,
		},
		integrationoperation.ReceiptEvidence{
			ReceiptID:             targetReceiptID,
			OperationID:           strings.TrimSpace(firstBodyText(body, "receiptOperationId", "receipt_operation_id")),
			OperationCode:         strings.TrimSpace(firstBodyText(body, "receiptOperationCode", "receipt_operation_code")),
			IdempotencyKey:        strings.TrimSpace(firstBodyText(body, "receiptIdempotencyKey", "receipt_idempotency_key")),
			CommandSchemaVersion:  strings.TrimSpace(firstBodyText(body, "receiptCommandSchemaVersion", "receipt_command_schema_version")),
			CommandSHA256:         strings.TrimSpace(firstBodyText(body, "receiptCommandSha256", "receipt_command_sha256")),
			TargetBizType:         strings.TrimSpace(firstBodyText(body, "targetBizType", "target_biz_type")),
			TargetBizCode:         strings.TrimSpace(firstBodyText(body, "targetBizCode", "target_biz_code")),
			ResponseSummarySHA256: responseSummarySHA256,
		},
	) != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "target receipt does not match the leased integration operation")
	}
	attemptResult, err := tx.ExecContext(ctx, `
		UPDATE integration_operation_attempt
		SET result_status = 'succeeded',
		    http_status = 200,
		    error_code = NULL,
		    error_class = NULL,
		    error_summary = NULL,
		    target_biz_type = 'delivery_document',
		    target_biz_code = ?,
		    finished_at = ?,
		    duration_ms = ?
		WHERE operation_id = ?
		  AND attempt_no = ?
		  AND locked_by = ?
		  AND fencing_token = ?
		  AND result_status = 'processing'
		  AND finished_at IS NULL
	`, documentUUID, now, duration, operationID, attemptCount, worker, fencingToken)
	if err != nil {
		return nil, err
	}
	attemptAcknowledged, err := attemptResult.RowsAffected()
	if err != nil {
		return nil, err
	}
	if attemptAcknowledged != 1 {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "Assets integration operation attempt cannot be completed by this lease")
	}
	ackResult, err := tx.ExecContext(ctx, `
		UPDATE integration_operation
		SET status = 'succeeded',
		    target_receipt_id = ?,
		    target_biz_type = 'delivery_document',
		    target_biz_code = ?,
		    response_summary_sha256 = ?,
		    succeeded_at = ?,
		    locked_by = NULL,
		    locked_until = NULL,
		    last_http_status = 200,
		    last_error_code = NULL,
		    last_error_class = NULL,
		    last_error_summary = NULL,
		    last_error_at = NULL,
		    version_no = ?,
		    updated_by = ?,
		    updated_at = ?
		WHERE operation_id = ?
		  AND operation_key = ?
		  AND correlation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'altoc'
		  AND target_app = 'assets'
		  AND operation_code = 'altoc.ops-knowledge.assets-link.v1'
		  AND status = 'processing'
		  AND locked_by = ?
		  AND fencing_token = ?
		  AND version_no = ?
	`, targetReceiptID, documentUUID, responseSummarySHA256, now, versionNo+1, worker, now, operationID, correlationKey+":assets-link", correlationKey, trustedContext.TenantCode, trustedContext.DeploymentCode, worker, fencingToken, versionNo)
	if err != nil {
		return nil, err
	}
	acknowledged, err := ackResult.RowsAffected()
	if err != nil {
		return nil, err
	}
	if acknowledged != 1 {
		return nil, httperror.New(http.StatusConflict, "integration_operation_not_acknowledged", "Assets integration operation was not found or cannot be acknowledged")
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE service_ticket
		SET codocs_document_uuid = ?,
		    ops_knowledge_pending_uuid = NULL,
		    ops_knowledge_status = 'linked',
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, documentUUID, nullableText(altocActor(body)), ticket["id"]); err != nil {
		return nil, err
	}
	ticket, err = altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticket["id"])
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"ticket": ticket, "updated": true, "idempotent": false, "status": "linked"}, nil
}

func serviceTicketOpsKnowledgeOperationKey(ticketCode string, documentUUID string) string {
	return fmt.Sprintf(
		"altoc:ticket:%s:ops-knowledge:%s",
		strings.TrimSpace(ticketCode),
		strings.TrimSpace(documentUUID),
	)
}

func (a *Adapter) serviceTicketOpsKnowledgeCommandTx(
	ctx context.Context,
	tx *sql.Tx,
	ticketID any,
	ticketCode string,
	documentUUID string,
) (map[string]any, error) {
	trusted, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  st.id,
		  st.code,
		  cu.code AS customer_code,
		  ct.code AS contract_code,
		  mc.code AS maintenance_contract_code,
		  st.project_code,
		  st.aims_project_code,
		  st.delivery_code,
		  COALESCE(st.delivery_code, mc.delivery_code) AS resolved_delivery_code,
		  st.delivery_asset_code,
		  st.environment_code
		FROM service_ticket st
		INNER JOIN customer cu ON cu.id = st.customer_id AND cu.deleted_at IS NULL
		LEFT JOIN contract ct ON ct.id = st.contract_id AND ct.deleted_at IS NULL
		LEFT JOIN maintenance_contract mc ON mc.id = st.maintenance_contract_id AND mc.deleted_at IS NULL
		WHERE st.id = ?
		  AND st.deleted_at IS NULL
		LIMIT 1
	`, ticketID)
	if err != nil {
		return nil, err
	}
	if trusted == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket context not found")
	}
	command := map[string]any{
		"ticketCode":              strings.TrimSpace(ticketCode),
		"documentUuid":            strings.TrimSpace(documentUUID),
		"customerCode":            strings.TrimSpace(altocMapText(trusted, "customer_code")),
		"contractCode":            strings.TrimSpace(altocMapText(trusted, "contract_code")),
		"maintenanceContractCode": strings.TrimSpace(altocMapText(trusted, "maintenance_contract_code")),
		"projectCode": firstNonEmptyText(
			altocMapText(trusted, "aims_project_code"),
			altocMapText(trusted, "project_code"),
		),
		"deliveryCode": firstNonEmptyText(
			altocMapText(trusted, "resolved_delivery_code"),
			altocMapText(trusted, "delivery_code"),
		),
		"deliveryAssetCode": strings.TrimSpace(altocMapText(trusted, "delivery_asset_code")),
		"environmentCode":   strings.TrimSpace(altocMapText(trusted, "environment_code")),
	}
	missing := make([]string, 0)
	for _, key := range []string{
		"ticketCode", "documentUuid", "customerCode", "contractCode", "projectCode",
		"deliveryCode", "deliveryAssetCode", "environmentCode",
	} {
		if strings.TrimSpace(fmt.Sprint(command[key])) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return nil, httperror.New(
			http.StatusConflict,
			"ops_knowledge_context_incomplete",
			"trusted service ticket context is incomplete: "+strings.Join(missing, ", "),
		)
	}
	return command, nil
}

func insertServiceTicketOpsKnowledgeOperationsTx(
	ctx context.Context,
	tx *sql.Tx,
	trusted integrationoperation.TrustedContext,
	actorUID string,
	correlationKey string,
	ticketCode string,
	command map[string]any,
) error {
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return err
	}
	createdBy := strings.TrimSpace(actorUID)
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	for _, spec := range opsKnowledgeOperationSpecs {
		operationID, err := integrationoperation.NewOperationID()
		if err != nil {
			return err
		}
		operationKey := correlationKey + spec.suffix
		var dependsOn any
		if spec.dependsOnSuffix != "" {
			dependsOn = correlationKey + spec.dependsOnSuffix
		}
		identity := integrationoperation.Identity{
			TenantCode:     trusted.TenantCode,
			DeploymentCode: trusted.DeploymentCode,
			SourceApp:      "altoc",
			TargetApp:      spec.targetApp,
			OperationCode:  spec.operationCode,
			SourceBizType:  "service_ticket",
			SourceBizCode:  strings.TrimSpace(ticketCode),
			IdempotencyKey: correlationKey,
			CommandSHA256:  commandSHA256,
		}
		if err := identity.Validate(); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO integration_operation (
			  operation_id, operation_key, correlation_key, sequence_no, depends_on_operation_key,
			  tenant_code, deployment_code, source_app, target_app, operation_code,
			  required_capability, source_biz_type, source_biz_code, idempotency_key,
			  command_schema_version, command_json, command_sha256, status,
			  original_request_id, original_actor_uid, service_client_id, created_by, updated_by, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
		`,
			operationID,
			operationKey,
			correlationKey,
			spec.sequence,
			dependsOn,
			trusted.TenantCode,
			trusted.DeploymentCode,
			"altoc",
			spec.targetApp,
			spec.operationCode,
			spec.requiredCapability,
			"service_ticket",
			identity.SourceBizCode,
			correlationKey,
			"v1",
			string(commandJSON),
			commandSHA256,
			string(integrationoperation.StatusPending),
			nullableText(trusted.RequestID),
			nullableText(strings.TrimSpace(actorUID)),
			nullableText(trusted.ServiceClientID),
			nullableText(createdBy),
			nullableText(createdBy),
		); err != nil {
			return err
		}
	}
	return nil
}
