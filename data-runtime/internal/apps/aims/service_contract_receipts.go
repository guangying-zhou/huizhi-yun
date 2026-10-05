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
	if _, _, err := parseAimsServiceReceipt(body, contractActivationProjectOperation, contractActivationAimsCapability); err != nil {
		return nil, err
	}
	return a.withContractReceiptTransaction(ctx, func(tx *sql.Tx, repository *integrationoperation.ReceiptRepository) (map[string]any, error) {
		return a.CreateProjectFromContractCommandInTransaction(ctx, tx, repository, body)
	})
}

// CreateProjectFromContractCommandInTransaction preserves the original receipt identity; success leaves commit to the caller.
func (a *Adapter) CreateProjectFromContractCommandInTransaction(ctx context.Context, tx *sql.Tx, repository *integrationoperation.ReceiptRepository, body map[string]any) (map[string]any, error) {
	return a.executeAimsServiceReceiptInTransaction(ctx, tx, repository, body, contractActivationProjectOperation, contractActivationAimsCapability, func(ctx context.Context, tx *sql.Tx, command map[string]any) (map[string]any, string, string, error) {
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
	if _, _, err := parseAimsServiceReceipt(body, contractActivationMilestoneOperation, contractActivationAimsCapability, contractProjectPathValidator(projectCode)); err != nil {
		return nil, err
	}
	return a.withContractReceiptTransaction(ctx, func(tx *sql.Tx, repository *integrationoperation.ReceiptRepository) (map[string]any, error) {
		return a.SyncPaymentMilestonesCommandInTransaction(ctx, tx, repository, projectCode, body)
	})
}

// SyncPaymentMilestonesCommandInTransaction shares the caller transaction and original path validation.
func (a *Adapter) SyncPaymentMilestonesCommandInTransaction(ctx context.Context, tx *sql.Tx, repository *integrationoperation.ReceiptRepository, projectCode string, body map[string]any) (map[string]any, error) {
	return a.executeAimsServiceReceiptInTransaction(ctx, tx, repository, body, contractActivationMilestoneOperation, contractActivationAimsCapability, func(ctx context.Context, tx *sql.Tx, command map[string]any) (map[string]any, string, string, error) {
		result, err := a.syncPaymentMilestonesTx(ctx, tx, projectCode, command)
		return result, "project_milestones", projectCode, err
	}, contractProjectPathValidator(projectCode))
}

type contractActivationReceiptHandler func(context.Context, *sql.Tx, map[string]any) (map[string]any, string, string, error)

func (a *Adapter) executeAimsServiceReceipt(ctx context.Context, body map[string]any, operationCode, capability string, handler contractActivationReceiptHandler) (map[string]any, error) {
	if _, _, err := parseAimsServiceReceipt(body, operationCode, capability); err != nil {
		return nil, err
	}
	return a.withContractReceiptTransaction(ctx, func(tx *sql.Tx, repo *integrationoperation.ReceiptRepository) (map[string]any, error) {
		return a.executeAimsServiceReceiptInTransaction(ctx, tx, repo, body, operationCode, capability, handler)
	})
}

func (a *Adapter) withContractReceiptTransaction(ctx context.Context, apply func(*sql.Tx, *integrationoperation.ReceiptRepository) (map[string]any, error)) (map[string]any, error) {
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := apply(tx, repository)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) executeAimsServiceReceiptInTransaction(ctx context.Context, tx *sql.Tx, repository *integrationoperation.ReceiptRepository, body map[string]any, operationCode string, capability string, handler contractActivationReceiptHandler, validate ...func(map[string]any) error) (out map[string]any, err error) {
	if tx == nil || repository == nil {
		return nil, httperror.New(503, "service_command_transaction_required", "Caller transaction and receipt repository required")
	}

	receiptInput, command, err := parseAimsServiceReceipt(body, operationCode, capability, validate...)
	if err != nil {
		return nil, err
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	executed, err := repository.ExecuteInTransaction(ctx, tx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
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

func parseAimsServiceReceipt(body map[string]any, operationCode, capability string, validate ...func(map[string]any) error) (integrationoperation.ReceiptCommandInput, map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "aims", operationCode, capability)
	if err != nil {
		return integrationoperation.ReceiptCommandInput{}, nil, aimsContractActivationReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "altoc" {
		return integrationoperation.ReceiptCommandInput{}, nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be altoc")
	}
	// Validate the frozen command/path even when an existing receipt skips mutation.
	for _, check := range validate {
		if err = check(command); err != nil {
			return integrationoperation.ReceiptCommandInput{}, nil, err
		}
	}
	return receiptInput, command, nil
}
func contractProjectPathValidator(projectCode string) func(map[string]any) error {
	return func(command map[string]any) error {
		if firstBodyText(command, "projectCode", "project_code") != strings.TrimSpace(projectCode) {
			return httperror.New(http.StatusConflict, "service_command_path_mismatch", "service command project does not match target path")
		}
		return nil
	}
}
