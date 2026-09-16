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

type myWorkItem struct {
	ID            int64   `json:"id"`
	ProjectID     int64   `json:"projectId"`
	ProjectCode   string  `json:"projectCode"`
	ProjectName   string  `json:"projectName"`
	MilestoneID   *int64  `json:"milestoneId"`
	MilestoneName *string `json:"milestoneName"`
	ItemKey       string  `json:"itemKey"`
	Tier          string  `json:"tier"`
	Type          string  `json:"type"`
	TemplateKey   *string `json:"templateKey"`
	Title         string  `json:"title"`
	Status        string  `json:"status"`
	Priority      string  `json:"priority"`
	Severity      *string `json:"severity"`
	Weight        float64 `json:"weight"`
	AssigneeUID   *string `json:"assigneeUid"`
	ReporterUID   *string `json:"reporterUid"`
	ParentID      *int64  `json:"parentId"`
	DueDate       *string `json:"dueDate"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

func (a *Adapter) myWorkItems(ctx context.Context, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	uid := strings.TrimSpace(query.Get("uid"))
	if currentUser == "" {
		currentUser = uid
	}
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if uid == "" {
		uid = currentUser
	}
	if uid != currentUser {
		return nil, httperror.New(http.StatusForbidden, "forbidden", "cannot query another user's work items")
	}

	filter := strings.TrimSpace(query.Get("filter"))
	if filter == "" {
		filter = "assigned"
	}
	tier := strings.TrimSpace(query.Get("tier"))
	search := strings.TrimSpace(query.Get("search"))
	projectID := strings.TrimSpace(query.Get("projectId"))
	if projectID == "" {
		projectID = strings.TrimSpace(query.Get("project_id"))
	}

	baseSelect := `
		SELECT
			wi.id,
			wi.project_id,
			p.project_code,
			p.name AS project_name,
			wi.milestone_id,
			ml.name AS milestone_name,
			wi.item_key,
			wi.tier,
			wi.type,
			wi.template_key,
			wi.title,
			wi.status,
			wi.priority,
			wi.severity,
			wi.weight,
			wi.assignee_uid,
			wi.reporter_uid,
			wi.parent_id,
			DATE_FORMAT(wi.due_date, '%Y-%m-%d') AS due_date,
			DATE_FORMAT(wi.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN milestones ml ON ml.id = wi.milestone_id
	`

	fromSQL := baseSelect
	conditions := make([]string, 0)
	args := make([]any, 0)
	orderBySQL := ""
	limitSQL := ""

	switch filter {
	case "assigned":
		conditions = append(conditions, "wi.assignee_uid = ?", "wi.status != 'completed'")
		args = append(args, uid)
		orderBySQL = "ORDER BY FIELD(wi.priority, 'P0', 'P1', 'P2', 'P3'), wi.created_at DESC"
	case "member":
		fromSQL = baseSelect + `
			LEFT JOIN aims_project_members m ON m.project_id = wi.project_id AND m.uid = ?
		`
		conditions = append(conditions, "wi.status != 'completed'", "(p.leader_uid = ? OR (m.uid IS NOT NULL AND m.status = 'active'))")
		args = append(args, uid, uid)
		orderBySQL = "ORDER BY wi.updated_at DESC"
	case "created":
		conditions = append(conditions, "wi.reporter_uid = ?")
		args = append(args, uid)
		orderBySQL = "ORDER BY wi.created_at DESC"
	case "verify":
		conditions = append(conditions, "wi.reporter_uid = ?", "wi.status = 'in_review'")
		args = append(args, uid)
		orderBySQL = "ORDER BY wi.updated_at DESC"
	case "archived":
		conditions = append(conditions, "(wi.assignee_uid = ? OR wi.reporter_uid = ?)", "wi.status = 'completed'")
		args = append(args, uid, uid)
		orderBySQL = "ORDER BY wi.updated_at DESC"
		limitSQL = "LIMIT 100"
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_filter", "invalid work item filter")
	}

	if projectID != "" && projectID != "all" {
		conditions = append(conditions, "wi.project_id = ?")
		args = append(args, projectID)
	}
	if tier != "" {
		conditions = append(conditions, "wi.tier = ?")
		args = append(args, tier)
	}
	if search != "" {
		conditions = append(conditions, "(wi.title LIKE ? OR wi.item_key LIKE ? OR p.name LIKE ? OR p.project_code LIKE ?)")
		keyword := "%" + search + "%"
		args = append(args, keyword, keyword, keyword, keyword)
	}

	whereSQL := ""
	if len(conditions) > 0 {
		whereSQL = "WHERE " + strings.Join(conditions, " AND ")
	}

	sqlText := strings.Join([]string{fromSQL, whereSQL, orderBySQL, limitSQL}, "\n")
	rows, err := a.DB().QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, fmt.Errorf("query my work items: %w", err)
	}
	defer rows.Close()

	items := make([]myWorkItem, 0)
	for rows.Next() {
		var item myWorkItem
		var milestoneID sql.NullInt64
		var milestoneName sql.NullString
		var templateKey sql.NullString
		var severity sql.NullString
		var assigneeUID sql.NullString
		var reporterUID sql.NullString
		var parentID sql.NullInt64
		var dueDate sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.ProjectCode,
			&item.ProjectName,
			&milestoneID,
			&milestoneName,
			&item.ItemKey,
			&item.Tier,
			&item.Type,
			&templateKey,
			&item.Title,
			&item.Status,
			&item.Priority,
			&severity,
			&item.Weight,
			&assigneeUID,
			&reporterUID,
			&parentID,
			&dueDate,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan my work item: %w", err)
		}

		item.MilestoneID = nullableInt64(milestoneID)
		item.MilestoneName = nullableString(milestoneName)
		item.TemplateKey = nullableString(templateKey)
		item.Severity = nullableString(severity)
		item.AssigneeUID = nullableString(assigneeUID)
		item.ReporterUID = nullableString(reporterUID)
		item.ParentID = nullableInt64(parentID)
		item.DueDate = nullableString(dueDate)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"items": items,
		"total": len(items),
	}, nil
}
