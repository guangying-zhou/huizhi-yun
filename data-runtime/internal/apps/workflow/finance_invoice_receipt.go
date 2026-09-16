package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	financeInvoiceWorkflowOperationCode = "finance.invoice-request.workflow-submit.v1"
	financeInvoiceWorkflowCapability    = "workflow:invoice-request:create"
	// Workflow 拥有目标页与回调地址，和 Codocs publish 一致。冻结命令不得携带
	// 任何 *Url/*Uri 字段：integrationoperation 的安全持久化校验按字段名后缀
	// 一律拒绝，命令带上它们会在 ValidateAndDigestCommand 处直接 400。
	financeInvoiceWorkflowCallback = "/finance/api/v1/finance/workflow/callback"
)

func financeInvoiceWorkflowBizPath(invoiceCode string) string {
	return "/finance/invoices/requests/" + url.PathEscape(strings.TrimSpace(invoiceCode))
}

func (a *Adapter) executeFinanceInvoiceApproval(ctx context.Context, body map[string]any) (InstanceAPIResponse, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body, "workflow", financeInvoiceWorkflowOperationCode, financeInvoiceWorkflowCapability,
	)
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "finance" {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be finance")
	}
	invoiceCode := strings.TrimSpace(fmt.Sprint(command["invoiceRequestCode"]))
	actorUID := strings.TrimSpace(fmt.Sprint(command["actorUid"]))
	if invoiceCode == "" || actorUID == "" || strings.TrimSpace(fmt.Sprint(command["idempotencyKey"])) != receiptInput.IdempotencyKey {
		return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "Finance invoice Workflow command identity is invalid")
	}
	if strings.TrimSpace(fmt.Sprint(body["current_user"])) != actorUID {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "trusted_actor_mismatch", "trusted delegated actor does not match the frozen Finance command")
	}

	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		actionDef, err := actionDefByKeyOn(ctx, tx, "finance", "invoices", "request")
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if actionDef == nil {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusNotFound, "action_def_not_found", "Finance invoice approval action is not configured")
		}
		bizContext := workflowCommandMap(command["bizContext"])
		formData := workflowCommandMap(command["formData"])
		initiatorContext := workflowCommandMap(body["initiator_context"])
		fullContext := prepareFlowContext(actorUID, initiatorContext, bizContext, invoiceCode, strings.TrimSpace(fmt.Sprint(command["bizTitle"])), "", formData)
		routes, err := matchRoutesOn(ctx, tx, actionDef.ID, fullContext)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if len(routes) == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_route_not_found", "Finance invoice approval has no matching Workflow route")
		}
		created, err := a.createInstanceTx(ctx, tx, map[string]any{
			"action_def_id": actionDef.ID, "route_id": routes[0].ID,
			"biz_id": invoiceCode, "biz_title": strings.TrimSpace(fmt.Sprint(command["bizTitle"])),
			"biz_url": financeInvoiceWorkflowBizPath(invoiceCode), "biz_context": bizContext,
			"form_data": formData, "attachments": []any{},
			"callback_url": financeInvoiceWorkflowCallback,
			"current_user": actorUID, "initiator_context": initiatorContext,
		})
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		createdData, _ := created.Data.(map[string]any)
		instanceNo := strings.TrimSpace(fmt.Sprint(createdData["instance_no"]))
		if instanceNo == "" {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_instance_identity_missing", "Workflow instance number is required")
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "workflow_instance", TargetBizCode: instanceNo, HTTPStatus: http.StatusOK,
			Value: map[string]any{"instance": createdData, "effects": created.Effects},
		}, nil
	})
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded",
		"operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode,
		"idempotencyKey": receiptInput.IdempotencyKey, "commandSchemaVersion": receiptInput.CommandSchemaVersion,
		"commandSha256": receiptInput.CommandSHA256, "idempotent": executed.Existing,
		"targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value,
	}}, nil
}

func workflowCommandMap(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func workflowServiceCommandError(err error) error {
	switch err {
	case integrationoperation.ErrIdempotencyPayloadMismatch:
		return httperror.New(http.StatusConflict, "service_command_payload_mismatch", "service command identity was reused with different evidence")
	case integrationoperation.ErrReceiptInProgress:
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command is already processing")
	default:
		return err
	}
}
