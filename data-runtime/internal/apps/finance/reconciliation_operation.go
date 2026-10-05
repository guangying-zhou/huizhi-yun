package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	financeAltocSummaryOperationCode = "finance.reconciliation.altoc-summary.v1"
	financeAltocSummaryCapability    = "altoc:contract:finance-summary:sync"
	financeIntegrationLease          = time.Minute
)

func (a *Adapter) enqueueAltocFinanceSummaryOperationTx(ctx context.Context, tx *sql.Tx, reconciliation map[string]any, trustedContractCode, trustedPlanCode string, body jsonBody) (map[string]any, error) {
	contractCode := strings.TrimSpace(trustedContractCode)
	code := strings.TrimSpace(cleanStringValue(reconciliation["code"]))
	if contractCode == "" {
		return map[string]any{"linked": false}, nil
	}
	if code == "" {
		return nil, httperror.New(http.StatusConflict, "reconciliation_identity_missing", "reconciliation code is required for reliable Altoc summary delivery")
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "finance")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation context is required")
	}
	operationKey := "finance:reconciliation:" + code + ":altoc-summary:v1"
	command := map[string]any{
		"contractCode":          contractCode,
		"reconciliationCode":    code,
		"receivablePlanCode":    nullableFinanceText(trustedPlanCode),
		"contractSummary":       reconciliation["contractSummary"],
		"receivablePlanSummary": reconciliation["receivablePlanSummary"],
	}
	if strings.TrimSpace(trustedPlanCode) == "" {
		command["receivablePlanSummary"] = nil
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
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
	actor := strings.TrimSpace(cleanStringValue(body["current_user"]))
	createdBy := actor
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	result, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO integration_operation (
		  operation_id,operation_key,correlation_key,sequence_no,
		  tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,
		  source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,next_attempt_at,
		  status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by
		) VALUES (?,?,?,1,?,?,'finance','altoc',?,?,'reconciliation',?,?,'v1',?,?,UTC_TIMESTAMP(3),'pending',?,?,?,?,?)`,
		operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
		financeAltocSummaryOperationCode, financeAltocSummaryCapability, code, operationKey,
		string(commandJSON), commandSHA, nullableFinanceText(trusted.RequestID), nullableFinanceText(actor),
		nullableFinanceText(trusted.ServiceClientID), nullableFinanceText(createdBy), nullableFinanceText(createdBy))
	if err != nil {
		return nil, err
	}
	created, _ := result.RowsAffected()
	var storedID, storedSHA, status string
	if err := tx.QueryRowContext(ctx, `SELECT operation_id,command_sha256,status FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='finance' AND operation_key=? LIMIT 1`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&storedID, &storedSHA, &status); err != nil {
		return nil, err
	}
	if storedSHA != commandSHA {
		return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing Finance summary operation has different trusted evidence")
	}
	return map[string]any{"linked": true, "created": created == 1, "operationId": storedID, "operationKey": operationKey, "status": status}, nil
}

func (a *Adapter) handleFinanceIntegrationOperation(ctx context.Context, method, path string, body jsonBody) (DataResult[map[string]any], string, bool, error) {
	if method != http.MethodPost {
		return DataResult[map[string]any]{}, "", false, nil
	}
	switch {
	case path == "/v1/finance/integration-operations:claim-next":
		data, err := a.claimFinanceIntegrationOperation(ctx, "", body)
		return resultData(data), "finance.integration_operations.claim_next", true, err
	case path == "/v1/finance/integration-operations:pending-dead-letter-actionables":
		data, err := a.listFinanceDeadLetterActionables(ctx, body)
		return resultData(data), "finance.integration_operations.dead_letter_actionables.list", true, err
	case path == "/v1/finance/integration-operations:pending-dead-letter-closures":
		data, err := a.listFinanceDeadLetterClosures(ctx, body)
		return resultData(data), "finance.integration_operations.dead_letter_closures.list", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":claim"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":claim")
		data, err := a.claimFinanceIntegrationOperation(ctx, key, body)
		return resultData(data), "finance.integration_operations.claim", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":succeed"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":succeed")
		data, err := a.succeedFinanceIntegrationOperation(ctx, key, body)
		return resultData(data), "finance.integration_operations.succeed", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":fail"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":fail")
		data, err := a.failFinanceIntegrationOperation(ctx, key, body)
		return resultData(data), "finance.integration_operations.fail", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":replay"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":replay")
		data, err := a.replayFinanceIntegrationOperation(ctx, operationID, body)
		return resultData(data), "finance.integration_operations.replay", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":dead-letter-actionable-published"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":dead-letter-actionable-published")
		data, err := a.markFinanceDeadLetterActionablePublished(ctx, operationID, body)
		return resultData(data), "finance.integration_operations.dead_letter_actionables.mark", true, err
	case strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, ":dead-letter-closure-acknowledged"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), ":dead-letter-closure-acknowledged")
		data, err := a.markFinanceDeadLetterClosureAcknowledged(ctx, operationID, body)
		return resultData(data), "finance.integration_operations.dead_letter_closures.mark", true, err
	default:
		return DataResult[map[string]any]{}, "", false, nil
	}
}

func (a *Adapter) claimFinanceIntegrationOperation(ctx context.Context, operationKey string, body jsonBody) (map[string]any, error) {
	trusted, worker, err := trustedFinanceIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	var claimed *integrationoperation.ClaimedOperation
	if strings.TrimSpace(operationKey) == "" {
		claimed, err = repository.ClaimNext(ctx, trusted.TenantCode, trusted.DeploymentCode, "finance", worker, time.Now().UTC(), financeIntegrationLease)
	} else {
		claimed, err = repository.ClaimByOperationKey(ctx, trusted.TenantCode, trusted.DeploymentCode, "finance", strings.TrimSpace(operationKey), worker, time.Now().UTC(), financeIntegrationLease)
	}
	if err != nil || claimed == nil {
		return nil, err
	}
	isAltoc := claimed.Identity.TargetApp == "altoc" && claimed.Identity.OperationCode == financeAltocSummaryOperationCode && claimed.RequiredCapability == financeAltocSummaryCapability
	isWorkflow := claimed.Identity.TargetApp == "workflow" && claimed.Identity.OperationCode == financeWorkflowOperationCode && claimed.RequiredCapability == financeWorkflowCapability
	if !isAltoc && !isWorkflow {
		return nil, httperror.New(http.StatusConflict, "integration_operation_identity_mismatch", "claimed Finance operation has an unsupported target contract")
	}
	var command map[string]any
	if err := json.Unmarshal(claimed.Command, &command); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": claimed.OperationID, "operationKey": claimed.OperationKey,
		"tenantCode": claimed.Identity.TenantCode, "deploymentCode": claimed.Identity.DeploymentCode,
		"sourceApp": "finance", "targetApp": claimed.Identity.TargetApp, "operationCode": claimed.Identity.OperationCode,
		"requiredCapability": claimed.RequiredCapability, "idempotencyKey": claimed.Identity.IdempotencyKey,
		"commandSchemaVersion": claimed.CommandSchemaVersion, "commandSha256": claimed.Identity.CommandSHA256,
		"command": command, "fencingToken": claimed.FencingToken,
	}, nil
}

func (a *Adapter) financeIntegrationCompletionIdentity(body jsonBody) (integrationoperation.TrustedContext, string, string, uint64, error) {
	trusted, worker, err := trustedFinanceIntegrationWorker(body)
	if err != nil {
		return integrationoperation.TrustedContext{}, "", "", 0, err
	}
	operationID := strings.TrimSpace(cleanStringValue(body["operationId"]))
	fencing, err := strconv.ParseUint(strings.TrimSpace(fmt.Sprint(body["fencingToken"])), 10, 64)
	if !integrationoperation.IsValidOperationID(operationID) || err != nil || fencing == 0 {
		return integrationoperation.TrustedContext{}, "", "", 0, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId and fencingToken are required")
	}
	return trusted, worker, operationID, fencing, nil
}

func (a *Adapter) validateLeasedFinanceOperation(ctx context.Context, trusted integrationoperation.TrustedContext, worker, operationID, operationKey string, fencing uint64) (map[string]any, string, error) {
	var targetApp, operationCode string
	var commandJSON []byte
	err := a.db.QueryRowContext(ctx, `SELECT target_app,operation_code,command_json FROM integration_operation WHERE operation_id=? AND operation_key=? AND tenant_code=? AND deployment_code=? AND source_app='finance' AND status='processing' AND locked_by=? AND fencing_token=? LIMIT 1`, operationID, operationKey, trusted.TenantCode, trusted.DeploymentCode, worker, fencing).Scan(&targetApp, &operationCode, &commandJSON)
	valid := targetApp == "altoc" && operationCode == financeAltocSummaryOperationCode || targetApp == "workflow" && operationCode == financeWorkflowOperationCode
	if err != nil || !valid {
		return nil, "", httperror.New(http.StatusConflict, "integration_operation_lease_stale", "Finance operation lease is stale")
	}
	var command map[string]any
	if err := json.Unmarshal(commandJSON, &command); err != nil {
		return nil, "", httperror.New(http.StatusConflict, "integration_operation_command_invalid", "stored Finance operation command is invalid")
	}
	return command, operationCode, nil
}

func (a *Adapter) succeedFinanceIntegrationOperation(ctx context.Context, operationKey string, body jsonBody) (map[string]any, error) {
	trusted, worker, operationID, fencing, err := a.financeIntegrationCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	command, operationCode, err := a.validateLeasedFinanceOperation(ctx, trusted, worker, operationID, operationKey, fencing)
	if err != nil {
		return nil, err
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	contractCode := strings.TrimSpace(cleanStringValue(command["contractCode"]))
	receipt := integrationoperation.ReceiptEvidence{
		ReceiptID: strings.TrimSpace(cleanStringValue(body["targetReceiptId"])), OperationID: strings.TrimSpace(cleanStringValue(body["receiptOperationId"])),
		OperationCode: strings.TrimSpace(cleanStringValue(body["receiptOperationCode"])), IdempotencyKey: strings.TrimSpace(cleanStringValue(body["receiptIdempotencyKey"])),
		CommandSchemaVersion: strings.TrimSpace(cleanStringValue(body["receiptCommandSchemaVersion"])), CommandSHA256: strings.TrimSpace(cleanStringValue(body["receiptCommandSha256"])),
		TargetBizType: strings.TrimSpace(cleanStringValue(body["targetBizType"])), TargetBizCode: strings.TrimSpace(cleanStringValue(body["targetBizCode"])),
		ResponseSummarySHA256: strings.TrimSpace(cleanStringValue(body["responseSummarySha256"])),
	}
	expectedType, expectedCode := "contract_finance_summary", contractCode
	if operationCode == financeWorkflowOperationCode {
		expectedType = "workflow_instance"
		expectedCode = receipt.TargetBizCode
		if expectedCode == "" {
			return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "Workflow receipt is missing its instance number")
		}
	}
	if err := integrationoperation.ValidateReceiptEvidence(integrationoperation.ReceiptEvidence{
		OperationID: operationID, OperationCode: operationCode, IdempotencyKey: operationKey,
		CommandSchemaVersion: "v1", CommandSHA256: commandSHA, TargetBizType: expectedType, TargetBizCode: expectedCode,
	}, receipt); err != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "target receipt does not match the leased Finance operation")
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	successInput := integrationoperation.RecordSuccessInput{
		Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencing}, Now: time.Now().UTC(), HTTPStatus: http.StatusOK,
		TargetReceiptID: receipt.ReceiptID, TargetBizType: receipt.TargetBizType, TargetBizCode: receipt.TargetBizCode, ResponseSummarySHA256: receipt.ResponseSummarySHA256,
	}
	var result integrationoperation.RecordResult
	if operationCode == financeWorkflowOperationCode {
		invoiceCode := strings.TrimSpace(cleanStringValue(command["invoiceRequestCode"]))
		actorUID := strings.TrimSpace(cleanStringValue(command["actorUid"]))
		result, err = repository.RecordSuccessWithMutation(ctx, successInput, func(ctx context.Context, tx *sql.Tx) error {
			updated, err := tx.ExecContext(ctx, `UPDATE invoice_request SET status='pending_approval',workflow_instance_id=?,submitted_at=NOW(),updated_by=COALESCE(?,updated_by),updated_at=CURRENT_TIMESTAMP WHERE code=? AND deleted_at IS NULL AND status IN ('draft','rejected','pending_approval')`, receipt.TargetBizCode, nullableFinanceText(actorUID), invoiceCode)
			if err != nil {
				return err
			}
			if count, _ := updated.RowsAffected(); count != 1 {
				return httperror.New(http.StatusConflict, "invoice_request_checkpoint_conflict", "invoice request cannot accept Workflow checkpoint")
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO external_approval_instance (biz_type,biz_code,workflow_instance_id,external_platform,external_instance_id,status,submitted_by,submitted_at,last_synced_at,error_message) VALUES ('invoice_request',?,?, 'workflow',?,'pending',?,NOW(),NOW(),NULL) ON DUPLICATE KEY UPDATE workflow_instance_id=VALUES(workflow_instance_id),external_platform='workflow',external_instance_id=VALUES(external_instance_id),status='pending',submitted_by=VALUES(submitted_by),submitted_at=NOW(),last_synced_at=NOW(),error_message=NULL`, invoiceCode, receipt.TargetBizCode, receipt.TargetBizCode, nullableFinanceText(actorUID))
			return err
		})
	} else {
		result, err = repository.RecordSuccess(ctx, successInput)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "status": string(result.Status), "version": result.Version}, nil
}

func (a *Adapter) failFinanceIntegrationOperation(ctx context.Context, operationKey string, body jsonBody) (map[string]any, error) {
	trusted, worker, operationID, fencing, err := a.financeIntegrationCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	if _, _, err := a.validateLeasedFinanceOperation(ctx, trusted, worker, operationID, operationKey, fencing); err != nil {
		return nil, err
	}
	failure := integrationoperation.FailureInput{HTTPStatus: int(float64FromFinance(body["httpStatus"]))}
	if body["timedOut"] == true {
		failure.Err = context.DeadlineExceeded
	} else if body["networkError"] == true {
		failure.Err = errors.New("network error")
	}
	switch strings.TrimSpace(cleanStringValue(body["conflictDisposition"])) {
	case "processing":
		failure.ConflictDisposition = integrationoperation.ConflictInProgress
	case "idempotent_success":
		failure.ConflictDisposition = integrationoperation.ConflictIdempotentExisting
	case "payload_mismatch", "binding_conflict", "permanent":
		failure.ConflictDisposition = integrationoperation.ConflictPermanent
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordFailure(ctx, integrationoperation.RecordFailureInput{
		Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencing}, Now: time.Now().UTC(), Failure: failure,
		ErrorCode: strings.TrimSpace(cleanStringValue(body["errorCode"])), ErrorSummary: strings.TrimSpace(cleanStringValue(body["errorSummary"])), DeliveryUncertain: body["deliveryUncertain"] == true,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "status": string(result.Status), "version": result.Version}, nil
}

func trustedFinanceIntegrationWorker(body jsonBody) (integrationoperation.TrustedContext, string, error) {
	if err := requireFinanceIntegrationScope(body); err != nil {
		return integrationoperation.TrustedContext{}, "", err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "finance")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation worker context is required")
	}
	worker := "finance:" + trusted.ServiceClientID + ":" + trusted.RequestID
	if len(worker) > 240 {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "Finance integration worker identity is too long")
	}
	return trusted, worker, nil
}

func requireFinanceIntegrationScope(body jsonBody) error {
	for _, scope := range financeIntegrationScopes(body["current_user_scopes"]) {
		if scope == "*" || scope == "finance.*" || scope == "finance:integration_operation:execute" {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", "finance:integration_operation:execute scope is required")
}

func financeIntegrationScopes(value any) []string {
	parts := []string{}
	appendScopes := func(raw string) {
		parts = append(parts, strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' })...)
	}
	switch typed := value.(type) {
	case []string:
		for _, scope := range typed {
			appendScopes(scope)
		}
	case []any:
		for _, scope := range typed {
			appendScopes(cleanStringValue(scope))
		}
	default:
		appendScopes(cleanStringValue(value))
	}
	return parts
}

func float64FromFinance(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	}
	parsed, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	return parsed
}

func nullableFinanceText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
