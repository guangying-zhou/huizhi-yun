package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ProductFeedbackStatus struct {
	TicketCode            string `json:"ticketCode"`
	ProductCode           string `json:"productCode"`
	RequestBizID          string `json:"requestBizId"`
	CanonicalRequestBizID string `json:"canonicalRequestBizId"`
	DecisionStatus        string `json:"decisionStatus"`
	SourceRevision        uint64 `json:"sourceRevision"`
}

// Called only inside a verified AIMS service receipt transaction. This function
// updates a projection, never the operational ticket or its original submission.
func applyProductFeedbackStatusTx(ctx context.Context, tx *sql.Tx, input ProductFeedbackStatus) (bool, error) {
	if input.SourceRevision == 0 || input.SourceRevision > 9007199254740991 || !integrationoperation.IsValidOperationID(input.RequestBizID) || !integrationoperation.IsValidOperationID(input.CanonicalRequestBizID) {
		return false, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "feedback identity and revision are required")
	}
	switch input.DecisionStatus {
	case "submitted", "evaluating", "accepted", "deferred", "rejected", "merged":
	default:
		return false, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "invalid product decision")
	}
	if (input.DecisionStatus == "merged") != (input.RequestBizID != input.CanonicalRequestBizID) {
		return false, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "canonical request does not match decision")
	}
	for key, value := range map[string]string{"ticketCode": input.TicketCode, "productCode": input.ProductCode} {
		limit := 64
		if key == "ticketCode" {
			limit = 30
		}
		if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) || strings.ContainsAny(value, `/\`) {
			return false, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "invalid feedback source identifier")
		}
	}
	hash, err := integrationoperation.ValidateAndDigestCommand(map[string]any{"ticketCode": input.TicketCode, "productCode": input.ProductCode, "requestBizId": input.RequestBizID, "canonicalRequestBizId": input.CanonicalRequestBizID, "decisionStatus": input.DecisionStatus, "sourceRevision": input.SourceRevision})
	if err != nil {
		return false, err
	}
	var ticketID int64
	var requestID, product string
	err = tx.QueryRowContext(ctx, `SELECT f.ticket_id,f.request_biz_id,f.product_code FROM service_ticket_product_feedback f INNER JOIN service_ticket st ON st.id=f.ticket_id WHERE st.code=? AND st.deleted_at IS NULL FOR UPDATE`, input.TicketCode).Scan(&ticketID, &requestID, &product)
	if err == sql.ErrNoRows {
		return false, httperror.New(http.StatusConflict, "feedback_submission_missing", "feedback submission is not available")
	}
	if err != nil {
		return false, err
	}
	if requestID != input.RequestBizID || product != input.ProductCode {
		return false, httperror.New(http.StatusConflict, "feedback_status_binding_conflict", "feedback does not match original submission")
	}
	var revision uint64
	var storedHash string
	err = tx.QueryRowContext(ctx, `SELECT source_revision,command_sha256 FROM product_feedback_status_projection WHERE ticket_id=? FOR UPDATE`, ticketID).Scan(&revision, &storedHash)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if err == nil {
		if input.SourceRevision < revision {
			return false, nil
		}
		if input.SourceRevision == revision {
			if hash != storedHash {
				return false, httperror.New(http.StatusConflict, "feedback_status_revision_conflict", "same feedback revision has different content")
			}
			return false, nil
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO product_feedback_status_projection(ticket_id,source_revision,command_sha256,canonical_request_biz_id,decision_status) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE source_revision=VALUES(source_revision),command_sha256=VALUES(command_sha256),canonical_request_biz_id=VALUES(canonical_request_biz_id),decision_status=VALUES(decision_status),updated_at=UTC_TIMESTAMP(3)`, ticketID, input.SourceRevision, hash, input.CanonicalRequestBizID, input.DecisionStatus)
	return err == nil, err
}

// Decode the exact frozen command before any authenticated receipt is executed.
func parseProductFeedbackStatus(raw []byte) (ProductFeedbackStatus, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return ProductFeedbackStatus{}, err
	}
	keys := []string{"ticketCode", "productCode", "requestBizId", "canonicalRequestBizId", "decisionStatus", "sourceRevision"}
	if len(fields) != len(keys) {
		return ProductFeedbackStatus{}, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "exact feedback status fields are required")
	}
	for _, key := range keys {
		if value, ok := fields[key]; !ok || string(value) == "null" {
			return ProductFeedbackStatus{}, httperror.New(http.StatusBadRequest, "feedback_status_invalid", "feedback status fields cannot be omitted or null")
		}
	}
	var input ProductFeedbackStatus
	if err := json.Unmarshal(raw, &input); err != nil {
		return input, err
	}
	return input, nil
}
