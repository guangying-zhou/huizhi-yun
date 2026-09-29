package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type enterprisePlanReceiptConfig struct {
	Action, Capability, BizType string
	Command                     map[string]any
	BizCode                     func(map[string]any) string
	Replay                      func(context.Context, string) (map[string]any, error)
}

func executeEnterprisePlanReceipt(ctx context.Context, tx *sql.Tx, repo *iop.ReceiptRepository, config enterprisePlanReceiptConfig, write func(context.Context) (map[string]any, error)) (map[string]any, error) {
	if repo == nil {
		return write(ctx)
	}
	input, err := enterpriseDeliverableReceiptInput(ctx, config.Action, config.Capability, "plan-command.v1", config.Command)
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.plan." + config.Action + ".v1"
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		value, err := write(writeCtx)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: config.BizType, TargetBizCode: config.BizCode(value), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	value, ok := result.Value.(map[string]any)
	if !ok {
		if config.Replay == nil {
			return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
		}
		value, err = config.Replay(ctx, result.TargetBizCode)
		if err != nil {
			return nil, err
		}
	}
	out := make(map[string]any, len(value)+2)
	for key, item := range value {
		out[key] = item
	}
	out["receiptId"], out["idempotent"] = result.ReceiptID, result.Existing
	return out, nil
}
