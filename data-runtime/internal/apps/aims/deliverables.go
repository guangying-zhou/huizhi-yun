package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type deliverableListItem struct {
	ID                        int64   `json:"id"`
	EntityType                string  `json:"entityType"`
	EntityID                  *int64  `json:"entityId"`
	TargetID                  *int64  `json:"targetId"`
	MatterID                  *int64  `json:"matterId"`
	Name                      string  `json:"name"`
	Description               *string `json:"description"`
	AcceptanceCriteria        *string `json:"acceptanceCriteria"`
	DeliverableType           string  `json:"deliverableType"`
	Required                  bool    `json:"required"`
	SortOrder                 int64   `json:"sortOrder"`
	Status                    string  `json:"status"`
	QualityStatus             string  `json:"qualityStatus"`
	CurrentSubmissionID       *int64  `json:"currentSubmissionId"`
	CurrentReviewRoute        *string `json:"currentReviewRoute"`
	CurrentCompletenessPassed bool    `json:"currentCompletenessPassed"`
	DocumentUUID              *string `json:"documentUuid"`
	DocumentTitle             *string `json:"documentTitle"`
	DocumentSource            string  `json:"documentSource"`
	RepoProjectCode           *string `json:"repoProjectCode"`
	RepoFilePath              *string `json:"repoFilePath"`
	RepoCommitID              *string `json:"repoCommitId"`
	EvidenceURL               *string `json:"evidenceUrl"`
	EvidenceNote              *string `json:"evidenceNote"`
	SubmittedBy               *string `json:"submittedBy"`
	SubmittedAt               *string `json:"submittedAt"`
	ProjectID                 int64   `json:"projectId"`
	ProjectCode               *string `json:"projectCode"`
	TargetItemKey             *string `json:"targetItemKey"`
	TargetTitle               *string `json:"targetTitle"`
	MatterItemKey             *string `json:"matterItemKey"`
	MatterTitle               *string `json:"matterTitle"`
	CreatedBy                 string  `json:"createdBy"`
	CreatedAt                 string  `json:"createdAt"`
	UpdatedAt                 string  `json:"updatedAt"`
}

type directDeliverableControl struct {
	ProjectID   int64
	Status      string
	TemplateKey *string
}

func (a *Adapter) handleDeliverablesRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if data, operation, handled, err := a.handleDeliverableQualityRuntime(ctx, method, path, query, body); handled {
		return data, operation, true, err
	}
	if method == http.MethodGet && path == "/v1/aims/deliverables" {
		data, err := a.listDeliverables(ctx, query)
		return data, "aims.deliverables.list", true, err
	}

	deliverableID, ok := directPathParam(path, "/v1/aims/deliverables/")
	if !ok {
		return nil, "", false, nil
	}
	switch method {
	case http.MethodPut, http.MethodPatch:
		data, err := a.updateDirectDeliverable(ctx, deliverableID, query, body)
		return data, "aims.deliverables.update", true, err
	case http.MethodDelete:
		data, err := a.deleteDirectDeliverable(ctx, deliverableID, query)
		return data, "aims.deliverables.delete", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) listDeliverables(ctx context.Context, query url.Values) ([]deliverableListItem, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	conditions := make([]string, 0)
	args := make([]any, 0)
	rawEntityType := strings.TrimSpace(firstQueryText(query, "entity_type", "entityType"))
	rawEntityID := strings.TrimSpace(firstQueryText(query, "entity_id", "entityId"))
	var entityID int64
	hasEntityID := rawEntityID != ""
	if hasEntityID {
		parsed, err := parseID(rawEntityID, "entity_id")
		if err != nil {
			return nil, err
		}
		entityID = parsed
	}

	if rawEntityType != "" {
		switch rawEntityType {
		case "project":
			conditions = append(conditions, "d.project_owner_id IS NOT NULL")
			if hasEntityID {
				conditions = append(conditions, "d.project_owner_id = ?")
				args = append(args, entityID)
			}
		case "milestone":
			conditions = append(conditions, "d.milestone_owner_id IS NOT NULL")
			if hasEntityID {
				conditions = append(conditions, "d.milestone_owner_id = ?")
				args = append(args, entityID)
			}
		case "target":
			conditions = append(conditions, "d.target_id IS NOT NULL")
			if hasEntityID {
				conditions = append(conditions, "d.target_id = ?")
				args = append(args, entityID)
			}
		case "matter":
			conditions = append(conditions, "d.matter_id IS NOT NULL")
			if hasEntityID {
				conditions = append(conditions, "d.matter_id = ?")
				args = append(args, entityID)
			}
		case "task", "work_item":
			if hasEntityID {
				conditions = append(conditions, "(d.target_id = ? OR d.matter_id = ?)")
				args = append(args, entityID, entityID)
			} else {
				conditions = append(conditions, "(d.target_id IS NOT NULL OR d.matter_id IS NOT NULL)")
			}
		default:
			return nil, httperror.New(http.StatusBadRequest, "unsupported_entity_type", "不支持的 entity_type: "+rawEntityType)
		}
	} else if hasEntityID {
		conditions = append(conditions, "(d.project_owner_id = ? OR d.milestone_owner_id = ? OR d.target_id = ? OR d.matter_id = ?)")
		args = append(args, entityID, entityID, entityID, entityID)
	}

	projectIDText := firstQueryText(query, "project_id", "projectId")
	if projectIDText != "" {
		projectID, err := parseID(projectIDText, "project_id")
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, "d.project_id = ?")
		args = append(args, projectID)
	}
	if status := firstQueryText(query, "status"); status != "" {
		conditions = append(conditions, "d.status = ?")
		args = append(args, status)
	}
	if deliverableIDText := firstQueryText(query, "deliverable_id", "deliverableId"); deliverableIDText != "" {
		deliverableID, err := parseID(deliverableIDText, "deliverable_id")
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, "d.id = ?")
		args = append(args, deliverableID)
	}
	if deliverableType := firstQueryText(query, "deliverable_type", "deliverableType"); deliverableType != "" {
		conditions = append(conditions, "d.deliverable_type = ?")
		args = append(args, deliverableType)
	}
	if documentUUID := firstQueryText(query, "document_uuid", "documentUuid"); documentUUID != "" {
		conditions = append(conditions, "d.document_uuid = ?")
		args = append(args, documentUUID)
	}
	if projectIDText != "" && rawEntityType == "" && !hasEntityID {
		conditions = append(conditions, "(d.project_owner_id IS NOT NULL OR d.milestone_owner_id IS NOT NULL OR d.target_id IS NOT NULL)")
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", uid)
	conditions = append(conditions, visibilityWhere)
	args = append(args, visibilityArgs...)

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			d.id,
			d.project_owner_id,
			d.milestone_owner_id,
			d.target_id,
			d.matter_id,
			d.name,
			d.description,
			d.acceptance_criteria,
			d.deliverable_type,
			d.`+"`required`"+`,
			d.sort_order,
			d.status,
			d.quality_status,
			d.current_submission_id,
			current_submission.review_route,
			EXISTS (
				SELECT 1
				FROM deliverable_quality_reviews completeness
				WHERE completeness.submission_id = d.current_submission_id
				  AND completeness.stage = 'pm_completeness'
				  AND completeness.action = 'pass'
			) AS current_completeness_passed,
			d.document_uuid,
			d.document_title,
			d.document_source,
			d.repo_project_code,
			d.repo_file_path,
			d.repo_commit_id,
			d.evidence_url,
			d.evidence_note,
			d.submitted_by,
			d.submitted_at,
			d.project_id,
			d.project_code,
			target_wi.item_key AS target_item_key,
			target_wi.title AS target_title,
			matter_wi.item_key AS matter_item_key,
			matter_wi.title AS matter_title,
			d.created_by,
			d.created_at,
			d.updated_at
		FROM deliverables d
		JOIN aims_projects p ON p.id = d.project_id
		LEFT JOIN deliverable_submissions current_submission ON current_submission.id = d.current_submission_id
		LEFT JOIN work_items target_wi ON target_wi.id = d.target_id
		LEFT JOIN work_items matter_wi ON matter_wi.id = d.matter_id
		`+whereClause+`
		ORDER BY COALESCE(d.target_id, d.matter_id, d.milestone_owner_id, d.project_owner_id, d.id) ASC,
		         d.sort_order ASC,
		         d.created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query deliverables: %w", err)
	}
	defer rows.Close()

	items := make([]deliverableListItem, 0)
	for rows.Next() {
		item, err := scanDeliverableListItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) updateDirectDeliverable(ctx context.Context, rawDeliverableID string, query url.Values, body map[string]any) (map[string]any, error) {
	deliverableID, err := parseID(rawDeliverableID, "deliverable_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	control, err := a.loadDirectDeliverableControl(ctx, deliverableID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, control.ProjectID, uid, query); err != nil {
		return nil, err
	}
	if err := a.requireDeliverableMilestoneCompletionUnlocked(ctx, deliverableID); err != nil {
		return nil, err
	}

	sets := make([]string, 0, 12)
	args := make([]any, 0, 12)
	newName := ""
	nameChanged := hasAnyBodyKey(body, "name")
	if nameChanged {
		newName = strings.TrimSpace(firstBodyText(body, "name"))
		if newName == "" {
			return nil, httperror.New(http.StatusBadRequest, "deliverable_name_required", "成果名称不能为空")
		}
		sets = append(sets, "name = ?")
		args = append(args, newName)
	}
	if hasAnyBodyKey(body, "documentUuid", "document_uuid", "documentSource", "document_source") {
		if err := a.requireNoOpenDeliverableQualityReview(ctx, deliverableID); err != nil {
			return nil, err
		}
	}
	appendNullableBodySet := func(column string, keys ...string) {
		if !hasAnyBodyKey(body, keys...) {
			return
		}
		sets = append(sets, column+" = ?")
		args = append(args, nullableText(firstBodyText(body, keys...)))
	}
	appendNullableBodySet("description", "description")
	appendNullableBodySet("acceptance_criteria", "acceptanceCriteria", "acceptance_criteria")
	appendNullableBodySet("deliverable_type", "deliverableType", "deliverable_type")
	appendNullableBodySet("document_uuid", "documentUuid", "document_uuid")
	appendNullableBodySet("document_title", "documentTitle", "document_title")
	appendNullableBodySet("evidence_url", "evidenceUrl", "evidence_url")
	appendNullableBodySet("evidence_note", "evidenceNote", "evidence_note")
	if value, ok := firstBodyValue(body, "required"); ok {
		sets = append(sets, "`required` = ?")
		args = append(args, boolToInt64(truthyBodyValue(value)))
	}
	if value, ok := firstBodyValue(body, "sortOrder", "sort_order"); ok {
		sets = append(sets, "sort_order = ?")
		args = append(args, deliverableInt64BodyValue(value))
	}

	status := firstBodyText(body, "status")
	if status != "" {
		if !workItemDeliverableStatuses[status] {
			return nil, httperror.New(http.StatusBadRequest, "invalid_deliverable_status", "status must be pending/submitted/approved/rejected")
		}
		sets = append(sets, "status = ?")
		args = append(args, status)
		if status == "submitted" {
			sets = append(sets, "submitted_by = ?", "submitted_at = CURRENT_TIMESTAMP")
			args = append(args, uid)
		}
		if status == "approved" {
			if err := a.requireDeliverableQualityBeforeApproval(ctx, deliverableID); err != nil {
				return nil, err
			}
		}
	}

	if len(sets) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_request", "没有需要更新的字段")
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, deliverableID)
	if nameChanged {
		tx, err := a.DB().BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		var lockedProjectID int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id = ? FOR UPDATE", control.ProjectID).Scan(&lockedProjectID); err != nil {
			return nil, err
		}
		if err := ensureDirectDeliverableNameAvailable(ctx, tx, deliverableID, control.ProjectID, newName); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE deliverables SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"id": deliverableID, "updated": true}, nil
	}
	if _, err := a.DB().ExecContext(ctx, "UPDATE deliverables SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	return map[string]any{"id": deliverableID, "updated": true}, nil
}

func ensureDirectDeliverableNameAvailable(
	ctx context.Context,
	tx *sql.Tx,
	deliverableID int64,
	projectID int64,
	name string,
) error {
	var projectOwnerID, milestoneOwnerID, targetID, matterID sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT project_owner_id, milestone_owner_id, target_id, matter_id
		FROM deliverables
		WHERE id = ? AND project_id = ?
		FOR UPDATE
	`, deliverableID, projectID).Scan(&projectOwnerID, &milestoneOwnerID, &targetID, &matterID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	}
	if err != nil {
		return err
	}

	condition := ""
	var ownerID int64
	switch {
	case projectOwnerID.Valid:
		condition, ownerID = "project_owner_id = ?", projectOwnerID.Int64
	case milestoneOwnerID.Valid:
		condition, ownerID = "milestone_owner_id = ?", milestoneOwnerID.Int64
	case targetID.Valid:
		condition, ownerID = "target_id = ?", targetID.Int64
	case matterID.Valid:
		condition, ownerID = "matter_id = ? AND target_id IS NULL", matterID.Int64
	default:
		return httperror.New(http.StatusConflict, "deliverable_owner_missing", "成果缺少有效归属")
	}

	var existingID int64
	err = tx.QueryRowContext(ctx, `
		SELECT id
		FROM deliverables
		WHERE project_id = ?
		  AND id <> ?
		  AND LOWER(TRIM(name)) = LOWER(?)
		  AND `+condition+`
		LIMIT 1
	`, projectID, deliverableID, strings.TrimSpace(name), ownerID).Scan(&existingID)
	if err == nil {
		return deliverableNameConflict(name)
	}
	if err != sql.ErrNoRows {
		return err
	}
	return nil
}

func (a *Adapter) deleteDirectDeliverable(ctx context.Context, rawDeliverableID string, query url.Values) (map[string]any, error) {
	deliverableID, err := parseID(rawDeliverableID, "deliverable_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	control, err := a.loadDirectDeliverableControl(ctx, deliverableID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, control.ProjectID, uid, query); err != nil {
		return nil, err
	}
	if err := a.requireDeliverableMilestoneCompletionUnlocked(ctx, deliverableID); err != nil {
		return nil, err
	}
	if control.TemplateKey != nil && strings.TrimSpace(*control.TemplateKey) != "" {
		return nil, httperror.New(http.StatusBadRequest, "required_deliverable_delete_denied", "系统必选交付物不允许删除")
	}
	if control.Status != "pending" {
		return nil, httperror.New(http.StatusBadRequest, "deliverable_status_delete_denied", "只能删除待准备状态的交付物")
	}
	if _, err := a.DB().ExecContext(ctx, "DELETE FROM deliverables WHERE id = ?", deliverableID); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) loadDirectDeliverableControl(ctx context.Context, deliverableID int64) (directDeliverableControl, error) {
	var control directDeliverableControl
	var templateKey sql.NullString
	err := a.DB().QueryRowContext(ctx, "SELECT project_id, status, template_key FROM deliverables WHERE id = ?", deliverableID).
		Scan(&control.ProjectID, &control.Status, &templateKey)
	if err == sql.ErrNoRows {
		return control, httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	}
	if err != nil {
		return control, err
	}
	control.TemplateKey = nullableString(templateKey)
	return control, nil
}

func scanDeliverableListItem(scanner interface {
	Scan(dest ...any) error
}) (deliverableListItem, error) {
	var item deliverableListItem
	var projectOwnerID, milestoneOwnerID, targetID, matterID sql.NullInt64
	var description, acceptanceCriteria, qualityStatus, currentReviewRoute, documentUUID, documentTitle, documentSource sql.NullString
	var currentSubmissionID sql.NullInt64
	var repoProjectCode, repoFilePath, repoCommitID, evidenceURL, evidenceNote sql.NullString
	var submittedBy, submittedAt, projectCode, targetItemKey, targetTitle, matterItemKey, matterTitle sql.NullString
	var createdAt, updatedAt sql.NullString
	var required, currentCompletenessPassed int64
	if err := scanner.Scan(
		&item.ID,
		&projectOwnerID,
		&milestoneOwnerID,
		&targetID,
		&matterID,
		&item.Name,
		&description,
		&acceptanceCriteria,
		&item.DeliverableType,
		&required,
		&item.SortOrder,
		&item.Status,
		&qualityStatus,
		&currentSubmissionID,
		&currentReviewRoute,
		&currentCompletenessPassed,
		&documentUUID,
		&documentTitle,
		&documentSource,
		&repoProjectCode,
		&repoFilePath,
		&repoCommitID,
		&evidenceURL,
		&evidenceNote,
		&submittedBy,
		&submittedAt,
		&item.ProjectID,
		&projectCode,
		&targetItemKey,
		&targetTitle,
		&matterItemKey,
		&matterTitle,
		&item.CreatedBy,
		&createdAt,
		&updatedAt,
	); err != nil {
		return deliverableListItem{}, err
	}
	item.EntityType, item.EntityID = deliverableEntity(projectOwnerID, milestoneOwnerID, targetID, matterID)
	item.TargetID = nullableInt64(targetID)
	item.MatterID = nullableInt64(matterID)
	item.Description = nullableString(description)
	item.AcceptanceCriteria = nullableString(acceptanceCriteria)
	item.Required = required != 0
	item.QualityStatus = nullStringOr(qualityStatus, "not_submitted")
	item.CurrentSubmissionID = nullableInt64(currentSubmissionID)
	item.CurrentReviewRoute = nullableString(currentReviewRoute)
	item.CurrentCompletenessPassed = currentCompletenessPassed != 0
	item.DocumentUUID = nullableString(documentUUID)
	item.DocumentTitle = nullableString(documentTitle)
	item.DocumentSource = nullStringOr(documentSource, "codocs")
	item.RepoProjectCode = nullableString(repoProjectCode)
	item.RepoFilePath = nullableString(repoFilePath)
	item.RepoCommitID = nullableString(repoCommitID)
	item.EvidenceURL = nullableString(evidenceURL)
	item.EvidenceNote = nullableString(evidenceNote)
	item.SubmittedBy = nullableString(submittedBy)
	item.SubmittedAt = nullableString(submittedAt)
	item.ProjectCode = nullableString(projectCode)
	item.TargetItemKey = nullableString(targetItemKey)
	item.TargetTitle = nullableString(targetTitle)
	item.MatterItemKey = nullableString(matterItemKey)
	item.MatterTitle = nullableString(matterTitle)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	return item, nil
}

func deliverableEntity(projectOwnerID, milestoneOwnerID, targetID, matterID sql.NullInt64) (string, *int64) {
	if projectOwnerID.Valid {
		return "project", &projectOwnerID.Int64
	}
	if milestoneOwnerID.Valid {
		return "milestone", &milestoneOwnerID.Int64
	}
	if targetID.Valid {
		return "target", &targetID.Int64
	}
	if matterID.Valid {
		return "matter", &matterID.Int64
	}
	return "unknown", nil
}

func firstBodyValue(body map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := body[key]
		if ok {
			return value, true
		}
	}
	return nil, false
}

func deliverableInt64BodyValue(value any) int64 {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return 0
	}
	parsed, err := parseOptionalPositiveInt(text)
	if err != nil {
		return 0
	}
	return parsed
}
