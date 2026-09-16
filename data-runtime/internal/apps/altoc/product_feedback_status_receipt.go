package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const productFeedbackStatusOperation = "aims.altoc.product-feedback.update-status.v1"
const productFeedbackStatusCapability = "altoc:product-feedback:update-status"
const productFeedbackStatusSchema = "product-feedback-status.v1"

// The caller must first authenticate the AIMS JWT and signed command context.
func receiveProductFeedbackStatus(ctx context.Context, db *sql.DB, receipt integrationoperation.ReceiptCommandInput) (integrationoperation.ReceiptExecutionResult, error) {
	empty := integrationoperation.ReceiptExecutionResult{}
	if receipt.TrustedContext.SourceApp != "aims" || receipt.TrustedContext.ServiceClientID != "aims.runtime" || receipt.TargetApp != "altoc" || receipt.OperationCode != productFeedbackStatusOperation || receipt.RequiredCapability != productFeedbackStatusCapability || receipt.CommandSchemaVersion != productFeedbackStatusSchema {
		return empty, httperror.New(http.StatusForbidden, "feedback_status_identity_invalid", "invalid feedback status service identity")
	}
	input, err := parseProductFeedbackStatus(receipt.Command)
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
		return empty, httperror.New(http.StatusConflict, "feedback_status_binding_conflict", "feedback source binding is unavailable")
	}
	repository, err := integrationoperation.NewReceiptRepository(db)
	if err != nil {
		return empty, err
	}
	return repository.Execute(ctx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		applied, err := applyProductFeedbackStatusTx(ctx, tx, input)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_feedback", TargetBizCode: input.RequestBizID, HTTPStatus: 200, Value: map[string]any{"requestBizId": input.RequestBizID, "sourceRevision": input.SourceRevision, "applied": applied}}, nil
	})
}
