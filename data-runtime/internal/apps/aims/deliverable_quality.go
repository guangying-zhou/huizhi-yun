package aims

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleDeliverableQualityRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if path == "/v1/aims/qa-checklists" {
		switch method {
		case http.MethodGet:
			data, err := a.listQAChecklists(ctx, query)
			return data, "aims.qa_checklists.list", true, err
		case http.MethodPost:
			data, err := a.createQAChecklist(ctx, query, body)
			return data, "aims.qa_checklists.create", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}
	if checklistID, ok := commandPathID(path, "/v1/aims/qa-checklists/", ":publish"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.publishQAChecklist(ctx, checklistID, query)
		return data, "aims.qa_checklists.publish", true, err
	}
	if deliverableID, ok := pathParam(path, "/v1/aims/deliverables/", "/submissions"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.createDeliverableQualitySubmission(ctx, deliverableID, query, body)
		return data, "aims.deliverables.submissions.create", true, err
	}
	if submissionID, ok := commandPathID(path, "/v1/aims/deliverable-submissions/", ":activate-review"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.activateDeliverableQualityReview(ctx, submissionID, query, body)
		return data, "aims.deliverable_submissions.review.activate", true, err
	}
	if submissionID, ok := commandPathID(path, "/v1/aims/deliverable-submissions/", ":confirm-completeness"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.reviewDeliverableCompleteness(ctx, submissionID, query, body)
		return data, "aims.deliverable_submissions.completeness.review", true, err
	}
	if submissionID, ok := commandPathID(path, "/v1/aims/deliverable-submissions/", ":review-quality"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.reviewDeliverableQuality(ctx, submissionID, query, body)
		return data, "aims.deliverable_submissions.quality.review", true, err
	}
	if deliverableID, ok := pathParam(path, "/v1/aims/deliverables/", "/waivers"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.createDeliverableWaiver(ctx, deliverableID, query, body)
		return data, "aims.deliverables.waivers.create", true, err
	}
	if path == "/v1/aims/quality-reviews/queue" {
		if method != http.MethodGet {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.listQualityReviewQueue(ctx, query)
		return data, "aims.quality_reviews.queue", true, err
	}
	return nil, "", false, nil
}

func commandPathID(path, prefix, suffix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return id, id != "" && !strings.Contains(id, "/")
}

func requireQualityFlag(query url.Values, keys ...string) error {
	if !truthyQuery(query, keys...) {
		return httperror.New(http.StatusForbidden, "quality_review_permission_required", "quality review permission is required")
	}
	return nil
}

func qualityRoleHolderRevision(query url.Values, role string) (int64, error) {
	value := firstQueryText(query, "current_user_"+role+"_revision", "currentUser"+strings.ReplaceAll(strings.Title(role), "_", "")+"Revision")
	revision, err := strconv.ParseInt(value, 10, 64)
	if err != nil || revision <= 0 {
		return 0, httperror.New(http.StatusForbidden, role+"_role_holder_revision_required", role+" role holder revision is required")
	}
	return revision, nil
}

func (a *Adapter) listQAChecklists(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_view_quality_reviews"); err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, checklist_code, version_no, title, items_json, items_sha256,
		       status, published_by,
		       DATE_FORMAT(published_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
		       created_by, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM qa_checklist_versions
		ORDER BY checklist_code, version_no DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var code, title, hash, status, createdBy, createdAt string
		var versionNo int
		var itemJSON json.RawMessage
		var publishedBy, publishedAt sql.NullString
		if err := rows.Scan(&id, &code, &versionNo, &title, &itemJSON, &hash, &status, &publishedBy, &publishedAt, &createdBy, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "checklistCode": code, "versionNo": versionNo, "title": title,
			"items": itemJSON, "itemsSha256": hash, "status": status,
			"publishedBy": nullableJSONText(publishedBy), "publishedAt": nullableJSONText(publishedAt),
			"createdBy": createdBy, "createdAt": createdAt,
		})
	}
	return map[string]any{"items": items, "total": len(items)}, rows.Err()
}

func (a *Adapter) createQAChecklist(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_configure_quality_reviews"); err != nil {
		return nil, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !truthyQuery(query, "current_user_is_qa") {
		return nil, httperror.New(http.StatusForbidden, "current_qa_required", "current QA is required")
	}
	if _, err := qualityRoleHolderRevision(query, "qa"); err != nil {
		return nil, err
	}
	code := firstBodyText(body, "checklistCode", "checklist_code")
	title := firstBodyText(body, "title")
	items, err := normalizeQAChecklistItems(body["items"])
	if code == "" || title == "" || err != nil || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist", "checklistCode, title and non-empty items are required")
	}
	itemsJSON, err := canonicalJSON(items)
	if err != nil {
		return nil, err
	}
	hash := sha256Hex(itemsJSON)
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var versionNo int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(version_no), 0) + 1
		FROM qa_checklist_versions
		WHERE checklist_code = ?
	`, code).Scan(&versionNo); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO qa_checklist_versions (
		  checklist_code, version_no, title, items_json, items_sha256, status, created_by
		) VALUES (?, ?, ?, CAST(? AS JSON), ?, 'draft', ?)
	`, code, versionNo, title, string(itemsJSON), hash, actor)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "checklistCode": code, "versionNo": versionNo, "status": "draft", "itemsSha256": hash}, nil
}

func (a *Adapter) publishQAChecklist(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_configure_quality_reviews"); err != nil {
		return nil, err
	}
	if !truthyQuery(query, "current_user_is_qa") {
		return nil, httperror.New(http.StatusForbidden, "current_qa_required", "current QA is required")
	}
	if _, err := qualityRoleHolderRevision(query, "qa"); err != nil {
		return nil, err
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	id, err := parseID(rawID, "checklist_id")
	if err != nil {
		return nil, err
	}
	result, err := a.DB().ExecContext(ctx, `
		UPDATE qa_checklist_versions
		SET status = 'published', published_by = ?, published_at = UTC_TIMESTAMP(6)
		WHERE id = ? AND status = 'draft'
	`, actor, id)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "qa_checklist_not_publishable", "QA checklist is not a draft")
	}
	return map[string]any{"id": id, "status": "published"}, nil
}

func (a *Adapter) createDeliverableQualitySubmission(
	ctx context.Context,
	rawDeliverableID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "current_user_document_version_resolved") {
		return nil, httperror.New(http.StatusForbidden, "trusted_document_version_resolution_required", "trusted document version resolution is required")
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	deliverableID, err := parseID(rawDeliverableID, "deliverable_id")
	if err != nil {
		return nil, err
	}
	var projectID int64
	var documentUUID, documentSource, deliverableType string
	var repoProjectCode, repoFilePath, repoCommitID string
	err = a.DB().QueryRowContext(ctx, `
		SELECT project_id, COALESCE(document_uuid, ''), document_source, deliverable_type,
		       COALESCE(repo_project_code, ''), COALESCE(repo_file_path, ''), COALESCE(repo_commit_id, '')
		FROM deliverables WHERE id = ?
	`, deliverableID).Scan(
		&projectID, &documentUUID, &documentSource, &deliverableType,
		&repoProjectCode, &repoFilePath, &repoCommitID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, actor, query); err != nil {
		return nil, err
	}
	if deliverableType != "document" {
		return nil, httperror.New(http.StatusBadRequest, "document_deliverable_required", "quality review requires a document deliverable")
	}
	if firstBodyText(body, "documentSource", "document_source") != documentSource {
		return nil, httperror.New(http.StatusConflict, "deliverable_document_source_mismatch", "resolved document source does not match deliverable")
	}
	var versionID, versionNo int64
	switch documentSource {
	case "codocs":
		if documentUUID == "" || firstBodyText(body, "documentUuid", "document_uuid") != documentUUID {
			return nil, httperror.New(http.StatusConflict, "deliverable_document_binding_mismatch", "resolved Codocs document does not match deliverable")
		}
		versionID, err = bodyInt64(body, "documentVersionId", "document_version_id")
		if err != nil || versionID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "document_version_required", "documentVersionId is required")
		}
		versionNo, err = bodyInt64(body, "documentVersionNum", "document_version_num")
		if err != nil || versionNo <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "document_version_num_required", "documentVersionNum is required")
		}
	case "repo":
		if repoProjectCode == "" || repoFilePath == "" || repoCommitID == "" ||
			firstBodyText(body, "repoProjectCode", "repo_project_code") != repoProjectCode ||
			firstBodyText(body, "repoFilePath", "repo_file_path") != repoFilePath ||
			firstBodyText(body, "repoCommitId", "repo_commit_id") != repoCommitID {
			return nil, httperror.New(http.StatusConflict, "deliverable_repo_binding_mismatch", "resolved repository snapshot does not match deliverable")
		}
	default:
		return nil, httperror.New(http.StatusBadRequest, "unsupported_document_source", "quality review does not support this document source")
	}
	contentHash := strings.ToLower(firstBodyText(body, "contentSha256", "content_sha256"))
	decodedHash, decodeErr := hex.DecodeString(contentHash)
	if decodeErr != nil || len(decodedHash) != 32 {
		return nil, httperror.New(http.StatusBadRequest, "content_sha256_required", "contentSha256 is required")
	}
	checklistID, _ := bodyInt64(body, "checklistVersionId", "checklist_version_id")
	var checklistHash string
	if checklistID > 0 {
		err = a.DB().QueryRowContext(ctx, `
			SELECT items_sha256 FROM qa_checklist_versions WHERE id = ? AND status = 'published'
		`, checklistID).Scan(&checklistHash)
	} else {
		err = a.DB().QueryRowContext(ctx, `
			SELECT id, items_sha256
			FROM qa_checklist_versions
			WHERE checklist_code = 'PROJECT_DOCUMENT_STANDARD' AND status = 'published'
			ORDER BY version_no DESC
			LIMIT 1
		`).Scan(&checklistID, &checklistHash)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "published_checklist_required", "published QA checklist is required")
	}
	if err != nil {
		return nil, err
	}
	route := "qa"
	if truthyQuery(query, "current_user_is_qa") {
		route = "pm_completeness_then_director_quality"
	}
	submissionNo := fmt.Sprintf("DLV-%d-DOC-%d", deliverableID, versionID)
	if documentSource == "repo" {
		submissionNo = fmt.Sprintf("DLV-%d-REPO-%s", deliverableID, repoCommitID)
	}
	evidence := map[string]any{
		"schema":               "aims.deliverable-submission.evidence.v2",
		"deliverableId":        deliverableID,
		"documentSource":       documentSource,
		"contentSha256":        contentHash,
		"checklistVersionId":   checklistID,
		"checklistItemsSha256": checklistHash,
	}
	if documentSource == "codocs" {
		evidence["documentUuid"] = documentUUID
		evidence["documentVersionId"] = versionID
		evidence["documentVersionNum"] = versionNo
	} else {
		evidence["repoProjectCode"] = repoProjectCode
		evidence["repoFilePath"] = repoFilePath
		evidence["repoCommitId"] = repoCommitID
	}
	evidenceJSON, err := canonicalJSON(evidence)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var lockedDeliverableID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM deliverables WHERE id = ? FOR UPDATE`, deliverableID).Scan(&lockedDeliverableID); err != nil {
		return nil, err
	}
	var openSubmissionID int64
	var openSubmissionOwner, openSubmissionStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT id, submitted_by, status
		FROM deliverable_submissions
		WHERE deliverable_id = ?
		  AND status IN ('preparing_review', 'awaiting_review')
		ORDER BY id DESC
		LIMIT 1
	`, deliverableID).Scan(&openSubmissionID, &openSubmissionOwner, &openSubmissionStatus)
	if err == nil {
		if openSubmissionOwner != actor {
			return nil, httperror.New(http.StatusConflict, "deliverable_review_already_open", "deliverable already has an open quality review")
		}
		if openSubmissionStatus == "awaiting_review" {
			return nil, httperror.New(http.StatusConflict, "deliverable_review_already_awaiting", "deliverable is already awaiting quality review")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return a.getDeliverableQualitySubmission(ctx, openSubmissionID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO deliverable_submissions (
		  deliverable_id, submission_no, document_uuid, document_version_id,
		  document_version_num, content_sha256, evidence_snapshot_json,
		  checklist_version_id, review_route, status, submitted_by, submitted_at
		) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, 'preparing_review', ?, UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
	`, deliverableID, submissionNo, nullableText(documentUUID), nullablePositiveInt64(versionID), nullablePositiveInt64(versionNo), contentHash,
		string(evidenceJSON), checklistID, route, actor)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	submission, err := a.getDeliverableQualitySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	if stringValueFromMap(submission, "submittedBy") != actor ||
		stringValueFromMap(submission, "contentSha256") != contentHash ||
		int64ValueFromMap(submission, "checklistVersionId") != checklistID {
		return nil, httperror.New(http.StatusConflict, "deliverable_submission_version_conflict", "document version is already bound to a different submission context")
	}
	return submission, nil
}

func (a *Adapter) activateDeliverableQualityReview(
	ctx context.Context,
	rawSubmissionID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor := currentUserFrom(query, body)
	submissionID, err := parseID(rawSubmissionID, "submission_id")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var deliverableID int64
	var submittedBy, status, documentSource string
	if err := tx.QueryRowContext(ctx, `
		SELECT deliverable_id, submitted_by, status,
		       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot_json, '$.documentSource')), 'codocs')
		FROM deliverable_submissions WHERE id = ? FOR UPDATE
	`, submissionID).Scan(&deliverableID, &submittedBy, &status, &documentSource); err != nil {
		return nil, err
	}
	if submittedBy != actor {
		return nil, httperror.New(http.StatusForbidden, "submission_owner_required", "only submission owner can activate review")
	}
	if status != "preparing_review" && status != "awaiting_review" {
		return nil, httperror.New(http.StatusConflict, "submission_not_activatable", "submission cannot activate review")
	}
	var grantID int64
	if documentSource == "codocs" {
		if !truthyQuery(query, "current_user_document_review_grant_created") {
			return nil, httperror.New(http.StatusForbidden, "trusted_document_review_grant_required", "trusted Codocs review grant is required")
		}
		grantID, err = bodyInt64(body, "reviewGrantId", "review_grant_id")
		if err != nil || grantID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "review_grant_id_required", "reviewGrantId is required")
		}
	} else if documentSource == "repo" {
		if !truthyQuery(query, "current_user_repository_review_snapshot_resolved") {
			return nil, httperror.New(http.StatusForbidden, "trusted_repository_review_snapshot_required", "trusted repository review snapshot is required")
		}
	} else {
		return nil, httperror.New(http.StatusConflict, "unsupported_submission_document_source", "submission document source is not supported")
	}
	if status == "awaiting_review" && documentSource == "codocs" {
		var existingGrantID sql.NullInt64
		if err := tx.QueryRowContext(ctx, `
			SELECT review_grant_id FROM deliverable_submissions WHERE id = ?
		`, submissionID).Scan(&existingGrantID); err != nil {
			return nil, err
		}
		if existingGrantID.Valid && existingGrantID.Int64 != grantID {
			return nil, httperror.New(http.StatusConflict, "review_grant_binding_conflict", "submission is already activated with a different review grant")
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE deliverable_submissions
		SET review_grant_id = COALESCE(review_grant_id, ?),
		    review_granted_at = COALESCE(review_granted_at, UTC_TIMESTAMP(6)),
		    status = 'awaiting_review'
		WHERE id = ?
	`, nullablePositiveInt64(grantID), submissionID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE deliverables
		SET current_submission_id = ?, quality_status = 'awaiting_review',
		    status = 'submitted', submitted_by = ?, submitted_at = UTC_TIMESTAMP(6)
		WHERE id = ?
	`, submissionID, actor, deliverableID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.getDeliverableQualitySubmission(ctx, submissionID)
}

func (a *Adapter) listQualityReviewQueue(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_review_quality_reviews"); err != nil {
		return nil, err
	}
	role := ""
	if truthyQuery(query, "current_user_is_qa") {
		role = "qa"
	}
	if truthyQuery(query, "current_user_is_project_director") {
		role = "project_director"
	}
	if role == "" {
		return nil, httperror.New(http.StatusForbidden, "quality_role_holder_required", "current quality role holder is required")
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  submission.id, submission.submission_no, submission.document_uuid,
		  submission.document_version_id, submission.document_version_num,
		  submission.content_sha256, submission.review_route, submission.status,
		  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(submission.evidence_snapshot_json, '$.documentSource')), 'codocs'),
		  JSON_UNQUOTE(JSON_EXTRACT(submission.evidence_snapshot_json, '$.repoProjectCode')),
		  JSON_UNQUOTE(JSON_EXTRACT(submission.evidence_snapshot_json, '$.repoFilePath')),
		  JSON_UNQUOTE(JSON_EXTRACT(submission.evidence_snapshot_json, '$.repoCommitId')),
		  submission.submitted_by,
		  DATE_FORMAT(submission.submitted_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
		  deliverable.id, deliverable.name, deliverable.required,
		  project.id, project.project_code, project.name,
		  checklist.id, checklist.title, checklist.version_no, checklist.items_json,
		  (
		    SELECT review.comment
		    FROM deliverable_quality_reviews review
		    INNER JOIN deliverable_submissions previous_submission ON previous_submission.id = review.submission_id
		    WHERE previous_submission.deliverable_id = deliverable.id
		      AND previous_submission.id <> submission.id
		      AND review.action = 'return'
		    ORDER BY review.id DESC LIMIT 1
		  ),
		  (
		    SELECT previous_submission.document_version_num
		    FROM deliverable_submissions previous_submission
		    WHERE previous_submission.deliverable_id = deliverable.id
		      AND previous_submission.id <> submission.id
		      AND previous_submission.status = 'returned'
		    ORDER BY previous_submission.id DESC LIMIT 1
		  ),
		  (
		    SELECT previous_submission.content_sha256
		    FROM deliverable_submissions previous_submission
		    WHERE previous_submission.deliverable_id = deliverable.id
		      AND previous_submission.id <> submission.id
		      AND previous_submission.status = 'returned'
		    ORDER BY previous_submission.id DESC LIMIT 1
		  )
		FROM deliverable_submissions submission
		INNER JOIN deliverables deliverable ON deliverable.id = submission.deliverable_id
		INNER JOIN aims_projects project ON project.id = deliverable.project_id
		INNER JOIN qa_checklist_versions checklist ON checklist.id = submission.checklist_version_id
		WHERE submission.status = 'awaiting_review'
		  AND (
		    (? = 'qa' AND submission.review_route = 'qa')
		    OR
		    (? = 'project_director' AND submission.review_route = 'pm_completeness_then_director_quality'
		      AND EXISTS (
		        SELECT 1 FROM deliverable_quality_reviews completeness
		        WHERE completeness.submission_id = submission.id
		          AND completeness.stage = 'pm_completeness'
		          AND completeness.action = 'pass'
		      ))
		  )
		ORDER BY submission.submitted_at, submission.id
	`, role, role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var submissionID, deliverableID, projectID, checklistID int64
		var versionID sql.NullInt64
		var versionNum sql.NullInt64
		var submissionNo, contentHash, route, status, documentSource, submittedBy, submittedAt, deliverableName, projectCode, projectName, checklistTitle string
		var required int
		var checklistVersion int
		var documentUUID, repoProjectCode, repoFilePath, repoCommitID, lastReturn, previousContentHash sql.NullString
		var previousVersionNum sql.NullInt64
		var checklistItems json.RawMessage
		if err := rows.Scan(
			&submissionID, &submissionNo, &documentUUID, &versionID, &versionNum,
			&contentHash, &route, &status, &documentSource,
			&repoProjectCode, &repoFilePath, &repoCommitID,
			&submittedBy, &submittedAt,
			&deliverableID, &deliverableName, &required,
			&projectID, &projectCode, &projectName,
			&checklistID, &checklistTitle, &checklistVersion, &checklistItems,
			&lastReturn, &previousVersionNum, &previousContentHash,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"submissionId": submissionID, "submissionNo": submissionNo,
			"documentUuid": nullableJSONText(documentUUID), "documentVersionId": nullableInt64(versionID),
			"documentVersionNum": nullableInt64(versionNum), "contentSha256": contentHash,
			"documentSource": documentSource, "repoProjectCode": nullableJSONText(repoProjectCode),
			"repoFilePath": nullableJSONText(repoFilePath), "repoCommitId": nullableJSONText(repoCommitID),
			"reviewRoute": route, "status": status, "submittedBy": submittedBy, "submittedAt": submittedAt,
			"deliverableId": deliverableID, "deliverableName": deliverableName, "required": required == 1,
			"projectId": projectID, "projectCode": projectCode, "projectName": projectName,
			"checklistVersionId": checklistID, "checklistTitle": checklistTitle,
			"checklistVersionNo": checklistVersion, "checklistItems": checklistItems,
			"lastReturnComment":          nullableJSONText(lastReturn),
			"previousDocumentVersionNum": nullableInt64(previousVersionNum),
			"previousContentSha256":      nullableJSONText(previousContentHash),
			"isRecheck":                  previousContentHash.Valid,
			"reviewRole":                 role,
		})
	}
	return map[string]any{"items": items, "total": len(items), "reviewRole": role}, rows.Err()
}

func (a *Adapter) reviewDeliverableCompleteness(
	ctx context.Context,
	rawSubmissionID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	submissionID, err := parseID(rawSubmissionID, "submission_id")
	if err != nil {
		return nil, err
	}
	actor := currentUserFrom(query, body)
	var projectID int64
	var route, status string
	if err := a.DB().QueryRowContext(ctx, `
		SELECT deliverable.project_id, submission.review_route, submission.status
		FROM deliverable_submissions submission
		INNER JOIN deliverables deliverable ON deliverable.id = submission.deliverable_id
		WHERE submission.id = ?
	`, submissionID).Scan(&projectID, &route, &status); err != nil {
		return nil, err
	}
	if route != "pm_completeness_then_director_quality" || status != "awaiting_review" {
		return nil, httperror.New(http.StatusConflict, "completeness_review_not_required", "submission does not require PM completeness review")
	}
	if err := a.requireCurrentProjectManagerResponsibility(ctx, projectID, actor); err != nil {
		return nil, err
	}
	return a.appendDeliverableQualityReview(ctx, submissionID, "pm_completeness", actor, 0, body, false)
}

func (a *Adapter) reviewDeliverableQuality(
	ctx context.Context,
	rawSubmissionID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_review_quality_reviews"); err != nil {
		return nil, err
	}
	submissionID, err := parseID(rawSubmissionID, "submission_id")
	if err != nil {
		return nil, err
	}
	actor := currentUserFrom(query, body)
	var route, status string
	if err := a.DB().QueryRowContext(ctx, `
		SELECT review_route, status FROM deliverable_submissions WHERE id = ?
	`, submissionID).Scan(&route, &status); err != nil {
		return nil, err
	}
	if status != "awaiting_review" {
		return nil, httperror.New(http.StatusConflict, "quality_submission_not_reviewable", "submission is not awaiting review")
	}
	stage := "qa_quality"
	role := "qa"
	if route == "pm_completeness_then_director_quality" {
		stage = "director_quality"
		role = "project_director"
		var passed int
		if err := a.DB().QueryRowContext(ctx, `
			SELECT COUNT(*) FROM deliverable_quality_reviews
			WHERE submission_id = ? AND stage = 'pm_completeness' AND action = 'pass'
		`, submissionID).Scan(&passed); err != nil {
			return nil, err
		}
		if passed == 0 {
			return nil, httperror.New(http.StatusConflict, "pm_completeness_required", "PM completeness pass is required")
		}
	}
	if !truthyQuery(query, "current_user_is_"+role) {
		return nil, httperror.New(http.StatusForbidden, "current_quality_role_required", "current quality role holder is required")
	}
	revision, err := qualityRoleHolderRevision(query, role)
	if err != nil {
		return nil, err
	}
	return a.appendDeliverableQualityReview(ctx, submissionID, stage, actor, revision, body, true)
}

func stringValueFromMap(value map[string]any, key string) string {
	return strings.TrimSpace(fmt.Sprint(value[key]))
}

func int64ValueFromMap(value map[string]any, key string) int64 {
	switch item := value[key].(type) {
	case int64:
		return item
	case int:
		return int64(item)
	case *int64:
		if item != nil {
			return *item
		}
	}
	parsed, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value[key])), 10, 64)
	return parsed
}

func (a *Adapter) appendDeliverableQualityReview(
	ctx context.Context,
	submissionID int64,
	stage string,
	actor string,
	roleRevision int64,
	body map[string]any,
	final bool,
) (map[string]any, error) {
	action := firstBodyText(body, "action")
	if action != "pass" && action != "return" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_quality_review_action", "action must be pass or return")
	}
	comment := firstBodyText(body, "comment")
	if action == "return" && comment == "" {
		return nil, httperror.New(http.StatusBadRequest, "quality_review_comment_required", "return comment is required")
	}
	results, err := normalizeQAChecklistResults(body["checklistResults"])
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var deliverableID, checklistVersionID int64
	var status string
	var checklistItemsJSON json.RawMessage
	var checklistItemsHash string
	if err := tx.QueryRowContext(ctx, `
		SELECT submission.deliverable_id, submission.status, checklist.id,
		       checklist.items_json, checklist.items_sha256
		FROM deliverable_submissions submission
		INNER JOIN qa_checklist_versions checklist ON checklist.id = submission.checklist_version_id
		WHERE submission.id = ?
		FOR UPDATE
	`, submissionID).Scan(&deliverableID, &status, &checklistVersionID, &checklistItemsJSON, &checklistItemsHash); err != nil {
		return nil, err
	}
	if status != "awaiting_review" {
		return nil, httperror.New(http.StatusConflict, "quality_submission_not_reviewable", "submission is not awaiting review")
	}
	var terminalStageCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM deliverable_quality_reviews
		WHERE submission_id = ? AND stage = ? AND action = 'pass'
	`, submissionID, stage).Scan(&terminalStageCount); err != nil {
		return nil, err
	}
	if terminalStageCount > 0 {
		return nil, httperror.New(http.StatusConflict, "quality_review_stage_already_passed", "quality review stage already passed")
	}
	if final && action == "pass" {
		if err := validateRequiredQAChecklistResults(checklistItemsJSON, results); err != nil {
			return nil, err
		}
	}
	resultSnapshot := map[string]any{
		"schema":               "aims.deliverable-quality-review.v1",
		"stage":                stage,
		"checklistVersionId":   checklistVersionID,
		"checklistItemsSha256": checklistItemsHash,
		"results":              results,
	}
	resultJSON, err := canonicalJSON(resultSnapshot)
	if err != nil {
		return nil, err
	}
	resultHash := sha256Hex(resultJSON)
	result, err := tx.ExecContext(ctx, `
		INSERT INTO deliverable_quality_reviews (
		  submission_id, stage, action, checklist_result_json, result_sha256,
		  reviewer_uid, role_holder_revision, comment
		) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)
	`, submissionID, stage, action, string(resultJSON), resultHash, actor, nullablePositiveInt64(roleRevision), nullableText(comment))
	if err != nil {
		return nil, err
	}
	reviewID, _ := result.LastInsertId()
	if action == "return" {
		if _, err := tx.ExecContext(ctx, `UPDATE deliverable_submissions SET status = 'returned' WHERE id = ?`, submissionID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE deliverables SET quality_status = 'returned', status = 'rejected' WHERE id = ?`, deliverableID); err != nil {
			return nil, err
		}
	} else if final {
		if _, err := tx.ExecContext(ctx, `UPDATE deliverable_submissions SET status = 'passed' WHERE id = ?`, submissionID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE deliverables SET quality_status = 'passed', status = 'approved' WHERE id = ?`, deliverableID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"reviewId": reviewID, "submissionId": submissionID, "stage": stage, "action": action, "resultSha256": resultHash}, nil
}

func normalizeQAChecklistItems(value any) ([]map[string]any, error) {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_items", "checklist items must be a non-empty array")
	}
	seen := make(map[string]bool, len(rawItems))
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_item", "each checklist item must be an object")
		}
		code := firstBodyText(item, "code")
		label := firstBodyText(item, "label", "title")
		if code == "" || label == "" || seen[code] {
			return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_item", "checklist item code and label are required and code must be unique")
		}
		seen[code] = true
		required := true
		if rawRequired, exists := item["required"]; exists {
			required = truthyBodyValue(rawRequired)
		}
		items = append(items, map[string]any{"code": code, "label": label, "required": required})
	}
	return items, nil
}

func normalizeQAChecklistResults(value any) ([]map[string]any, error) {
	if value == nil {
		return []map[string]any{}, nil
	}
	rawResults, ok := value.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_results", "checklistResults must be an array")
	}
	results := make([]map[string]any, 0, len(rawResults))
	seen := make(map[string]bool, len(rawResults))
	for _, raw := range rawResults {
		result, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_result", "each checklist result must be an object")
		}
		code := firstBodyText(result, "code")
		if code == "" || seen[code] {
			return nil, httperror.New(http.StatusBadRequest, "invalid_qa_checklist_result", "checklist result code is required and must be unique")
		}
		seen[code] = true
		results = append(results, map[string]any{
			"code":   code,
			"label":  firstBodyText(result, "label", "title"),
			"passed": truthyBodyValue(result["passed"]),
		})
	}
	return results, nil
}

func validateRequiredQAChecklistResults(checklistJSON json.RawMessage, results []map[string]any) error {
	var items []map[string]any
	if err := json.Unmarshal(checklistJSON, &items); err != nil {
		return err
	}
	passed := make(map[string]bool, len(results))
	for _, result := range results {
		passed[firstBodyText(result, "code")] = truthyBodyValue(result["passed"])
	}
	for _, item := range items {
		required := true
		if value, exists := item["required"]; exists {
			required = truthyBodyValue(value)
		}
		if required && !passed[firstBodyText(item, "code")] {
			return httperror.New(http.StatusConflict, "required_qa_checklist_item_not_passed", "all required QA checklist items must pass")
		}
	}
	return nil
}

func (a *Adapter) createDeliverableWaiver(
	ctx context.Context,
	rawDeliverableID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if err := requireQualityFlag(query, "current_user_can_waive_quality_reviews"); err != nil {
		return nil, err
	}
	if !truthyQuery(query, "current_user_is_project_director") {
		return nil, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	revision, err := qualityRoleHolderRevision(query, "project_director")
	if err != nil {
		return nil, err
	}
	deliverableID, err := parseID(rawDeliverableID, "deliverable_id")
	if err != nil {
		return nil, err
	}
	actor := currentUserFrom(query, body)
	reason := firstBodyText(body, "reason")
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "waiver_reason_required", "waiver reason is required")
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var lockedDeliverableID int64
	var qualityStatus string
	err = tx.QueryRowContext(ctx, `SELECT id, quality_status FROM deliverables WHERE id = ? FOR UPDATE`, deliverableID).Scan(&lockedDeliverableID, &qualityStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return nil, err
	}
	if qualityStatus == "passed" || qualityStatus == "waived" {
		return nil, httperror.New(http.StatusConflict, "deliverable_quality_not_waivable", "passed or already waived deliverable cannot be waived")
	}
	var activeWaiverCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM deliverable_waivers
		WHERE deliverable_id = ? AND revoked_at IS NULL
	`, deliverableID).Scan(&activeWaiverCount); err != nil {
		return nil, err
	}
	if activeWaiverCount > 0 {
		return nil, httperror.New(http.StatusConflict, "active_deliverable_waiver_exists", "deliverable already has an active waiver")
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO deliverable_waivers (
		  deliverable_id, reason, approved_by, role_holder_revision, effective_at
		) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))
	`, deliverableID, reason, actor, revision)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	if _, err := tx.ExecContext(ctx, `UPDATE deliverables SET quality_status = 'waived' WHERE id = ?`, deliverableID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"waiverId": id, "deliverableId": deliverableID, "reason": reason, "approvedBy": actor, "roleHolderRevision": revision}, nil
}

func (a *Adapter) requireCurrentProjectManagerResponsibility(ctx context.Context, projectID int64, actor string) error {
	if strings.TrimSpace(actor) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	var responsibleUID string
	err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE((
		  SELECT delegation.delegate_uid
		  FROM project_manager_delegations delegation
		  WHERE delegation.project_id = project.id
		    AND delegation.revoked_at IS NULL
		    AND delegation.starts_at <= UTC_TIMESTAMP(6)
		    AND delegation.ends_at > UTC_TIMESTAMP(6)
		  ORDER BY delegation.starts_at DESC, delegation.id DESC
		  LIMIT 1
		), project.leader_uid)
		FROM aims_projects project WHERE project.id = ?
	`, projectID).Scan(&responsibleUID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	if responsibleUID != actor {
		return httperror.New(http.StatusForbidden, "current_project_manager_required", "current project manager or acting manager is required")
	}
	return nil
}

func (a *Adapter) requireDeliverableQualityBeforeApproval(ctx context.Context, deliverableID int64) error {
	var deliverableType, qualityStatus string
	var required int
	err := a.DB().QueryRowContext(ctx, `
		SELECT deliverable_type, `+"`required`"+`, quality_status
		FROM deliverables
		WHERE id = ?
	`, deliverableID).Scan(&deliverableType, &required, &qualityStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return err
	}
	if deliverableType == "document" && required != 0 && qualityStatus != "passed" && qualityStatus != "waived" {
		return httperror.New(http.StatusConflict, "deliverable_quality_gate_required", "required document deliverable must pass quality review or receive a director waiver before approval")
	}
	return nil
}

func (a *Adapter) requireNoOpenDeliverableQualityReview(ctx context.Context, deliverableID int64) error {
	var openCount int
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM deliverable_submissions
		WHERE deliverable_id = ?
		  AND status IN ('preparing_review', 'awaiting_review')
	`, deliverableID).Scan(&openCount); err != nil {
		return err
	}
	if openCount > 0 {
		return httperror.New(http.StatusConflict, "deliverable_document_locked_for_quality_review", "document binding cannot change while a quality review is open")
	}
	return nil
}

func (a *Adapter) getDeliverableQualitySubmission(ctx context.Context, id int64) (map[string]any, error) {
	var deliverableID, checklistID int64
	var submissionNo, contentHash, route, status, documentSource, submittedBy, submittedAt string
	var documentUUID, repoProjectCode, repoFilePath, repoCommitID sql.NullString
	var versionID, versionNum, grantID sql.NullInt64
	var grantedAt sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, deliverable_id, submission_no, document_uuid, document_version_id,
		       document_version_num, content_sha256, checklist_version_id, review_route,
		       review_grant_id, DATE_FORMAT(review_granted_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
		       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot_json, '$.documentSource')), 'codocs'),
		       JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot_json, '$.repoProjectCode')),
		       JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot_json, '$.repoFilePath')),
		       JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot_json, '$.repoCommitId')),
		       status, submitted_by, DATE_FORMAT(submitted_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM deliverable_submissions WHERE id = ?
	`, id).Scan(
		&id, &deliverableID, &submissionNo, &documentUUID, &versionID,
		&versionNum, &contentHash, &checklistID, &route, &grantID, &grantedAt,
		&documentSource, &repoProjectCode, &repoFilePath, &repoCommitID,
		&status, &submittedBy, &submittedAt,
	)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "deliverableId": deliverableID, "submissionNo": submissionNo,
		"documentSource": documentSource, "documentUuid": nullableJSONText(documentUUID),
		"repoProjectCode": nullableJSONText(repoProjectCode), "repoFilePath": nullableJSONText(repoFilePath),
		"repoCommitId": nullableJSONText(repoCommitID), "documentVersionId": nullableInt64(versionID),
		"documentVersionNum": nullableInt64(versionNum), "contentSha256": contentHash,
		"checklistVersionId": checklistID, "reviewRoute": route,
		"reviewGrantId": nullableInt64(grantID), "reviewGrantedAt": nullableJSONText(grantedAt),
		"status": status, "submittedBy": submittedBy, "submittedAt": submittedAt,
	}, nil
}
