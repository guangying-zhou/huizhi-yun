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

// Review and publish-request reads share the same trusted actor and
// document-bound projection boundary. Keep them together so routes cannot
// accidentally bypass the ACL/projection finalizers below.
func requireTrustedReviewActor(query url.Values) (string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	return actorUID, nil
}

func (a *Adapter) myReviews(ctx context.Context, query url.Values) ([]map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}

	kind := firstNonEmpty(query.Get("type"), "initiated")
	limit := positiveInt(firstNonEmpty(query.Get("limit"), "500"), 500)
	if limit > 1000 {
		limit = 1000
	}

	var rows *sql.Rows
	switch kind {
	case "pending":
		rows, err = a.db.QueryContext(ctx, `
			SELECT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			WHERE r.status = 'in_progress'
			  AND JSON_CONTAINS(
			    JSON_EXTRACT(r.flow_snapshot, CONCAT('$[', r.current_node, '].reviewers')),
			    JSON_QUOTE(?)
			  )
			ORDER BY r.created_at DESC
			LIMIT ?`, actorUID, limit)
	case "completed":
		rows, err = a.db.QueryContext(ctx, `
			SELECT DISTINCT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			LEFT JOIN review_actions a ON r.id = a.review_id
			WHERE r.status IN ('approved', 'rejected', 'archived')
			  AND (r.initiator_uid = ? OR a.actor_uid = ?)
			ORDER BY r.updated_at DESC
			LIMIT ?`, actorUID, actorUID, limit)
	default:
		rows, err = a.db.QueryContext(ctx, `
			SELECT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			WHERE r.initiator_uid = ?
			ORDER BY r.created_at DESC
			LIMIT ?`, actorUID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		normalizeReviewJSON(item)
	}
	return items, nil
}

func (a *Adapter) reviewDetail(ctx context.Context, id string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(id) == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_review", "Review id is required")
	}
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}

	publishRequest, err := a.firstRow(ctx, `
		SELECT `+publishRequestReadColumns+`
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE pr.id = ?
		LIMIT 1`, id)
	if err != nil {
		return nil, err
	}

	review, err := a.firstRow(ctx, `
		SELECT r.*, d.title AS document_title, d.doc_type, d.oss_path,
		       d.owner_uid AS document_owner_uid, d.status AS document_status
		FROM document_reviews r
		LEFT JOIN documents d ON r.document_id = d.id
		WHERE r.id = ?
		LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	if publishRequest != nil && review != nil {
		return nil, httperror.New(http.StatusConflict, "review_source_ambiguous", "Review id exists in multiple review sources; use the publish request endpoint")
	}
	if publishRequest != nil {
		return a.finalizePublishRequestRead(ctx, publishRequest, actorUID)
	}
	if review == nil {
		return nil, httperror.New(http.StatusNotFound, "review_not_found", "Review not found")
	}
	return a.finalizeLegacyReviewRead(ctx, review, actorUID)
}

func stripReviewAuthorizationFields(review map[string]any) {
	delete(review, "document_owner_uid")
	delete(review, "document_status")
	delete(review, "publish_request_record")
	delete(review, "review_record_source")
}

func (a *Adapter) finalizeLegacyReviewRead(ctx context.Context, review map[string]any, actorUID string) (map[string]any, error) {
	if err := a.requireReviewDetailAccess(ctx, review, actorUID, true); err != nil {
		return nil, err
	}
	stripReviewAuthorizationFields(review)
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) finalizePublishRequestRead(ctx context.Context, request map[string]any, actorUID string) (map[string]any, error) {
	normalizePublishRequestReview(request)
	if err := a.requirePublishRequestReadAccess(ctx, request, actorUID); err != nil {
		return nil, err
	}
	stripReviewAuthorizationFields(request)
	request["review_record_source"] = "publish_request"
	result, err := a.enrichReviewRecord(ctx, request)
	delete(request, "review_record_source")
	return result, err
}

func (a *Adapter) requireReviewDetailAccess(ctx context.Context, review map[string]any, actorUID string, allowLegacyParticipants bool) error {
	actorUID = strings.TrimSpace(actorUID)
	if actorUID == "" {
		return httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if actorUID == stringValue(review["initiator_uid"]) {
		return nil
	}

	if allowLegacyParticipants {
		flowSnapshot := jsonArrayValue(review["flow_snapshot"])
		if currentReviewNodeIncludes(flowSnapshot, review["current_node"], actorUID) {
			return nil
		}
		participated, err := a.reviewActionActorExists(ctx, stringValue(review["id"]), actorUID)
		if err != nil {
			return err
		}
		if participated {
			return nil
		}
	}

	allowed, err := a.reviewDocumentReadAllowed(ctx, review, actorUID)
	if err != nil {
		return err
	}
	if !allowed {
		return httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
	}
	return nil
}

func (a *Adapter) reviewActionActorExists(ctx context.Context, reviewID string, actorUID string) (bool, error) {
	if reviewID == "" {
		return false, nil
	}
	var found int
	err := a.db.QueryRowContext(ctx, `
		SELECT 1
		FROM review_actions
		WHERE review_id = ? AND actor_uid = ?
		LIMIT 1`, reviewID, actorUID).Scan(&found)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Publish requests use Workflow for current approvers. Until Workflow exposes a
// signed participant-read contract, Codocs only recognizes local, completed
// execution participants (seal/send) in addition to the initiator and current
// document read ACL. Do not infer current Workflow participants from client data.
func (a *Adapter) requirePublishRequestReadAccess(ctx context.Context, request map[string]any, actorUID string) error {
	actorUID = strings.TrimSpace(actorUID)
	if actorUID == "" {
		return httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if actorUID == stringValue(request["initiator_uid"]) {
		return nil
	}
	participated, err := a.publishRequestHistoricalParticipantExists(
		ctx,
		stringValue(request["id"]),
		firstNonEmpty(stringValue(request["published_document_uuid"]), stringValue(request["document_uuid"])),
		actorUID,
	)
	if err != nil {
		return err
	}
	if participated {
		return nil
	}
	allowed, err := a.reviewDocumentReadAllowed(ctx, request, actorUID)
	if err != nil {
		return err
	}
	if !allowed {
		return httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
	}
	return nil
}

func (a *Adapter) publishRequestHistoricalParticipantExists(ctx context.Context, requestID string, documentUUID string, actorUID string) (bool, error) {
	if requestID == "" || documentUUID == "" || actorUID == "" {
		return false, nil
	}
	for _, participant := range []struct {
		table  string
		column string
	}{
		{table: "document_seal_records", column: "operator_uid"},
		{table: "document_send_records", column: "sender_uid"},
	} {
		exists, err := a.tableExists(ctx, participant.table)
		if err != nil {
			return false, err
		}
		if !exists {
			continue
		}
		var found int
		query := "SELECT 1 FROM " + participant.table + " WHERE review_id = ? AND document_uuid = ? AND " + participant.column + " = ? LIMIT 1"
		err = a.db.QueryRowContext(ctx, query, requestID, documentUUID, actorUID).Scan(&found)
		if err == nil {
			return true, nil
		}
		if err != sql.ErrNoRows {
			return false, err
		}
	}
	return false, nil
}

func (a *Adapter) reviewDocumentReadAllowed(ctx context.Context, review map[string]any, actorUID string) (bool, error) {
	documentID := int64Value(review["document_id"])
	if documentID <= 0 || int64Value(review["document_status"]) == 0 {
		return false, nil
	}
	if actorUID == stringValue(review["document_owner_uid"]) {
		return true, nil
	}
	permission, err := a.sharePermission(ctx, documentID, actorUID)
	if err != nil {
		return false, err
	}
	if permission != "" {
		return true, nil
	}
	return a.relationCanRead(ctx, documentID, actorUID)
}

const publishRequestReadColumns = `
  pr.id, pr.document_id, pr.document_uuid, pr.review_type, pr.sub_type,
  pr.initiator_uid, pr.target_category, pr.extra, pr.review_oss_path,
  pr.workflow_instance_id, pr.workflow_instance_no, pr.workflow_status,
  pr.archive_oss_path, pr.execution_status, pr.published_document_uuid,
  pr.sealed_at, pr.sent_at, pr.received_at, pr.created_at, pr.updated_at,
  d.title AS document_title, d.doc_type, d.oss_path, d.dept_code,
  d.owner_uid AS document_owner_uid, d.status AS document_status`

func (a *Adapter) publishRequestDetail(ctx context.Context, id string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(id) == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_review", "Publish request id is required")
	}
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	request, err := a.firstRow(ctx, `SELECT `+publishRequestReadColumns+`
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE pr.id = ?
		LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, httperror.New(http.StatusNotFound, "review_not_found", "Publish request not found")
	}
	return a.finalizePublishRequestRead(ctx, request, actorUID)
}

func (a *Adapter) publishRequestsList(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	where, args, err := a.publishRequestReadPredicate(ctx, actorUID)
	if err != nil {
		return nil, err
	}
	if documentUUID := strings.TrimSpace(query.Get("document_uuid")); documentUUID != "" {
		where = "(" + where + ") AND pr.document_uuid = ?"
		args = append(args, documentUUID)
	}
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 50)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	var total int64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT `+publishRequestReadColumns+`
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE `+where+`
		ORDER BY pr.updated_at DESC, pr.id DESC
		LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		// The SQL predicate is the list boundary; this finalizer keeps the
		// detail and list responses on the same projection/field contract.
		normalizePublishRequestReview(item)
		stripReviewAuthorizationFields(item)
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	}, nil
}

func (a *Adapter) publishRequestReadPredicate(ctx context.Context, actorUID string) (string, []any, error) {
	clauses := []string{"pr.initiator_uid = ?"}
	args := []any{actorUID}

	for _, participant := range []struct {
		table  string
		column string
	}{
		{table: "document_seal_records", column: "operator_uid"},
		{table: "document_send_records", column: "sender_uid"},
	} {
		exists, err := a.tableExists(ctx, participant.table)
		if err != nil {
			return "", nil, err
		}
		if exists {
			clauses = append(clauses, "EXISTS (SELECT 1 FROM "+participant.table+" participant WHERE participant.review_id = pr.id AND participant.document_uuid = pr.published_document_uuid AND participant."+participant.column+" = ?)")
			args = append(args, actorUID)
		}
	}

	documentReadClause := `(d.id IS NOT NULL AND d.status <> 0 AND (
  d.owner_uid = ?
  OR EXISTS (
    SELECT 1 FROM document_shares visible_share
    WHERE visible_share.document_id = d.id AND visible_share.shared_to_uid = ?
  )
  OR EXISTS (
    SELECT 1 FROM document_relations visible_relation
    WHERE visible_relation.document_id = d.id
      AND visible_relation.related_uid = ?
      AND visible_relation.status = 1
      AND visible_relation.can_read = 1
      AND (visible_relation.source_type <> 'project_preview_access' OR visible_relation.updated_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR))
  )
))`
	clauses = append(clauses, documentReadClause)
	args = append(args, actorUID, actorUID, actorUID)
	return "(" + strings.Join(clauses, " OR ") + ")", args, nil
}

func (a *Adapter) reviewByDocument(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}

	publishRequest, err := a.firstRow(ctx, `
		SELECT `+publishRequestReadColumns+`,
		       CASE WHEN pr.archive_oss_path IS NULL THEN pr.workflow_status ELSE 'archived' END AS status,
		       JSON_ARRAY() AS flow_snapshot
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE pr.document_uuid = ?
		ORDER BY pr.created_at DESC
		LIMIT 1`, uuid)
	if err != nil {
		return nil, err
	}
	if publishRequest != nil {
		return a.finalizePublishRequestRead(ctx, publishRequest, actorUID)
	}

	review, err := a.firstRow(ctx, `
		SELECT r.*, d.title AS document_title, d.doc_type, d.oss_path, d.dept_code,
		       d.owner_uid AS document_owner_uid, d.status AS document_status
		FROM document_reviews r
		LEFT JOIN documents d ON r.document_id = d.id
		WHERE r.document_uuid = ?
		ORDER BY r.created_at DESC
		LIMIT 1`, uuid)
	if err != nil || review == nil {
		return review, err
	}
	return a.finalizeLegacyReviewRead(ctx, review, actorUID)
}

func (a *Adapter) reviewByOssPath(ctx context.Context, query url.Values) (map[string]any, error) {
	ossPath := strings.TrimSpace(query.Get("path"))
	if ossPath == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_path", "OSS path is required")
	}
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}

	archiveDoc, err := a.firstRow(ctx, "SELECT id, uuid, title FROM documents WHERE oss_path = ? AND status = 2 LIMIT 1", ossPath)
	if err != nil || archiveDoc == nil {
		return archiveDoc, err
	}

	if review, err := a.reviewByArchivePath(ctx, ossPath); err != nil || review != nil {
		if err != nil || review == nil {
			return review, err
		}
		return a.finalizeArchiveReviewRead(ctx, review, actorUID)
	}
	if review, err := a.reviewByArchiveUUID(ctx, stringValue(archiveDoc["uuid"])); err != nil || review != nil {
		if err != nil || review == nil {
			return review, err
		}
		return a.finalizeArchiveReviewRead(ctx, review, actorUID)
	}
	if strings.HasPrefix(ossPath, "codocs/company/") && query.Get(quickPublishHistoryTrustedQueryKey) == "1" {
		if record, err := a.quickPublishHistoryByPath(ctx, query, ossPath, stringValue(archiveDoc["uuid"])); err != nil || record != nil {
			return record, err
		}
	}
	return nil, httperror.New(http.StatusNotFound, "review_not_found", "Archive review mapping not found")
}

func (a *Adapter) finalizeArchiveReviewRead(ctx context.Context, review map[string]any, actorUID string) (map[string]any, error) {
	if boolValue(review["publish_request_record"]) {
		return a.finalizePublishRequestRead(ctx, review, actorUID)
	}
	return a.finalizeLegacyReviewRead(ctx, review, actorUID)
}

func (a *Adapter) reviewByArchivePath(ctx context.Context, ossPath string) (map[string]any, error) {
	publishRequest, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, 'archived' AS status, r.execution_status, r.published_document_uuid,
		       JSON_ARRAY() AS flow_snapshot, r.created_at, r.updated_at, d.title AS source_title,
		       r.document_id, d.owner_uid AS document_owner_uid, d.status AS document_status,
		       1 AS publish_request_record
		FROM document_publish_requests r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE r.archive_oss_path = ?
		ORDER BY r.updated_at DESC
		LIMIT 1`, ossPath)
	if err != nil || publishRequest != nil {
		if publishRequest != nil {
			normalizePublishRequestReview(publishRequest)
			return publishRequest, nil
		}
		return nil, err
	}

	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at, d.title AS source_title,
		       r.document_id, d.owner_uid AS document_owner_uid, d.status AS document_status
		FROM document_reviews r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE r.archive_oss_path = ? AND r.status = 'archived'
		ORDER BY r.updated_at DESC
		LIMIT 1`, ossPath)
	if err != nil || review == nil {
		return review, err
	}
	return review, nil
}

func (a *Adapter) reviewByArchiveUUID(ctx context.Context, archiveUUID string) (map[string]any, error) {
	if archiveUUID == "" {
		return nil, nil
	}
	sourceDoc, err := a.firstRow(ctx, `
		SELECT id, uuid, title, owner_uid AS document_owner_uid, status AS document_status
		FROM documents
		WHERE publish_info LIKE ? AND status != 0
		ORDER BY updated_at DESC
		LIMIT 1`, "%"+archiveUUID+"%")
	if err != nil || sourceDoc == nil {
		return nil, err
	}

	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at, r.document_id
		FROM document_reviews r
		WHERE r.document_uuid = ? AND r.status = 'archived'
		ORDER BY r.updated_at DESC
		LIMIT 1`, sourceDoc["uuid"])
	if err != nil || review == nil {
		return review, err
	}
	review["source_title"] = sourceDoc["title"]
	review["document_owner_uid"] = sourceDoc["document_owner_uid"]
	review["document_status"] = sourceDoc["document_status"]
	return review, nil
}

// This legacy helper is intentionally not used by archive lookup. Title-based
// matching is ambiguous and must remain excluded from the read path.
func (a *Adapter) reviewByArchiveTitle(ctx context.Context, title string, archiveDocID string) (map[string]any, error) {
	if title == "" {
		return nil, nil
	}
	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at, d.title AS source_title,
		       r.document_id, d.owner_uid AS document_owner_uid, d.status AS document_status
		FROM document_reviews r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE d.title = ? AND r.status = 'archived' AND d.id != ?
		ORDER BY r.updated_at DESC
		LIMIT 1`, title, archiveDocID)
	if err != nil || review == nil {
		return review, err
	}
	return review, nil
}

func (a *Adapter) firstRow(ctx context.Context, sqlText string, args ...any) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (a *Adapter) enrichReviewRecord(ctx context.Context, row map[string]any) (map[string]any, error) {
	normalizeReviewJSON(row)
	id := stringValue(row["id"])
	if id == "" {
		row["actions"] = []map[string]any{}
		row["seal_records"] = []map[string]any{}
		row["send_records"] = []map[string]any{}
		return row, nil
	}

	if stringValue(row["workflow_instance_id"]) != "" || stringValue(row["review_record_source"]) == "publish_request" {
		row["actions"] = []map[string]any{}
	} else {
		actions, err := a.reviewActions(ctx, id)
		if err != nil {
			return nil, err
		}
		row["actions"] = actions
	}

	publishedDocumentUUID := stringValue(row["published_document_uuid"])
	sealRecords, err := a.reviewSealRecords(ctx, id, publishedDocumentUUID)
	if err != nil {
		return nil, err
	}
	sendRecords, err := a.reviewSendRecords(ctx, id, publishedDocumentUUID)
	if err != nil {
		return nil, err
	}
	row["seal_records"] = sealRecords
	row["send_records"] = sendRecords
	return row, nil
}

func (a *Adapter) reviewActions(ctx context.Context, reviewID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "review_actions")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT *
		FROM review_actions
		WHERE review_id = ?
		ORDER BY created_at ASC, id ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func (a *Adapter) reviewSealRecords(ctx context.Context, reviewID string, publishedDocumentUUID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "document_seal_records")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, review_id, document_uuid, seal_types, page_count, operator_uid,
		       remark, confirmed_at, created_at, updated_at
		FROM document_seal_records
		WHERE review_id = ?
		  AND (? = '' OR document_uuid = ?)
		ORDER BY confirmed_at ASC, id ASC`, reviewID, publishedDocumentUUID, publishedDocumentUUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		item["seal_types"] = stringListJSONValue(item["seal_types"])
	}
	return items, nil
}

func (a *Adapter) reviewSendRecords(ctx context.Context, reviewID string, publishedDocumentUUID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "document_send_records")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, review_id, document_uuid, sender_uid, receiver_name, receiver_phone,
		       channel, sent_date, receive_date, target_account, remark, confirmed_at,
		       received_confirmed_at, created_at, updated_at
		FROM document_send_records
		WHERE review_id = ?
		  AND (? = '' OR document_uuid = ?)
		ORDER BY confirmed_at ASC, id ASC`, reviewID, publishedDocumentUUID, publishedDocumentUUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func normalizePublishRequestReview(row map[string]any) {
	if stringValue(row["status"]) == "" {
		if stringValue(row["archive_oss_path"]) != "" {
			row["status"] = "archived"
		} else {
			row["status"] = stringValue(row["workflow_status"])
		}
	}
	row["current_node"] = int64Value(row["current_node"])
	if row["flow_snapshot"] == nil {
		row["flow_snapshot"] = []any{}
	}
}

func normalizeReviewJSON(row map[string]any) {
	row["flow_snapshot"] = jsonArrayValue(row["flow_snapshot"])
	row["extra"] = jsonObjectValue(row["extra"])
}

func jsonObjectValue(value any) any {
	if value == nil {
		return nil
	}
	if _, ok := value.(map[string]any); ok {
		return value
	}
	text := strings.TrimSpace(stringValue(value))
	if text == "" || text == "null" {
		return nil
	}
	var item map[string]any
	if err := json.Unmarshal([]byte(text), &item); err != nil {
		return nil
	}
	return item
}

func stringListJSONValue(value any) []string {
	if value == nil {
		return []string{}
	}
	if items, ok := value.([]string); ok {
		return items
	}
	if bytes, ok := value.([]byte); ok {
		value = string(bytes)
	}
	var raw []any
	if err := json.Unmarshal([]byte(stringValue(value)), &raw); err != nil {
		return []string{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text := stringValue(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}
