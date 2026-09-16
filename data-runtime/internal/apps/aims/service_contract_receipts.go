package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	contractActivationProjectOperation   = "altoc.contract-activation.aims-project.v1"
	contractActivationMilestoneOperation = "altoc.contract-activation.aims-milestones.v1"
	contractActivationAimsCapability     = "aims:write"
)

func (a *Adapter) createProjectFromContractCommand(ctx context.Context, body map[string]any) (map[string]any, error) {
	if _, ok := body[integrationoperation.ServiceCommandEnvelopeKey]; !ok {
		return a.createProjectFromContract(ctx, body)
	}
	return a.executeAimsServiceReceipt(ctx, body, contractActivationProjectOperation, contractActivationAimsCapability, func(ctx context.Context, tx *sql.Tx, command map[string]any) (map[string]any, string, string, error) {
		result, err := a.createProjectFromContractTx(ctx, tx, command)
		if err != nil {
			return nil, "", "", err
		}
		project, _ := result["project"].(map[string]any)
		projectCode := strings.TrimSpace(fmt.Sprint(project["project_code"]))
		if projectCode == "" || projectCode == "<nil>" {
			return nil, "", "", httperror.New(http.StatusUnprocessableEntity, "project_code_missing", "created project did not return project_code")
		}
		return result, "project", projectCode, nil
	})
}

func (a *Adapter) syncPaymentMilestonesCommand(ctx context.Context, projectCode string, body map[string]any) (map[string]any, error) {
	if _, ok := body[integrationoperation.ServiceCommandEnvelopeKey]; !ok {
		return a.syncPaymentMilestones(ctx, projectCode, body)
	}
	return a.executeAimsServiceReceipt(ctx, body, contractActivationMilestoneOperation, contractActivationAimsCapability, func(ctx context.Context, tx *sql.Tx, command map[string]any) (map[string]any, string, string, error) {
		commandProjectCode := firstBodyText(command, "projectCode", "project_code")
		if commandProjectCode != strings.TrimSpace(projectCode) {
			return nil, "", "", httperror.New(http.StatusConflict, "service_command_path_mismatch", "service command project does not match target path")
		}
		result, err := a.syncPaymentMilestonesTx(ctx, tx, projectCode, command)
		return result, "project_milestones", projectCode, err
	})
}

type contractActivationReceiptHandler func(context.Context, *sql.Tx, map[string]any) (map[string]any, string, string, error)

func (a *Adapter) executeAimsServiceReceipt(ctx context.Context, body map[string]any, operationCode string, capability string, handler contractActivationReceiptHandler) (map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "aims", operationCode, capability)
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "altoc" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be altoc")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, targetType, targetCode, err := handler(ctx, tx, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: targetType, TargetBizCode: targetCode, HTTPStatus: http.StatusOK, Value: result}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	return map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded",
		"operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode,
		"idempotencyKey": receiptInput.IdempotencyKey, "commandSchemaVersion": receiptInput.CommandSchemaVersion,
		"commandSha256": receiptInput.CommandSHA256, "idempotent": executed.Existing,
		"targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value,
	}, nil
}

func aimsContractActivationReceiptError(err error) error {
	switch {
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "service command identity or payload does not match the existing receipt")
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command receipt is still processing")
	case errors.Is(err, integrationoperation.ErrReceiptRejected):
		return httperror.New(http.StatusConflict, "service_command_rejected", "service command receipt was rejected")
	default:
		return err
	}
}
