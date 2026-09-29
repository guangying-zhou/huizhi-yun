package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type legacyWorkItemReceiptConfig[T any] struct {
	Action, Capability, BizType string
	Command                     map[string]any
	BizCode                     func(T) string
	Replay                      func(context.Context, string) (T, error)
	Decorate                    func(T, string, bool) T
	BeforeReplay                func(context.Context) error
}

func executeLegacyWorkItemReceipt[T any](ctx context.Context, tx *sql.Tx, repo *iop.ReceiptRepository, config legacyWorkItemReceiptConfig[T], write func(context.Context) (T, error)) (T, error) {
	var zero T
	if config.BeforeReplay != nil {
		if err := config.BeforeReplay(ctx); err != nil {
			return zero, err
		}
	}
	if repo == nil {
		return write(ctx)
	}
	input, err := enterpriseDeliverableReceiptInput(ctx, config.Action, config.Capability, "legacy-work-item.v1", config.Command)
	if err != nil {
		return zero, err
	}
	input.OperationCode = "enterprise.aims.work-items." + config.Action + ".v1"
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		value, err := write(writeCtx)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: config.BizType, TargetBizCode: config.BizCode(value), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return zero, aimsContractActivationReceiptError(err)
	}
	value, ok := result.Value.(T)
	if !ok {
		if config.Replay == nil {
			return zero, httperror.New(503, "work_item_receipt_corrupt", "Work item receipt is invalid")
		}
		value, err = config.Replay(ctx, result.TargetBizCode)
		if err != nil {
			return zero, err
		}
	}
	return config.Decorate(value, result.ReceiptID, result.Existing), nil
}

func decorateLegacyWorkItemMap(value map[string]any, receipt string, existing bool) map[string]any {
	out := make(map[string]any, len(value)+2)
	for key, item := range value {
		out[key] = item
	}
	out["receiptId"], out["idempotent"] = receipt, existing
	return out
}
