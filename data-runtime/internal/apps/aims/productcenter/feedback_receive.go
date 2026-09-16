package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// ReceiveFeedbackRequestTx belongs inside the target service receipt transaction.
// The service must authenticate Altoc and the frozen actor before invoking it.
// This function does not commit, issue receipts, or permit unsigned browser input.
func ReceiveFeedbackRequestTx(ctx context.Context, tx *sql.Tx, input FeedbackRequest, permit AuthorizationPermit, operationID string) (map[string]any, error) {
	if err := ValidateFeedbackRequest(input); err != nil {
		return nil, err
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, input.ProductCode, input.ActorUID, "product_requests", "create", permit); err != nil {
		return nil, err
	}
	root, err := loadWorkspace(ctx, tx, input.ProductCode)
	if err != nil {
		return nil, err
	}
	if root.Status != "active" {
		return nil, invalid("product_archived", "产品空间已归档")
	}
	var boundProduct, boundRequest string
	err = tx.QueryRowContext(ctx, `SELECT b.product_code,r.biz_id FROM product_feedback_bindings b JOIN product_requests r ON r.id=b.request_id AND r.product_code=b.product_code JOIN product_request_sources s ON s.id=b.source_id AND s.request_id=b.request_id WHERE b.source_app='altoc' AND b.source_type='service_ticket' AND b.source_biz_id=? FOR UPDATE`, input.TicketCode).Scan(&boundProduct, &boundRequest)
	if err == nil {
		if boundProduct != input.ProductCode || boundRequest != input.RequestBizID {
			return nil, invalid("product_feedback_binding_conflict", "反馈来源已绑定其他需求或产品")
		}
		return map[string]any{"biz_id": boundRequest, "product_code": boundProduct}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,decision_status,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,'customer','P2','submitted',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, input.RequestBizID, input.ProductCode, input.Title, input.Description, input.ActorUID, input.ActorUID)
	if err != nil {
		return nil, err
	}
	requestID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	result, err = tx.ExecContext(ctx, `INSERT INTO product_request_sources(request_id,source_app,source_type,source_biz_id,source_note,evidence_kind,direction,verification_status,revision,created_by,updated_by,created_at,updated_at) VALUES(?,'altoc','service_ticket',?,?,'fact','neutral','verified',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, requestID, input.TicketCode, input.Title, input.ActorUID, input.ActorUID)
	if err != nil {
		return nil, err
	}
	sourceID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) VALUES('altoc','service_ticket',?,?,?,?,?,UTC_TIMESTAMP(3))`, input.TicketCode, input.ProductCode, requestID, sourceID, input.ActorUID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, input.ActorUID, input.ProductCode); err != nil {
		return nil, err
	}
	changes, _ := json.Marshal(map[string]any{"after": map[string]any{"biz_id": input.RequestBizID, "source_type": "customer"}})
	if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'request',?,'create-from-feedback',?,1,?,?,UTC_TIMESTAMP(3))`, input.ProductCode, input.RequestBizID, input.ActorUID, changes, operationID); err != nil {
		return nil, err
	}
	return map[string]any{"biz_id": input.RequestBizID, "product_code": input.ProductCode}, nil
}
