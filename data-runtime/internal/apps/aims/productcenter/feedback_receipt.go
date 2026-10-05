package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Called only after the service boundary verifies JWT, signed delegation and
// exact capability. Current product authorization is checked even on replay.
func ReceiveFeedbackWithReceipt(ctx context.Context, db *sql.DB, receipt integrationoperation.ReceiptCommandInput, permit AuthorizationPermit) (integrationoperation.ReceiptExecutionResult, error) {
	empty := integrationoperation.ReceiptExecutionResult{}
	if receipt.TrustedContext.SourceApp != "altoc" || receipt.TargetApp != "aims" || receipt.OperationCode != "altoc.aims.product-request.create-from-feedback.v1" || receipt.RequiredCapability != "aims:product-request:create-from-feedback" || receipt.CommandSchemaVersion != "product-feedback-create.v1" {
		return empty, invalid("product_feedback_command_invalid", "客户反馈服务身份无效")
	}
	var command map[string]any
	if err := json.Unmarshal(receipt.Command, &command); err != nil {
		return empty, err
	}
	input, err := ParseFeedbackRequest(command)
	if err != nil {
		return empty, err
	}
	if receipt.OriginalActorUID != input.ActorUID {
		return empty, invalid("product_feedback_actor_invalid", "反馈原操作者不一致")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return empty, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, input.ProductCode, input.ActorUID, "product_requests", "create", permit); err != nil {
		tx.Rollback()
		return empty, err
	}
	root, err := loadWorkspace(ctx, tx, input.ProductCode)
	if err != nil {
		tx.Rollback()
		return empty, err
	}
	if root.Status != "active" {
		tx.Rollback()
		return empty, invalid("product_archived", "产品空间已归档")
	}
	if err = tx.Commit(); err != nil {
		return empty, err
	}
	repository, err := integrationoperation.NewReceiptRepository(db)
	if err != nil {
		return empty, err
	}
	return repository.Execute(ctx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		value, err := ReceiveFeedbackRequestTx(ctx, tx, input, permit, receipt.OperationID)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_request", TargetBizCode: input.RequestBizID, HTTPStatus: 200, Value: value}, nil
	})
}
