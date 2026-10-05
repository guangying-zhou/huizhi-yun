package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	milestoneReceivableOperationCode      = "aims.milestone.receivable-billable.v1"
	milestoneReceivableRequiredCapability = "altoc:receivable:mark-billable"
)

func (a *Adapter) executeMilestoneReceivableBillable(ctx context.Context, rawPaymentTermID string, body map[string]any) (map[string]any, error) {
	if _, _, _, err := parseMilestoneReceivableCommand(rawPaymentTermID, body); err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := a.ExecuteMilestoneReceivableBillableInTransaction(ctx, tx, repository, rawPaymentTermID, body)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

// ExecuteMilestoneReceivableBillableInTransaction retains the original Aims receipt identity.
// The caller owns both commit and rollback, including validation failures.
func (a *Adapter) ExecuteMilestoneReceivableBillableInTransaction(ctx context.Context, tx *sql.Tx, repository *integrationoperation.ReceiptRepository, rawPaymentTermID string, body map[string]any) (map[string]any, error) {
	if tx == nil || repository == nil {
		return nil, httperror.New(503, "service_command_transaction_required", "Caller transaction and receipt repository required")
	}
	paymentTermID, receiptInput, command, err := parseMilestoneReceivableCommand(rawPaymentTermID, body)
	if err != nil {
		return nil, err
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	executed, err := repository.ExecuteInTransaction(ctx, tx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.markReceivablePlansBillableByPaymentTermTx(ctx, tx, paymentTermID, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "receivable_plan_set",
			TargetBizCode: fmt.Sprintf("payment-term:%d", paymentTermID),
			HTTPStatus:    http.StatusOK,
			Value:         result,
		}, nil
	})
	if err != nil {
		return nil, serviceCommandReceiptError(err)
	}
	return map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded",
		"operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode,
		"idempotencyKey":       receiptInput.IdempotencyKey,
		"commandSchemaVersion": receiptInput.CommandSchemaVersion,
		"commandSha256":        receiptInput.CommandSHA256,
		"idempotent":           executed.Existing,
		"targetBizType":        executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256,
		"result":                executed.Value,
	}, nil
}

func parseMilestoneReceivableCommand(rawPaymentTermID string, body map[string]any) (int64, integrationoperation.ReceiptCommandInput, map[string]any, error) {
	paymentTermID, err := strconv.ParseInt(strings.TrimSpace(rawPaymentTermID), 10, 64)
	if err != nil || paymentTermID <= 0 {
		return 0, integrationoperation.ReceiptCommandInput{}, nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTermId is required")
	}
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"altoc",
		milestoneReceivableOperationCode,
		milestoneReceivableRequiredCapability,
	)
	if err != nil {
		return 0, integrationoperation.ReceiptCommandInput{}, nil, serviceCommandReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "aims" {
		return 0, integrationoperation.ReceiptCommandInput{}, nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	commandPaymentTermID, err := positiveCommandInt64(command["paymentTermId"])
	if err != nil || commandPaymentTermID != paymentTermID {
		return 0, integrationoperation.ReceiptCommandInput{}, nil, httperror.New(http.StatusConflict, "service_command_path_mismatch", "service command payment term does not match the target path")
	}
	if strings.TrimSpace(fmt.Sprint(command["idempotencyKey"])) != receiptInput.IdempotencyKey {
		return 0, integrationoperation.ReceiptCommandInput{}, nil, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "service command idempotency identity is invalid")
	}
	return paymentTermID, receiptInput, command, nil
}

func positiveCommandInt64(value any) (int64, error) {
	parsed, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("positive command integer is required")
	}
	return parsed, nil
}
