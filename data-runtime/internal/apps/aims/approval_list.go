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

type approvalListItem struct {
	ID             int64   `json:"id"`
	EntityType     string  `json:"entityType"`
	EntityID       int64   `json:"entityId"`
	EntityCode     *string `json:"entityCode"`
	Transition     string  `json:"transition"`
	Title          *string `json:"title"`
	RequestedBy    string  `json:"requestedBy"`
	RequestedAt    string  `json:"requestedAt"`
	RequestComment *string `json:"requestComment"`
	ReviewerUID    *string `json:"reviewerUid"`
	Status         string  `json:"status"`
	ReviewedAt     *string `json:"reviewedAt"`
	ReviewComment  *string `json:"reviewComment"`
	ProjectID      int64   `json:"projectId"`
	ProjectCode    *string `json:"projectCode"`
	CreatedAt      string  `json:"createdAt"`
}

func (a *Adapter) approvalList(ctx context.Context, query url.Values) ([]approvalListItem, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	currentUser := strings.TrimSpace(query.Get("current_user"))

	where, args, err := approvalListWhere(query, currentUser)
	if err != nil {
		return nil, err
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			a.id,
			CASE
				WHEN a.project_owner_id IS NOT NULL THEN 'project'
				WHEN a.milestone_owner_id IS NOT NULL THEN 'milestone'
				ELSE 'work_item'
			END AS entity_type,
			COALESCE(a.project_owner_id, a.milestone_owner_id, a.work_item_owner_id) AS entity_id,
			a.entity_code,
			a.transition,
			a.title,
			a.requested_by,
			DATE_FORMAT(a.requested_at, '%Y-%m-%d %H:%i:%s') AS requested_at,
			a.request_comment,
			a.reviewer_uid,
			a.status,
			DATE_FORMAT(a.reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewed_at,
			a.review_comment,
			a.project_id,
			a.project_code,
			DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM approval_records a
		LEFT JOIN aims_projects p ON p.id = a.project_id
		`+whereSQL+`
		ORDER BY a.created_at DESC
		LIMIT 100
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query approvals: %w", err)
	}
	defer rows.Close()

	items := make([]approvalListItem, 0)
	for rows.Next() {
		item, err := scanApprovalListItem(rows)
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

func approvalListWhere(query url.Values, currentUser string) ([]string, []any, error) {
	where := make([]string, 0)
	args := make([]any, 0)

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, "(a.reviewer_uid = ? OR a.requested_by = ? OR (p.id IS NOT NULL AND "+visibilityWhere+"))")
	args = append(args, currentUser, currentUser)
	args = append(args, visibilityArgs...)

	if reviewerUID := strings.TrimSpace(firstQueryText(query, "reviewer_uid", "reviewerUid")); reviewerUID != "" {
		where = append(where, "a.reviewer_uid = ?")
		args = append(args, reviewerUID)
	}
	if requestedBy := strings.TrimSpace(firstQueryText(query, "requested_by", "requestedBy")); requestedBy != "" {
		where = append(where, "a.requested_by = ?")
		args = append(args, requestedBy)
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "a.status = ?")
		args = append(args, status)
	}

	entityType := strings.TrimSpace(firstQueryText(query, "entity_type", "entityType"))
	if entityType != "" {
		normalized, err := normalizeApprovalEntityType(entityType)
		if err != nil {
			return nil, nil, err
		}
		switch normalized {
		case "project":
			where = append(where, "a.project_owner_id IS NOT NULL")
		case "milestone":
			where = append(where, "a.milestone_owner_id IS NOT NULL")
		default:
			where = append(where, "a.work_item_owner_id IS NOT NULL")
		}
	}

	entityIDText := strings.TrimSpace(firstQueryText(query, "entity_id", "entityId"))
	if entityIDText != "" {
		entityID, err := parseID(entityIDText, "entity_id")
		if err != nil {
			return nil, nil, err
		}
		normalized := ""
		if entityType != "" {
			var err error
			normalized, err = normalizeApprovalEntityType(entityType)
			if err != nil {
				return nil, nil, err
			}
		}
		switch normalized {
		case "project":
			where = append(where, "a.project_owner_id = ?")
			args = append(args, entityID)
		case "milestone":
			where = append(where, "a.milestone_owner_id = ?")
			args = append(args, entityID)
		case "work_item":
			where = append(where, "a.work_item_owner_id = ?")
			args = append(args, entityID)
		default:
			where = append(where, "(a.project_owner_id = ? OR a.milestone_owner_id = ? OR a.work_item_owner_id = ?)")
			args = append(args, entityID, entityID, entityID)
		}
	}

	if projectIDText := strings.TrimSpace(firstQueryText(query, "project_id", "projectId")); projectIDText != "" {
		projectID, err := parseID(projectIDText, "project_id")
		if err != nil {
			return nil, nil, err
		}
		where = append(where, "a.project_id = ?")
		args = append(args, projectID)
	}

	return where, args, nil
}

func normalizeApprovalEntityType(entityType string) (string, error) {
	switch strings.TrimSpace(entityType) {
	case "project":
		return "project", nil
	case "milestone":
		return "milestone", nil
	case "task", "work_item":
		return "work_item", nil
	default:
		return "", httperror.New(http.StatusBadRequest, "unsupported_entity_type", "unsupported approval entity type")
	}
}

func scanApprovalListItem(rows *sql.Rows) (approvalListItem, error) {
	var item approvalListItem
	var entityCode, title, requestComment, reviewerUID, reviewedAt, reviewComment, projectCode sql.NullString
	if err := rows.Scan(
		&item.ID,
		&item.EntityType,
		&item.EntityID,
		&entityCode,
		&item.Transition,
		&title,
		&item.RequestedBy,
		&item.RequestedAt,
		&requestComment,
		&reviewerUID,
		&item.Status,
		&reviewedAt,
		&reviewComment,
		&item.ProjectID,
		&projectCode,
		&item.CreatedAt,
	); err != nil {
		return item, fmt.Errorf("scan approval: %w", err)
	}
	item.EntityCode = nullableString(entityCode)
	item.Title = nullableString(title)
	item.RequestComment = nullableString(requestComment)
	item.ReviewerUID = nullableString(reviewerUID)
	item.ReviewedAt = nullableString(reviewedAt)
	item.ReviewComment = nullableString(reviewComment)
	item.ProjectCode = nullableString(projectCode)
	return item, nil
}
