package aims

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
	serviceTicketDeliveryOperationCode      = "aims.work-item.ticket-result.v1"
	serviceTicketDeliveryRequiredCapability = "altoc:service-ticket:delivery-result:sync"
)

func (a *Adapter) enqueueServiceTicketDeliveryOperationTx(
	ctx context.Context,
	tx *sql.Tx,
	rawWorkItemID string,
	body map[string]any,
) (map[string]any, error) {
	if !hasAnyBodyKey(body, "status") {
		return map[string]any{"serviceTicketDelivery": map[string]any{"linked": false, "reason": "status_unchanged"}}, nil
	}
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return nil, err
	}
	item, err := aimsQueryOneMap(ctx, tx, `
		SELECT
		  wi.id, wi.item_key, wi.type, wi.status, wi.assignee_uid,
		  p.project_code, wse.source_ticket_code, wse.delivery_generation, wse.last_delivery_status
		FROM work_items wi
		INNER JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		WHERE wi.id = ?
		LIMIT 1
		FOR UPDATE
	`, workItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "work item not found")
	}
	ticketCode := strings.TrimSpace(aimsMapText(item, "source_ticket_code"))
	if ticketCode == "" {
		return map[string]any{
			"serviceTicketDelivery": map[string]any{"linked": false},
		}, nil
	}
	deliveryStatus, captureResponse, captureResolution := serviceTicketDeliveryStage(aimsMapText(item, "status"))
	if deliveryStatus == "" {
		return nil, httperror.New(http.StatusConflict, "unsupported_service_ticket_work_item_status", "work item status cannot be synchronized to Altoc")
	}
	itemKey := strings.TrimSpace(aimsMapText(item, "item_key"))
	generation := int64(serviceBodyInt(item, "delivery_generation"))
	lastStatus := strings.TrimSpace(aimsMapText(item, "last_delivery_status"))
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	if lastStatus == deliveryStatus && generation > 0 {
		operationKey := fmt.Sprintf("aims:work-item:%s:ticket-result:g%d:v1", itemKey, generation)
		status, frozen, err := existingServiceTicketDeliveryOperation(ctx, tx, trusted, operationKey, itemKey)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(fmt.Sprint(frozen["ticketCode"])) != ticketCode ||
			strings.TrimSpace(fmt.Sprint(frozen["workItemKey"])) != itemKey ||
			strings.TrimSpace(fmt.Sprint(frozen["deliveryStatus"])) != deliveryStatus ||
			int64(serviceBodyInt(frozen, "deliveryGeneration")) != generation {
			return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing service ticket delivery command does not match the current stage")
		}
		return serviceTicketDeliveryOperationMetadata(operationKey, status), nil
	}
	generation++
	operationKey := fmt.Sprintf("aims:work-item:%s:ticket-result:g%d:v1", itemKey, generation)
	existingStatus, existingCommand, existingErr := existingServiceTicketDeliveryOperation(ctx, tx, trusted, operationKey, itemKey)
	if existingErr != nil && existingErr != sql.ErrNoRows {
		return nil, existingErr
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE work_item_service_ext
		SET first_responded_at = CASE
		      WHEN ? = 1 THEN COALESCE(first_responded_at, CURRENT_TIMESTAMP)
		      ELSE first_responded_at
		    END,
		    resolved_at = CASE
		      WHEN ? = 1 THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
		      ELSE resolved_at
		    END,
		    delivery_generation = ?,
		    last_delivery_status = ?
		WHERE work_item_id = ?
	`, captureResponse, captureResolution, generation, deliveryStatus, workItemID); err != nil {
		return nil, err
	}

	command, err := a.serviceTicketDeliveryCommandTx(ctx, tx, workItemID, item, ticketCode, deliveryStatus, operationKey, body)
	if err != nil {
		return nil, err
	}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	if existingErr == nil {
		existingHash, digestErr := integrationoperation.ValidateAndDigestCommand(existingCommand)
		if digestErr != nil || existingHash != commandSHA256 {
			return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing service ticket delivery command hash differs")
		}
		return serviceTicketDeliveryOperationMetadata(operationKey, existingStatus), nil
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	identity := integrationoperation.Identity{
		TenantCode:     trusted.TenantCode,
		DeploymentCode: trusted.DeploymentCode,
		SourceApp:      "aims",
		TargetApp:      "altoc",
		OperationCode:  serviceTicketDeliveryOperationCode,
		SourceBizType:  "work_item",
		SourceBizCode:  itemKey,
		IdempotencyKey: operationKey,
		CommandSHA256:  commandSHA256,
	}
	if err := identity.Validate(); err != nil {
		return nil, err
	}
	actorUID := strings.TrimSpace(firstBodyText(body, "current_user"))
	createdBy := actorUID
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	if _, err := tx.ExecContext(ctx, trusted.SQL(`
		INSERT INTO integration_operation (
		  operation_id, operation_key, correlation_key, sequence_no, depends_on_operation_key,
		  tenant_code, deployment_code, source_app, target_app, operation_code,
		  required_capability, source_biz_type, source_biz_code, idempotency_key,
		  command_schema_version, command_json, command_sha256, status,
		  original_request_id, original_actor_uid, service_client_id, created_by, updated_by,
		  next_attempt_at
		) VALUES (?, ?, ?, 1, NULL, ?, ?, 'aims', 'altoc', ?, ?, 'work_item', ?, ?, 'v1', ?, ?, 'pending', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
	`),
		operationID,
		operationKey,
		operationKey,
		trusted.TenantCode,
		trusted.DeploymentCode,
		serviceTicketDeliveryOperationCode,
		serviceTicketDeliveryRequiredCapability,
		itemKey,
		operationKey,
		string(commandJSON),
		commandSHA256,
		nullableText(trusted.RequestID),
		nullableText(actorUID),
		nullableText(trusted.ServiceClientID),
		nullableText(createdBy),
		nullableText(createdBy),
	); err != nil {
		return nil, err
	}
	return serviceTicketDeliveryOperationMetadata(operationKey, string(integrationoperation.StatusPending)), nil
}

func existingServiceTicketDeliveryOperation(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, operationKey, itemKey string) (string, map[string]any, error) {
	var status, commandJSON, commandSHA string
	err := tx.QueryRowContext(ctx, trusted.SQL(`
		SELECT status, command_json, command_sha256
		FROM integration_operation
		WHERE operation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'aims'
		  AND target_app = 'altoc'
		  AND operation_code = 'aims.work-item.ticket-result.v1'
		  AND source_biz_type = 'work_item'
		  AND source_biz_code = ?
		  AND idempotency_key = ?
		LIMIT 1
		FOR UPDATE
	`), operationKey, trusted.TenantCode, trusted.DeploymentCode, itemKey, operationKey).Scan(&status, &commandJSON, &commandSHA)
	if err != nil {
		return "", nil, err
	}
	var command map[string]any
	if json.Unmarshal([]byte(commandJSON), &command) != nil {
		return "", nil, httperror.New(http.StatusConflict, "integration_operation_command_invalid", "existing service ticket delivery command is invalid")
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil || digest != commandSHA {
		return "", nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing service ticket delivery command hash is invalid")
	}
	return status, command, nil
}

func (a *Adapter) serviceTicketDeliveryCommandTx(
	ctx context.Context,
	tx *sql.Tx,
	workItemID int64,
	item map[string]any,
	ticketCode string,
	deliveryStatus string,
	operationKey string,
	body map[string]any,
) (map[string]any, error) {
	documents, err := aimsQueryMaps(ctx, tx, `
		SELECT COALESCE(codocs_uuid, uuid) AS document_uuid
		FROM project_documents
		WHERE work_item_id = ?
		  AND is_folder = 0
		  AND COALESCE(codocs_uuid, uuid, '') <> ''
		ORDER BY created_at DESC, id DESC
		LIMIT 2
	`, workItemID)
	if err != nil {
		return nil, err
	}
	if len(documents) > 1 {
		return nil, httperror.New(http.StatusConflict, "service_ticket_document_ambiguous", "multiple work item documents are eligible for Altoc delivery result")
	}
	var documentUUID any
	if len(documents) == 1 {
		documentUUID = nullableText(strings.TrimSpace(fmt.Sprint(documents[0]["document_uuid"])))
	}
	usage, err := aimsQueryOneMap(ctx, tx, `
		SELECT COALESCE(SUM(hours), 0) AS actual_hours
		FROM time_entries
		WHERE work_item_id = ?
	`, workItemID)
	if err != nil {
		return nil, err
	}
	timestamps, err := aimsQueryOneMap(ctx, tx, `
		SELECT
		  DATE_FORMAT(first_responded_at, '%Y-%m-%d %H:%i:%s') AS first_responded_at,
		  DATE_FORMAT(resolved_at, '%Y-%m-%d %H:%i:%s') AS resolved_at
		FROM work_item_service_ext
		WHERE work_item_id = ?
		LIMIT 1
	`, workItemID)
	if err != nil {
		return nil, err
	}
	command := map[string]any{
		"ticketCode":         ticketCode,
		"aimsProjectCode":    strings.TrimSpace(aimsMapText(item, "project_code")),
		"workItemKey":        strings.TrimSpace(aimsMapText(item, "item_key")),
		"workItemType":       strings.TrimSpace(aimsMapText(item, "type")),
		"workItemStatus":     strings.TrimSpace(aimsMapText(item, "status")),
		"deliveryStatus":     deliveryStatus,
		"deliveryGeneration": int64(serviceBodyInt(item, "delivery_generation")) + 1,
		"handlerUserId":      nullableText(strings.TrimSpace(aimsMapText(item, "assignee_uid"))),
		"documentUuid":       documentUUID,
		"quotaConsumed":      usage["actual_hours"],
		"firstRespondedAt":   timestamps["first_responded_at"],
		"resolvedAt":         timestamps["resolved_at"],
	}
	if deliveryStatus == "closed" {
		command["closedAt"] = time.Now().UTC().Format("2006-01-02 15:04:05")
	}
	return command, nil
}

func serviceTicketDeliveryOperationMetadata(operationKey string, status string) map[string]any {
	return map[string]any{
		"serviceTicketDelivery": map[string]any{
			"linked":          true,
			"operationKey":    operationKey,
			"operationStatus": status,
		},
	}
}
