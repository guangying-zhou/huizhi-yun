package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var publishRequestTypes = map[string]bool{
	"对外发文": true,
	"部门发文": true,
	"公司发文": true,
}

var publishTargetCategories = map[string]bool{
	"company":    true,
	"department": true,
	"product":    true,
	"knowledge":  true,
	"template":   true,
}

func publishRequestExtraJSON(value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	if text, ok := value.(string); ok {
		text = strings.TrimSpace(text)
		if text == "" || text == "null" {
			return nil, nil
		}
		var decoded map[string]any
		if err := json.Unmarshal([]byte(text), &decoded); err != nil {
			return nil, httperror.New(http.StatusBadRequest, "publish_request_extra_invalid", "Publish request extra must be a JSON object")
		}
		return json.Marshal(decoded)
	}
	decoded, ok := value.(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "publish_request_extra_invalid", "Publish request extra must be a JSON object")
	}
	return json.Marshal(decoded)
}

func (a *Adapter) createPublishRequest(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	documentID := int64Value(body["document_id"])
	documentUUID := strings.TrimSpace(stringValue(body["document_uuid"]))
	reviewType := strings.TrimSpace(stringValue(body["review_type"]))
	subType := strings.TrimSpace(stringValue(body["sub_type"]))
	initiatorUID := strings.TrimSpace(stringValue(body["initiator_uid"]))
	targetCategory := strings.TrimSpace(stringValue(body["target_category"]))
	if documentID <= 0 || documentUUID == "" || !publishRequestTypes[reviewType] || !publishTargetCategories[targetCategory] {
		return nil, httperror.New(http.StatusBadRequest, "publish_request_invalid", "Publish request fields are invalid")
	}
	if initiatorUID == "" || initiatorUID != actorUID {
		return nil, httperror.New(http.StatusForbidden, "publish_request_initiator_mismatch", "Publish request initiator must match the trusted actor")
	}
	if status := strings.TrimSpace(stringValue(body["workflow_status"])); status != "" && status != "draft" {
		return nil, httperror.New(http.StatusBadRequest, "publish_request_status_invalid", "New publish requests must start as draft")
	}
	extraJSON, err := publishRequestExtraJSON(body["extra"])
	if err != nil {
		return nil, err
	}

	var documentStatus int64
	if err := a.db.QueryRowContext(ctx, `SELECT status FROM documents WHERE id=? AND uuid=? LIMIT 1`, documentID, documentUUID).Scan(&documentStatus); err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "publish_request_document_not_found", "Publish request document was not found")
	} else if err != nil {
		return nil, err
	}
	if documentStatus == 0 {
		return nil, httperror.New(http.StatusConflict, "publish_request_document_unavailable", "Publish request document is unavailable")
	}

	result, err := a.db.ExecContext(ctx, `
		INSERT INTO document_publish_requests
		  (document_id, document_uuid, review_type, sub_type, initiator_uid, target_category, extra, review_oss_path, workflow_status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
		documentID,
		documentUUID,
		reviewType,
		nullableString(subType),
		actorUID,
		targetCategory,
		nullableJSON(extraJSON),
		nullableString(strings.TrimSpace(stringValue(body["review_oss_path"]))),
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{
		"id":                   id,
		"document_uuid":        documentUUID,
		"review_type":          reviewType,
		"sub_type":             nullableString(subType),
		"initiator_uid":        actorUID,
		"target_category":      targetCategory,
		"workflow_status":      "draft",
		"workflow_instance_id": nil,
	}, nil
}

func nullableJSON(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func (a *Adapter) updateDraftPublishRequest(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishWorkflowRequestID(rawID)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	row, err := a.loadPublishWorkflowRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if actorUID != row.InitiatorUID {
		return nil, httperror.New(http.StatusForbidden, "publish_request_initiator_required", "Only the publish request initiator may update the draft")
	}
	if row.WorkflowStatus != "draft" || (row.WorkflowInstanceNo.Valid && row.WorkflowInstanceNo.String != "") {
		return nil, httperror.New(http.StatusConflict, "publish_request_not_draft", "Publish request is no longer an unbound draft")
	}

	reviewOSSPath, hasReviewOSSPath := body["review_oss_path"]
	status := strings.TrimSpace(stringValue(body["workflow_status"]))
	if status != "" && status != "cancelled" {
		return nil, httperror.New(http.StatusBadRequest, "publish_request_status_invalid", "Draft publish request may only be cancelled")
	}
	if !hasReviewOSSPath && status == "" {
		return nil, httperror.New(http.StatusBadRequest, "publish_request_update_empty", "Publish request update is empty")
	}
	if hasReviewOSSPath {
		if _, err := tx.ExecContext(ctx, `UPDATE document_publish_requests SET review_oss_path=?,updated_at=NOW() WHERE id=?`, nullableString(strings.TrimSpace(stringValue(reviewOSSPath))), row.ID); err != nil {
			return nil, err
		}
	}
	if status == "cancelled" {
		if _, err := tx.ExecContext(ctx, `UPDATE document_publish_requests SET workflow_status='cancelled',updated_at=NOW() WHERE id=? AND workflow_status='draft'`, row.ID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET readonly_flag=0,updated_at=NOW() WHERE id=? AND uuid=?`, row.DocumentID, row.DocumentUUID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": row.ID, "workflow_status": firstNonEmpty(status, "draft")}, nil
}
