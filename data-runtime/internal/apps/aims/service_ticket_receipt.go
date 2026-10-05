package aims

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
	altocServiceTicketWorkItemOperation  = "altoc.service-ticket.aims-work-item.v1"
	altocServiceTicketWorkItemCapability = "aims:service-ticket:work-item:create"
)

func (a *Adapter) receiveAltocServiceTicketWorkItem(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	input, command, err := integrationoperation.ReceiptCommandFromBody(body, "aims", altocServiceTicketWorkItemOperation, altocServiceTicketWorkItemCapability)
	if err != nil {
		return nil, aimsServiceTicketReceiptError(err)
	}
	if input.TrustedContext.SourceApp != "altoc" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be altoc")
	}
	if strings.TrimSpace(fmt.Sprint(command["ticketCode"])) != strings.TrimSpace(ticketCode) || strings.TrimSpace(fmt.Sprint(body["current_user"])) == "" {
		return nil, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "service ticket command path or actor is invalid")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.createWorkItemFromServiceTicketTx(ctx, tx, ticketCode, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		workItem, _ := result["workItem"].(map[string]any)
		itemKey := strings.TrimSpace(fmt.Sprint(workItem["item_key"]))
		if itemKey == "" {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "work_item_identity_missing", "Aims work item key is required")
		}
		workItemID := strings.TrimSpace(fmt.Sprint(workItem["id"]))
		returnBody := map[string]any{}
		for key, value := range command {
			returnBody[key] = value
		}
		returnBody["status"] = workItem["status"]
		returnOperation, err := a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, workItemID, returnBody)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		result["returnOperation"] = returnOperation["serviceTicketDelivery"]
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemKey, HTTPStatus: http.StatusOK, Value: result}, nil
	})
	if err != nil {
		return nil, aimsServiceTicketReceiptError(err)
	}
	return map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded", "operationId": input.OperationID,
		"operationCode": input.OperationCode, "idempotencyKey": input.IdempotencyKey,
		"commandSchemaVersion": input.CommandSchemaVersion, "commandSha256": input.CommandSHA256,
		"idempotent": executed.Existing, "targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value,
	}, nil
}

func aimsServiceTicketReceiptError(err error) error {
	switch err {
	case integrationoperation.ErrIdempotencyPayloadMismatch:
		return httperror.New(http.StatusConflict, "service_command_payload_mismatch", "service command identity was reused with different evidence")
	case integrationoperation.ErrReceiptInProgress:
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command is already processing")
	default:
		return err
	}
}
