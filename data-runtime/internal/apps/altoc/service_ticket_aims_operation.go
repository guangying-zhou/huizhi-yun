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
	altocServiceTicketAimsOperation  = "altoc.service-ticket.aims-work-item.v1"
	altocServiceTicketAimsCapability = "aims:service-ticket:work-item:create"
)

func (a *Adapter) freezeServiceTicketAimsWorkItem(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "service_ticket", "edit"); err != nil {
		return nil, err
	}
	projectCode := strings.TrimSpace(firstBodyText(body, "resolvedProjectCode", "resolved_project_code"))
	projectSource := strings.TrimSpace(firstBodyText(body, "resolvedProjectSource", "resolved_project_source"))
	actor := strings.TrimSpace(firstBodyText(body, "current_user"))
	operationKey := strings.TrimSpace(firstBodyText(body, "idempotencyKey", "idempotency_key"))
	if projectCode == "" || projectSource == "" || actor == "" || operationKey == "" {
		return nil, httperror.New(http.StatusBadRequest, "service_ticket_dispatch_invalid", "verified actor, project resolution and idempotency key are required")
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Altoc context is required")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ticket, err := altocQueryOneMap(ctx, tx, `SELECT st.*,cu.code customer_code,cu.name customer_name,ct.code contract_code,mc.code maintenance_contract_code,COALESCE(st.delivery_code,mc.delivery_code) resolved_delivery_code FROM service_ticket st INNER JOIN customer cu ON cu.id=st.customer_id AND cu.deleted_at IS NULL LEFT JOIN contract ct ON ct.id=st.contract_id AND ct.deleted_at IS NULL LEFT JOIN maintenance_contract mc ON mc.id=st.maintenance_contract_id AND mc.deleted_at IS NULL WHERE st.code=? AND st.deleted_at IS NULL LIMIT 1 FOR UPDATE`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
		return nil, err
	}
	boundProject := firstNonEmptyText(altocMapText(ticket, "aims_project_code"), altocMapText(ticket, "project_code"))
	if boundProject != "" && boundProject != projectCode {
		return nil, httperror.New(http.StatusConflict, "service_ticket_project_binding_conflict", "service ticket is already bound to another Aims project")
	}
	command := map[string]any{
		"ticketCode": ticketCode, "projectCode": projectCode, "projectSource": projectSource,
		"ticketType": ticket["ticket_type"], "title": ticket["title"], "description": altocBoundedCommandText(ticket["description"], 8000), "priority": ticket["priority"],
		"customerCode": ticket["customer_code"], "customerName": altocBoundedCommandText(ticket["customer_name"], 255), "contractCode": ticket["contract_code"],
		"maintenanceContractCode": ticket["maintenance_contract_code"], "deliveryCode": ticket["resolved_delivery_code"],
		"environmentCode": ticket["environment_code"], "productCode": ticket["product_code"], "productVersion": ticket["product_version"],
		"ownerUserId": ticket["owner_user_id"], "handlerUserId": ticket["handler_user_id"], "responseDueAt": ticket["response_due_at"],
		"resolutionDueAt": ticket["resolution_due_at"], "slaStatusSnapshot": ticket["sla_status"],
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, _ := json.Marshal(command)
	var storedID, storedHash, status string
	err = tx.QueryRowContext(ctx, `SELECT operation_id,command_sha256,status FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='altoc' AND operation_key=? FOR UPDATE`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&storedID, &storedHash, &status)
	created := false
	if err == sql.ErrNoRows {
		storedID, err = integrationoperation.NewOperationID()
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation (operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by, next_attempt_at) VALUES (?,?,?,1,?,?,'altoc','aims',?,?,'service_ticket',?,?,'v1',?,?,'pending',?,?,?,?,?, UTC_TIMESTAMP(3))`, storedID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode, altocServiceTicketAimsOperation, altocServiceTicketAimsCapability, ticketCode, operationKey, string(commandJSON), commandSHA, nullableText(trusted.RequestID), nullableText(actor), nullableText(trusted.ServiceClientID), nullableText(actor), nullableText(actor))
		if err != nil {
			return nil, err
		}
		status = "pending"
		created = true
	} else if err != nil {
		return nil, err
	} else if storedHash != commandSHA {
		return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "service ticket operation has different trusted evidence")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE service_ticket SET aims_dispatch_status=?,aims_dispatch_operation_key=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, altocServiceTicketDispatchProjection(status), operationKey, actor, ticket["id"]); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "service_ticket", ticket["id"], "aims_work_item_dispatch", nil, map[string]any{"project_code": projectCode, "project_source": projectSource, "operation_key": operationKey}, actor); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"ticket": ticket, "operation": map[string]any{"operationId": storedID, "operationKey": operationKey, "status": status, "created": created}}, nil
}

func altocServiceTicketDispatchProjection(operationStatus string) string {
	switch strings.TrimSpace(operationStatus) {
	case "succeeded":
		return "succeeded"
	case "pending", "processing", "retry_wait", "partial_unknown":
		return "pending"
	case "failed_permanent", "dead_letter":
		return "failed"
	default:
		return "failed"
	}
}

func altocBoundedCommandText(value any, maxRunes int) any {
	if value == nil {
		return nil
	}
	runes := []rune(strings.TrimSpace(fmt.Sprint(value)))
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return string(runes)
}

func (a *Adapter) completeServiceTicketAimsWorkItem(ctx context.Context, ticketCode, operationKey string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationID := strings.TrimSpace(firstBodyText(body, "operationId"))
	fencing, _ := uint64BodyValue(body, "fencingToken")
	targetApp, operationCode, command, err := a.loadLeasedIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencing)
	if err != nil {
		return nil, err
	}
	if targetApp != "aims" || operationCode != altocServiceTicketAimsOperation || strings.TrimSpace(fmt.Sprint(command["ticketCode"])) != ticketCode {
		return nil, httperror.New(http.StatusConflict, "integration_operation_identity_mismatch", "leased service ticket operation is invalid")
	}
	commandSHA, _ := integrationoperation.ValidateAndDigestCommand(command)
	receipt := integrationoperation.ReceiptEvidence{ReceiptID: strings.TrimSpace(firstBodyText(body, "targetReceiptId")), OperationID: strings.TrimSpace(firstBodyText(body, "receiptOperationId")), OperationCode: strings.TrimSpace(firstBodyText(body, "receiptOperationCode")), IdempotencyKey: strings.TrimSpace(firstBodyText(body, "receiptIdempotencyKey")), CommandSchemaVersion: strings.TrimSpace(firstBodyText(body, "receiptCommandSchemaVersion")), CommandSHA256: strings.TrimSpace(firstBodyText(body, "receiptCommandSha256")), TargetBizType: strings.TrimSpace(firstBodyText(body, "targetBizType")), TargetBizCode: strings.TrimSpace(firstBodyText(body, "targetBizCode")), ResponseSummarySHA256: strings.TrimSpace(firstBodyText(body, "responseSummarySha256"))}
	if receipt.TargetBizType != "work_item" || receipt.TargetBizCode == "" || integrationoperation.ValidateReceiptEvidence(integrationoperation.ReceiptEvidence{OperationID: operationID, OperationCode: operationCode, IdempotencyKey: operationKey, CommandSchemaVersion: "v1", CommandSHA256: commandSHA, TargetBizType: "work_item", TargetBizCode: receipt.TargetBizCode}, receipt) != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "Aims receipt does not match service ticket operation")
	}
	repo, _ := integrationoperation.NewRepository(a.DB())
	result, err := repo.RecordSuccessWithMutation(ctx, integrationoperation.RecordSuccessInput{Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencing}, Now: time.Now().UTC(), HTTPStatus: http.StatusOK, TargetReceiptID: receipt.ReceiptID, TargetBizType: receipt.TargetBizType, TargetBizCode: receipt.TargetBizCode, ResponseSummarySHA256: receipt.ResponseSummarySHA256}, func(ctx context.Context, tx *sql.Tx) error {
		projectCode := strings.TrimSpace(fmt.Sprint(command["projectCode"]))
		updatedBy := firstNonEmptyText(trusted.ServiceClientID, worker)
		res, err := tx.ExecContext(ctx, `UPDATE service_ticket SET aims_project_code=COALESCE(aims_project_code,?),project_code=COALESCE(project_code,?),aims_work_item_key=COALESCE(aims_work_item_key,?),aims_dispatch_status='succeeded',status=CASE WHEN status='open' THEN 'accepted' ELSE status END,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE code=? AND deleted_at IS NULL AND (aims_project_code IS NULL OR aims_project_code=?) AND (aims_work_item_key IS NULL OR aims_work_item_key=?) AND aims_dispatch_operation_key=?`, projectCode, projectCode, receipt.TargetBizCode, updatedBy, ticketCode, projectCode, receipt.TargetBizCode, operationKey)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return httperror.New(http.StatusConflict, "service_ticket_delivery_binding_conflict", "ticket binding changed before checkpoint")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "status": string(result.Status), "workItemKey": receipt.TargetBizCode, "projectCode": command["projectCode"]}, nil
}
