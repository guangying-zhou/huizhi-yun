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
	paymentTermID, err := strconv.ParseInt(strings.TrimSpace(rawPaymentTermID), 10, 64)
	if err != nil || paymentTermID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTermId is required")
	}
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"altoc",
		milestoneReceivableOperationCode,
		milestoneReceivableRequiredCapability,
	)
	if err != nil {
		return nil, serviceCommandReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "aims" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	commandPaymentTermID, err := positiveCommandInt64(command["paymentTermId"])
	if err != nil || commandPaymentTermID != paymentTermID {
		return nil, httperror.New(http.StatusConflict, "service_command_path_mismatch", "service command payment term does not match the target path")
	}
	if strings.TrimSpace(fmt.Sprint(command["idempotencyKey"])) != receiptInput.IdempotencyKey {
		return nil, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "service command idempotency identity is invalid")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
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

func positiveCommandInt64(value any) (int64, error) {
	parsed, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("positive command integer is required")
	}
	return parsed, nil
}
