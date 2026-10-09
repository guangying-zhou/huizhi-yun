package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const productFeedbackProgressOperation = "aims.altoc.product-feedback.update-progress.v1"
const productFeedbackProgressCapability = "altoc:product-feedback:update-progress"
const productFeedbackProgressSchema = "product-feedback-progress.v1"

// The caller must first authenticate the AIMS JWT and signed command context.
func receiveProductFeedbackProgress(ctx context.Context, db *sql.DB, receipt integrationoperation.ReceiptCommandInput) (integrationoperation.ReceiptExecutionResult, error) {
	empty := integrationoperation.ReceiptExecutionResult{}
	if receipt.TrustedContext.SourceApp != "aims" || receipt.TrustedContext.ServiceClientID != "aims.runtime" || receipt.TargetApp != "altoc" || receipt.OperationCode != productFeedbackProgressOperation || receipt.RequiredCapability != productFeedbackProgressCapability || receipt.CommandSchemaVersion != productFeedbackProgressSchema {
		return empty, httperror.New(http.StatusForbidden, "feedback_progress_identity_invalid", "invalid feedback progress service identity")
	}
	input, err := parseProductFeedbackProgress(receipt.Command)
	if err != nil {
		return empty, err
	}
	// Replays also recheck the current original source binding and ticket existence.
	var exists int
	err = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_ticket_product_feedback f INNER JOIN service_ticket st ON st.id=f.ticket_id WHERE st.code=? AND st.deleted_at IS NULL AND BINARY f.product_code=BINARY ? AND BINARY f.request_biz_id=BINARY ?`, input.TicketCode, input.ProductCode, input.RequestBizID).Scan(&exists)
	if err != nil {
		return empty, err
	}
	if exists != 1 {
		return empty, httperror.New(http.StatusConflict, "feedback_progress_binding_conflict", "feedback source binding is unavailable")
	}
	repository, err := integrationoperation.NewReceiptRepository(db)
	if err != nil {
		return empty, err
	}
	return repository.Execute(ctx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		applied, err := applyProductFeedbackProgressTx(ctx, tx, input)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_feedback", TargetBizCode: input.RequestBizID, HTTPStatus: 200, Value: map[string]any{"requestBizId": input.RequestBizID, "sourceRevision": input.SourceRevision, "applied": applied}}, nil
	})
}
