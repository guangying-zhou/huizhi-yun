package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	altocInvoiceRequestOperationCode = "altoc.receivable.finance-invoice-request.v1"
	altocInvoiceRequestCapability    = "finance:invoice-request:create"
	financeWorkflowOperationCode     = "finance.invoice-request.workflow-submit.v1"
	financeWorkflowCapability        = "workflow:invoice-request:create"
)

func (a *Adapter) receiveAltocInvoiceRequest(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "finance", altocInvoiceRequestOperationCode, altocInvoiceRequestCapability)
	if err != nil {
		return DataResult[map[string]any]{}, financeReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "altoc" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be altoc")
	}
	planCode := strings.TrimSpace(fmt.Sprint(command["receivablePlanCode"]))
	actorUID := strings.TrimSpace(fmt.Sprint(command["actorUid"]))
	requestBody, ok := command["invoiceRequest"].(map[string]any)
	if !ok || planCode == "" || actorUID == "" || strings.TrimSpace(fmt.Sprint(requestBody["receivablePlanCode"])) != planCode {
		return DataResult[map[string]any]{}, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "Altoc invoice request command identity is invalid")
	}
	if strings.TrimSpace(fmt.Sprint(body["current_user"])) != actorUID {
		return DataResult[map[string]any]{}, httperror.New(http.StatusForbidden, "trusted_actor_mismatch", "trusted delegated actor does not match the frozen Altoc command")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		invoiceRequest, err := queryOneMap(ctx, tx, `SELECT * FROM invoice_request WHERE source_app='altoc' AND source_biz_type='receivable_plan' AND source_biz_code=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, planCode)
		created := false
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if invoiceRequest == nil {
			payload := jsonBody{}
			for key, value := range requestBody {
				payload[key] = value
			}
			payload["sourceApp"], payload["sourceBizType"], payload["sourceBizCode"] = "altoc", "receivable_plan", planCode
			payload["requestedBy"], payload["createdBy"], payload["updatedBy"] = actorUID, actorUID, actorUID
			result, err := createBySpecOn(ctx, tx, createSpecs["/v1/finance/invoice-requests"], payload)
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			invoiceRequest, created = result.Data, true
		}
		invoiceCode := strings.TrimSpace(cleanStringValue(invoiceRequest["code"]))
		workflowOperation, err := enqueueFinanceInvoiceWorkflowOperationTx(ctx, tx, receiptInput, invoiceRequest, actorUID)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "invoice_request", TargetBizCode: invoiceCode, HTTPStatus: http.StatusOK,
			Value: map[string]any{"invoiceRequest": invoiceRequest, "created": created, "workflowOperation": workflowOperation},
		}, nil
	})
	if err != nil {
		return DataResult[map[string]any]{}, financeReceiptError(err)
	}
	return resultData(map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded",
		"operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode,
		"idempotencyKey": receiptInput.IdempotencyKey, "commandSchemaVersion": receiptInput.CommandSchemaVersion,
		"commandSha256": receiptInput.CommandSHA256, "idempotent": executed.Existing,
		"targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value,
	}), nil
}

func enqueueFinanceInvoiceWorkflowOperationTx(ctx context.Context, tx *sql.Tx, source integrationoperation.ReceiptCommandInput, invoice map[string]any, actorUID string) (map[string]any, error) {
	invoiceCode := strings.TrimSpace(cleanStringValue(invoice["code"]))
	operationKey := "finance:invoice-request:" + invoiceCode + ":workflow-submit:v1"
	command := financeInvoiceWorkflowCommand(invoiceCode, actorUID, operationKey, invoice)
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
	createdBy := actorUID
	if createdBy == "" {
		createdBy = source.TrustedContext.ServiceClientID
	}
	result, err := tx.ExecContext(ctx, `INSERT IGNORE INTO integration_operation (
	  operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,
	  operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,
	  command_json,command_sha256,next_attempt_at,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by
	) VALUES (?,?,?,1,?,?,'finance','workflow',?,?,'invoice_request',?,?,'v1',?,?,UTC_TIMESTAMP(3),'pending',?,?,?,?,?)`,
		operationID, operationKey, operationKey, source.TrustedContext.TenantCode, source.TargetDeploymentCode,
		financeWorkflowOperationCode, financeWorkflowCapability, invoiceCode, operationKey, string(commandJSON), commandSHA,
		nullableFinanceText(source.TrustedContext.RequestID), nullableFinanceText(actorUID), nullableFinanceText(source.TrustedContext.ServiceClientID), nullableFinanceText(createdBy), nullableFinanceText(createdBy))
	if err != nil {
		return nil, err
	}
	created, _ := result.RowsAffected()
	var storedID, storedSHA, status string
	if err := tx.QueryRowContext(ctx, `SELECT operation_id,command_sha256,status FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='finance' AND operation_key=? LIMIT 1`, source.TrustedContext.TenantCode, source.TargetDeploymentCode, operationKey).Scan(&storedID, &storedSHA, &status); err != nil {
		return nil, err
	}
	if storedSHA != commandSHA {
		return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing Workflow operation has different trusted evidence")
	}
	return map[string]any{"operationId": storedID, "operationKey": operationKey, "status": status, "created": created == 1}, nil
}

func financeInvoiceWorkflowFormData(invoice map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		"code", "customer_code", "customer_name", "contract_code", "receivable_plan_code",
		"invoice_type", "invoice_medium", "invoice_item", "requested_amount", "tax_rate",
		"taxpayer_name", "taxpayer_no", "remark",
	} {
		if value, ok := invoice[key]; ok && value != nil {
			result[key] = value
		}
	}
	return result
}

func financeReceiptError(err error) error {
	switch err {
	case integrationoperation.ErrIdempotencyPayloadMismatch:
		return httperror.New(http.StatusConflict, "service_command_payload_mismatch", "service command identity was reused with different evidence")
	case integrationoperation.ErrReceiptInProgress:
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command is already processing")
	default:
		return err
	}
}

// financeInvoiceWorkflowCommand 构造发往 Workflow 的冻结命令。
//
// 命令不得携带任何以 url / uri 结尾的字段名：integrationoperation 的安全持久化
// 校验（sensitiveFieldName）按字段名后缀一律拒绝，紧随其后的
// ValidateAndDigestCommand 会直接返回 400 integration_operation_content_unsafe，
// 使这条链路永远无法成功——走查 ISSUE-B-025 在生产实测到的正是这个死锁。
// 目标页与回调地址由 Workflow 侧自行派生，与 Codocs publish 命令的既定做法一致。
//
// 抽成纯函数是为了让 ValidateSafeCommand 能直接对命令形状做契约测试，
// 不必依赖数据库事务。
func financeInvoiceWorkflowCommand(invoiceCode, actorUID, operationKey string, invoice map[string]any) map[string]any {
	return map[string]any{
		"invoiceRequestCode": invoiceCode, "actorUid": actorUID, "idempotencyKey": operationKey,
		"bizTitle": firstNonEmpty(cleanStringValue(invoice["invoice_item"]), cleanStringValue(invoice["customer_name"]), invoiceCode),
		"bizContext": map[string]any{
			"app_code": "finance", "biz_type": "invoice_request", "biz_code": invoiceCode,
			"amount": invoice["requested_amount"], "currency_code": "CNY", "contract_code": invoice["contract_code"],
			"customer_code": invoice["customer_code"],
		},
		"formData": financeInvoiceWorkflowFormData(invoice),
	}
}
