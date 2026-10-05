package altoc

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Caller owns the verified receipt transaction. Lock the original submission,
// serialize first inserts and revisions, and never modify the service ticket.
func applyProductFeedbackProgressTx(ctx context.Context, tx *sql.Tx, input ProductFeedbackProgress) (bool, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return false, err
	}
	if _, err := parseProductFeedbackProgress(raw); err != nil {
		return false, err
	}
	var command map[string]any
	if err := json.Unmarshal(raw, &command); err != nil {
		return false, err
	}
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return false, err
	}
	var ticketID int64
	var requestID, product string
	err = tx.QueryRowContext(ctx, `SELECT f.ticket_id,f.request_biz_id,f.product_code FROM service_ticket_product_feedback f INNER JOIN service_ticket st ON st.id=f.ticket_id WHERE st.code=? AND st.deleted_at IS NULL FOR UPDATE`, input.TicketCode).Scan(&ticketID, &requestID, &product)
	if err == sql.ErrNoRows {
		return false, httperror.New(409, "feedback_submission_missing", "Feedback submission is unavailable")
	}
	if err != nil {
		return false, err
	}
	if requestID != input.RequestBizID || product != input.ProductCode {
		return false, httperror.New(409, "feedback_progress_binding_conflict", "Feedback does not match original submission")
	}
	var revision uint64
	var storedHash string
	err = tx.QueryRowContext(ctx, `SELECT source_revision,command_sha256 FROM product_feedback_progress_projection WHERE ticket_id=? FOR UPDATE`, ticketID).Scan(&revision, &storedHash)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if err == nil {
		if input.SourceRevision < revision {
			return false, nil
		}
		if input.SourceRevision == revision {
			if hash != storedHash {
				return false, httperror.New(409, "feedback_progress_revision_conflict", "Same progress revision has different content")
			}
			return false, nil
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO product_feedback_progress_projection(ticket_id,source_revision,command_sha256,snapshot_json) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE source_revision=VALUES(source_revision),command_sha256=VALUES(command_sha256),snapshot_json=VALUES(snapshot_json),updated_at=UTC_TIMESTAMP(3)`, ticketID, input.SourceRevision, hash, string(raw))
	return err == nil, err
}
