package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
)

type workItemDetailComment struct {
	ID         int64  `json:"id"`
	WorkItemID int64  `json:"workItemId"`
	AuthorUID  string `json:"authorUid"`
	Content    string `json:"content"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type workItemDetailChangelog struct {
	ID         int64   `json:"id"`
	WorkItemID int64   `json:"workItemId"`
	FieldName  string  `json:"fieldName"`
	OldValue   *string `json:"oldValue"`
	NewValue   *string `json:"newValue"`
	ChangedBy  string  `json:"changedBy"`
	ChangedAt  string  `json:"changedAt"`
}

type workItemDetailAttachment struct {
	ID          int64   `json:"id"`
	WorkItemID  int64   `json:"workItemId"`
	FileName    string  `json:"fileName"`
	OSSKey      string  `json:"ossKey"`
	FileSize    int64   `json:"fileSize"`
	ContentType *string `json:"contentType"`
	UploadedBy  string  `json:"uploadedBy"`
	UploadedAt  string  `json:"uploadedAt"`
}

type workItemDetailRelation struct {
	ID            int64  `json:"id"`
	SourceID      int64  `json:"sourceId"`
	TargetID      int64  `json:"targetId"`
	RelationType  string `json:"relationType"`
	CreatedAt     string `json:"createdAt"`
	TargetItemKey string `json:"targetItemKey"`
	TargetTitle   string `json:"targetTitle"`
}

func (a *Adapter) workItemDetail(ctx context.Context, rawWorkItemID string, query url.Values) (map[string]any, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireWorkItemProjectMemberOrScopedAdmin(ctx, rawWorkItemID, query); err != nil {
		return nil, err
	}

	item, err := a.workItemDetailItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	comments, err := a.workItemDetailComments(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	changelog, err := a.workItemDetailChangelog(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	attachments, err := a.workItemDetailAttachments(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	relations, err := a.workItemDetailRelations(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	childCount, err := a.workItemChildCount(ctx, workItemID)
	if err != nil {
		return nil, err
	}

	item["childCount"] = childCount
	item["comments"] = comments
	item["changelog"] = changelog
	item["attachments"] = attachments
	item["relations"] = relations
	return item, nil
}

func (a *Adapter) workItemDetailItem(ctx context.Context, workItemID int64) (map[string]any, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT
			wi.id,
			wi.project_id,
			wi.milestone_id,
			wi.item_number,
			wi.item_key,
			wi.type,
			wi.title,
			wi.description,
			DATE_FORMAT(wi.start_date, '%Y-%m-%d') AS start_date,
			wi.status,
			wi.priority,
			wi.severity,
			wi.weight,
			wi.assignee_uid,
			wi.reporter_uid,
			DATE_FORMAT(wi.due_date, '%Y-%m-%d') AS due_date,
			wi.estimated_hours,
			wi.parent_id,
			wi.sort_order,
			wi.approval_status,
			wi.workflow_instance_id,
			DATE_FORMAT(wi.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			ml.name AS milestone_name
		FROM work_items wi
		LEFT JOIN milestones ml ON ml.id = wi.milestone_id
		WHERE wi.id = ?
	`, workItemID)

	var (
		id                 int64
		projectID          int64
		milestoneID        int64
		itemNumber         int64
		itemKey            string
		itemType           string
		title              string
		description        sql.NullString
		startDate          sql.NullString
		status             string
		priority           string
		severity           sql.NullString
		weight             int64
		assigneeUID        sql.NullString
		reporterUID        sql.NullString
		dueDate            sql.NullString
		estimatedHours     sql.NullFloat64
		parentID           sql.NullInt64
		sortOrder          int64
		approvalStatus     string
		workflowInstanceID sql.NullString
		createdAt          string
		updatedAt          string
		milestoneName      sql.NullString
	)
	if err := row.Scan(
		&id,
		&projectID,
		&milestoneID,
		&itemNumber,
		&itemKey,
		&itemType,
		&title,
		&description,
		&startDate,
		&status,
		&priority,
		&severity,
		&weight,
		&assigneeUID,
		&reporterUID,
		&dueDate,
		&estimatedHours,
		&parentID,
		&sortOrder,
		&approvalStatus,
		&workflowInstanceID,
		&createdAt,
		&updatedAt,
		&milestoneName,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("work item disappeared after access guard: %w", err)
		}
		return nil, fmt.Errorf("query work item detail: %w", err)
	}

	return map[string]any{
		"id":                 id,
		"projectId":          projectID,
		"milestoneId":        milestoneID,
		"itemNumber":         itemNumber,
		"itemKey":            itemKey,
		"type":               itemType,
		"title":              title,
		"description":        nullableString(description),
		"startDate":          nullableString(startDate),
		"status":             status,
		"priority":           priority,
		"severity":           nullableString(severity),
		"weight":             weight,
		"assigneeUid":        nullableString(assigneeUID),
		"reporterUid":        nullableString(reporterUID),
		"dueDate":            nullableString(dueDate),
		"estimatedHours":     nullableFloat64(estimatedHours),
		"parentId":           nullableInt64(parentID),
		"sortOrder":          sortOrder,
		"approvalStatus":     approvalStatus,
		"workflowInstanceId": nullableString(workflowInstanceID),
		"createdAt":          createdAt,
		"updatedAt":          updatedAt,
		"milestoneName":      nullableString(milestoneName),
	}, nil
}

func (a *Adapter) workItemDetailComments(ctx context.Context, workItemID int64) ([]workItemDetailComment, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, author_uid, content,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM work_item_comments
		WHERE work_item_id = ?
		ORDER BY created_at DESC
		LIMIT 20
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item comments: %w", err)
	}
	defer rows.Close()

	comments := make([]workItemDetailComment, 0)
	for rows.Next() {
		var comment workItemDetailComment
		if err := rows.Scan(&comment.ID, &comment.WorkItemID, &comment.AuthorUID, &comment.Content, &comment.CreatedAt, &comment.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan work item comment: %w", err)
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return comments, nil
}

func (a *Adapter) workItemDetailChangelog(ctx context.Context, workItemID int64) ([]workItemDetailChangelog, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, field_name, old_value, new_value, changed_by,
		       DATE_FORMAT(changed_at, '%Y-%m-%d %H:%i:%s') AS changed_at
		FROM work_item_changelog
		WHERE work_item_id = ?
		ORDER BY changed_at DESC
		LIMIT 20
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item changelog: %w", err)
	}
	defer rows.Close()

	items := make([]workItemDetailChangelog, 0)
	for rows.Next() {
		var item workItemDetailChangelog
		var oldValue, newValue sql.NullString
		if err := rows.Scan(&item.ID, &item.WorkItemID, &item.FieldName, &oldValue, &newValue, &item.ChangedBy, &item.ChangedAt); err != nil {
			return nil, fmt.Errorf("scan work item changelog: %w", err)
		}
		item.OldValue = nullableString(oldValue)
		item.NewValue = nullableString(newValue)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) workItemDetailAttachments(ctx context.Context, workItemID int64) ([]workItemDetailAttachment, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, file_name, oss_key, file_size, content_type, uploaded_by,
		       DATE_FORMAT(uploaded_at, '%Y-%m-%d %H:%i:%s') AS uploaded_at
		FROM work_item_attachments
		WHERE work_item_id = ?
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item attachments: %w", err)
	}
	defer rows.Close()

	items := make([]workItemDetailAttachment, 0)
	for rows.Next() {
		var item workItemDetailAttachment
		var contentType sql.NullString
		if err := rows.Scan(&item.ID, &item.WorkItemID, &item.FileName, &item.OSSKey, &item.FileSize, &contentType, &item.UploadedBy, &item.UploadedAt); err != nil {
			return nil, fmt.Errorf("scan work item attachment: %w", err)
		}
		item.ContentType = nullableString(contentType)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) workItemDetailRelations(ctx context.Context, workItemID int64) ([]workItemDetailRelation, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT r.id, r.source_id, r.target_id, r.relation_type,
		       DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       t.item_key AS target_item_key,
		       t.title AS target_title
		FROM work_item_relations r
		INNER JOIN work_items t ON t.id = r.target_id
		WHERE r.source_id = ?
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item relations: %w", err)
	}
	defer rows.Close()

	items := make([]workItemDetailRelation, 0)
	for rows.Next() {
		var item workItemDetailRelation
		if err := rows.Scan(&item.ID, &item.SourceID, &item.TargetID, &item.RelationType, &item.CreatedAt, &item.TargetItemKey, &item.TargetTitle); err != nil {
			return nil, fmt.Errorf("scan work item relation: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) workItemChildCount(ctx context.Context, workItemID int64) (int64, error) {
	var count int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) AS child_count FROM work_items WHERE parent_id = ?", workItemID).Scan(&count); err != nil {
		return 0, fmt.Errorf("query work item child count: %w", err)
	}
	return count, nil
}
