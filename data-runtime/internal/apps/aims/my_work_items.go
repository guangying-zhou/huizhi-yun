package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
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
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_filter", "invalid work item filter")
	}

	if tier != "" {
		conditions = append(conditions, "wi.tier = ?")
		args = append(args, tier)
	}
	projectOptionConditions := append([]string(nil), conditions...)
	projectOptionArgs := append([]any(nil), args...)
	if projectID != "" && projectID != "all" {
		conditions = append(conditions, "wi.project_id = ?")
		args = append(args, projectID)
	}
	if search != "" {
		conditions = append(conditions, "(wi.title LIKE ? OR wi.item_key LIKE ? OR p.name LIKE ? OR p.project_code LIKE ? OR wi.assignee_uid LIKE ?)")
		keyword := "%" + search + "%"
		args = append(args, keyword, keyword, keyword, keyword, keyword)
	}

	whereSQL := ""
	if len(conditions) > 0 {
		whereSQL = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Explicit pagination is opt-in. Existing callers retain their response shape;
	// only the archived legacy view retains its historical first-100 limit.
	pageRequested := query.Has("page") || query.Has("pageSize")
	if !pageRequested && strings.TrimSpace(query.Get("status")) != "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_pagination", "status requires pagination")
	}
	if pageRequested {
		page, pageSize, err := myWorkItemPage(query)
		if err != nil {
			return nil, err
		}
		status := strings.TrimSpace(query.Get("status"))
		if status != "" {
			switch status {
			case "planning", "todo", "in_progress", "in_review", "completed":
			default:
				return nil, httperror.New(http.StatusBadRequest, "invalid_status", "invalid work item status")
			}
		}
		return a.myWorkItemsPage(ctx, fromSQL, conditions, args, projectOptionConditions, projectOptionArgs, orderBySQL, status, page, pageSize)
	}
	limitSQL := ""
	if filter == "archived" {
		limitSQL = "LIMIT 100"
	}
	sqlText := strings.Join([]string{fromSQL, whereSQL, orderBySQL, limitSQL}, "\n")
	rows, err := a.DB().QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, fmt.Errorf("query my work items: %w", err)
	}
	defer rows.Close()
	items, err := scanMyWorkItems(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items)}, nil
}

func scanMyWorkItems(rows *sql.Rows) ([]myWorkItem, error) {
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
	return items, nil
}

func myWorkItemPage(query url.Values) (int, int, error) {
	if query.Has("pageSize") && query.Has("page_size") {
		return 0, 0, httperror.New(http.StatusBadRequest, "invalid_pagination", "duplicate page size")
	}
	read := func(key string, fallback, max int) (int, error) {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			return fallback, nil
		}
		if strings.HasPrefix(value, "0") {
			return 0, httperror.New(http.StatusBadRequest, "invalid_pagination", "invalid pagination")
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > max {
			return 0, httperror.New(http.StatusBadRequest, "invalid_pagination", "invalid pagination")
		}
		return n, nil
	}
	page, err := read("page", 1, 1000000)
	if err != nil {
		return 0, 0, err
	}
	pageSizeKey := "pageSize"
	if query.Has("page_size") {
		pageSizeKey = "page_size"
	}
	pageSize, err := read(pageSizeKey, 20, 100)
	return page, pageSize, err
}

func (a *Adapter) myWorkItemsPage(ctx context.Context, selectSQL string, conditions []string, args []any, projectOptionConditions []string, projectOptionArgs []any, orderSQL, status string, page, pageSize int) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("begin my work item page: %w", err)
	}
	defer tx.Rollback()
	whereSQL := "WHERE " + strings.Join(conditions, " AND ")
	// The member filter adds a member JOIN with a bound uid. Reuse the full FROM
	// clause (rather than reconstructing it) for COUNT and item visibility.
	fromIndex := strings.Index(selectSQL, "FROM work_items wi")
	if fromIndex < 0 {
		return nil, fmt.Errorf("my work item FROM missing")
	}
	fromSQL := selectSQL[fromIndex:]
	projectRows, err := tx.QueryContext(ctx,
		"SELECT DISTINCT wi.project_id, p.project_code, p.name "+fromSQL+" WHERE "+strings.Join(projectOptionConditions, " AND ")+" ORDER BY p.project_code, wi.project_id", projectOptionArgs...)
	if err != nil {
		return nil, fmt.Errorf("query my work item projects: %w", err)
	}
	projectOptions := make([]map[string]any, 0)
	for projectRows.Next() {
		var id int64
		var code, name string
		if err := projectRows.Scan(&id, &code, &name); err != nil {
			projectRows.Close()
			return nil, err
		}
		projectOptions = append(projectOptions, map[string]any{"id": id, "projectCode": code, "projectName": name})
	}
	if err := projectRows.Err(); err != nil {
		projectRows.Close()
		return nil, err
	}
	projectRows.Close()
	summaryRows, err := tx.QueryContext(ctx, "SELECT wi.status, COUNT(*) FROM "+strings.TrimPrefix(fromSQL, "FROM ")+" "+whereSQL+" GROUP BY wi.status", args...)
	if err != nil {
		return nil, fmt.Errorf("summarize my work items: %w", err)
	}
	statusCounts := map[string]int64{}
	var total int64
	for summaryRows.Next() {
		var key string
		var count int64
		if err := summaryRows.Scan(&key, &count); err != nil {
			summaryRows.Close()
			return nil, err
		}
		statusCounts[key] = count
		total += count
	}
	if err := summaryRows.Err(); err != nil {
		summaryRows.Close()
		return nil, err
	}
	summaryRows.Close()
	var projectCount int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(DISTINCT wi.project_id) "+fromSQL+" "+whereSQL, args...).Scan(&projectCount); err != nil {
		return nil, fmt.Errorf("count my work item projects: %w", err)
	}
	filteredConditions := append([]string(nil), conditions...)
	filteredArgs := append([]any(nil), args...)
	if status != "" {
		filteredConditions = append(filteredConditions, "wi.status = ?")
		filteredArgs = append(filteredArgs, status)
	}
	filteredWhere := "WHERE " + strings.Join(filteredConditions, " AND ")
	filteredTotal := total
	if status != "" {
		filteredTotal = statusCounts[status]
	}
	queryArgs := append(filteredArgs, pageSize, (page-1)*pageSize)
	rows, err := tx.QueryContext(ctx, selectSQL+" "+filteredWhere+" "+orderSQL+", wi.id DESC LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("query my work item page: %w", err)
	}
	items, err := scanMyWorkItems(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit my work item page: %w", err)
	}
	return map[string]any{"items": items, "total": filteredTotal, "page": page, "pageSize": pageSize,
		"summary": map[string]any{"total": total, "projectCount": projectCount, "status": statusCounts}, "projects": projectOptions}, nil
}
