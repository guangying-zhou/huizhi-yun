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

type projectWorkItemRow struct {
	ID                          int64
	ProjectID                   int64
	MilestoneID                 *int64
	ItemNumber                  int64
	ItemKey                     string
	Type                        string
	Tier                        string
	Title                       string
	Description                 *string
	StartDate                   *string
	Status                      string
	Priority                    string
	Severity                    *string
	Weight                      int64
	AssigneeUID                 *string
	ReporterUID                 *string
	DueDate                     *string
	EstimatedHours              *float64
	ParentID                    *int64
	SortOrder                   int64
	Required                    bool
	TemplateKey                 *string
	RoutineScope                *string
	BeneficiaryDeptCode         *string
	IsUnplanned                 bool
	CarryoverOriginItemKey      *string
	CarryoverOriginMilestoneID  *int64
	CarryoverCount              int64
	CarryoverGovernanceAbnormal bool
	ApprovalStatus              string
	CreatedAt                   string
	UpdatedAt                   string
	MilestoneName               *string
	ChildCount                  int64
	SourceTicketCode            *string
	CustomerCode                *string
	EnvironmentCode             *string
	ResponseDueAt               *string
	ResolutionDueAt             *string
	SLAStatusSnapshot           *string
	FirstRespondedAt            *string
	ResolvedAt                  *string
	ServiceExtLastSyncedAt      *string
}

type projectWorkItemProject struct {
	ID              int64
	ProjectCode     string
	LifecycleStatus string
	Category        string
}

func (a *Adapter) projectWorkItems(ctx context.Context, rawProjectID string, query url.Values) (any, error) {
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}

	where, args, err := projectWorkItemsWhere(projectID, query)
	if err != nil {
		return nil, err
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	if strings.TrimSpace(query.Get("view")) == "board" {
		rows, err := a.queryProjectWorkItemRows(ctx, whereSQL, args, 0, 0, "wi.sort_order ASC, wi.created_at ASC")
		if err != nil {
			return nil, err
		}
		board := map[string][]map[string]any{}
		for _, row := range rows {
			item := row.mapProjectWorkItem()
			status := strings.TrimSpace(row.Status)
			if status == "" {
				status = "unknown"
			}
			board[status] = append(board[status], item)
		}
		return board, nil
	}

	page := projectWorkItemsPage(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM work_items wi LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id "+whereSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count project work items: %w", err)
	}
	rows, err := a.queryProjectWorkItemRows(ctx, whereSQL, args, page.pageSize, page.offset, "wi.sort_order ASC, wi.created_at DESC")
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.mapProjectWorkItem())
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) directWorkItems(ctx context.Context, query url.Values) (any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	where, args, err := directWorkItemsWhere(query, uid)
	if err != nil {
		return nil, err
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	if strings.TrimSpace(query.Get("view")) == "board" {
		rows, err := a.queryDirectWorkItemRows(ctx, whereSQL, args, 0, 0, "wi.sort_order ASC, wi.created_at ASC")
		if err != nil {
			return nil, err
		}
		board := map[string][]map[string]any{}
		for _, row := range rows {
			item := row.mapProjectWorkItem()
			status := strings.TrimSpace(row.Status)
			if status == "" {
				status = "unknown"
			}
			board[status] = append(board[status], item)
		}
		return board, nil
	}

	page := projectWorkItemsPage(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		`+whereSQL,
		args...,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("count direct work items: %w", err)
	}
	rows, err := a.queryDirectWorkItemRows(ctx, whereSQL, args, page.pageSize, page.offset, "wi.sort_order ASC, wi.created_at DESC")
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.mapProjectWorkItem())
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) createProjectWorkItem(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/work-items", query, map[string]any{}, rawProjectID); err != nil {
		return nil, err
	}

	itemType := strings.TrimSpace(firstBodyText(body, "type"))
	title := strings.TrimSpace(firstBodyText(body, "title"))
	if title == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_title", "title is required")
	}
	tier := strings.TrimSpace(firstBodyText(body, "tier"))
	if tier == "" {
		tier = "matter"
	}
	project, err := a.projectWorkItemProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	itemType, tier, err = normalizeProjectWorkItemKind(project.Category, itemType, tier)
	if err != nil {
		return nil, err
	}
	milestoneID, milestoneErr := bodyInt64(body, "milestone_id", "milestoneId")
	if project.Category == "routine" {
		if milestoneErr == nil && milestoneID > 0 {
			return nil, httperror.New(http.StatusBadRequest, "routine_milestone_not_allowed", "routine work items do not belong to milestones")
		}
		milestoneID = 0
	} else {
		if milestoneErr != nil || milestoneID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "missing_milestone_id", "milestone_id is required")
		}
		if err := a.requireMilestoneCompletionUnlocked(ctx, milestoneID); err != nil {
			return nil, err
		}
	}
	routineScope, beneficiaryDeptCode, isUnplanned, err := normalizeRoutineWorkItemInput(project.Category, body, true)
	if err != nil {
		return nil, err
	}
	if err := validateProjectWorkItemLifecycle(project.LifecycleStatus, tier); err != nil {
		return nil, err
	}
	if tier == "target" && itemType == "requirement" {
		if err := a.rejectPStageRequirementTarget(ctx, projectID, milestoneID); err != nil {
			return nil, err
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	itemNumber, err := nextDecomposeItemNumber(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	itemKeyPrefix := strings.TrimSpace(project.ProjectCode)
	if itemKeyPrefix == "" {
		itemKeyPrefix = "AIMS"
	}
	itemKey := fmt.Sprintf("%s-%d", itemKeyPrefix, itemNumber)

	status := strings.TrimSpace(firstBodyText(body, "status"))
	if status == "" && project.Category == "routine" {
		status = "todo"
	} else if status == "" {
		if tier == "target" {
			status = "planning"
		} else {
			status = "todo"
		}
	}
	reviewLevel := normalizeProjectWorkItemReviewLevel(body)

	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items
		  (project_id, milestone_id, item_number, item_key, type, tier, title, description,
		   start_date, status, priority, severity, weight, assignee_uid, reporter_uid, due_date,
		   estimated_hours, parent_id, sort_order, review_level, `+"`required`"+`, template_key,
		   routine_scope, beneficiary_dept_code, is_unplanned)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
	`,
		projectID,
		nullablePositiveInt64(milestoneID),
		itemNumber,
		itemKey,
		itemType,
		tier,
		title,
		nullableText(firstBodyText(body, "description")),
		nullableText(firstBodyText(body, "start_date", "startDate")),
		status,
		firstNonEmptyText(firstBodyText(body, "priority"), "P2"),
		nullableText(firstBodyText(body, "severity")),
		bodyIntDefault(body, 1, "weight"),
		nullableText(firstBodyText(body, "assignee_uid", "assigneeUid")),
		uid,
		nullableText(firstBodyText(body, "due_date", "dueDate")),
		nullableFloatValue(optionalBodyFloat(body, "estimated_hours", "estimatedHours")),
		nullableOptionalID(body, "parent_id", "parentId"),
		reviewLevel,
		boolToInt(bodyBool(body, "required")),
		nullableText(firstBodyText(body, "template_key", "templateKey")),
		routineScope,
		beneficiaryDeptCode,
		boolToInt(isUnplanned),
	)
	if err != nil {
		return nil, err
	}
	workItemID, _ := result.LastInsertId()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
		VALUES (?, 'created', NULL, ?, ?)
	`, workItemID, itemKey, uid); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":         workItemID,
		"itemNumber": itemNumber,
		"itemKey":    itemKey,
	}, nil
}

func (a *Adapter) projectWorkItemProject(ctx context.Context, projectID int64) (projectWorkItemProject, error) {
	var project projectWorkItemProject
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_code, lifecycle_status, category
		FROM aims_projects
		WHERE id = ?
	`, projectID).Scan(&project.ID, &project.ProjectCode, &project.LifecycleStatus, &project.Category)
	if err == sql.ErrNoRows {
		return projectWorkItemProject{}, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return projectWorkItemProject{}, err
	}
	return project, nil
}

func validateProjectWorkItemLifecycle(status string, tier string) error {
	status = strings.TrimSpace(status)
	if tier == "target" {
		if status == "draft" || status == "active" {
			return nil
		}
		return httperror.New(http.StatusConflict, "project_structure_not_editable", projectWorkItemStructureBlockedReason(status))
	}
	if status == "active" {
		return nil
	}
	return httperror.New(http.StatusConflict, "project_not_active", projectWorkItemReadonlyReason(status))
}

func projectWorkItemReadonlyReason(status string) string {
	switch status {
	case "draft":
		return "项目尚未立项，需完成立项审批后方可执行此操作"
	case "approval_pending":
		return "项目立项审批中，请等待审批通过"
	case "paused":
		return "项目已暂停，恢复后可继续操作"
	case "completed":
		return "项目已完成"
	case "archived":
		return "项目已归档"
	default:
		return "项目当前状态不允许此操作"
	}
}

func projectWorkItemStructureBlockedReason(status string) string {
	switch status {
	case "approval_pending":
		return "项目立项审批中，禁止修改工作目标结构"
	case "paused":
		return "项目已暂停，禁止修改工作目标结构"
	case "completed":
		return "项目已完成，禁止修改工作目标结构"
	case "archived":
		return "项目已归档，禁止修改工作目标结构"
	default:
		return "项目当前状态不允许修改工作目标结构"
	}
}

func (a *Adapter) rejectPStageRequirementTarget(ctx context.Context, projectID int64, milestoneID int64) error {
	var pivrStage sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT pivr_stage
		FROM milestones
		WHERE id = ? AND project_id = ?
	`, milestoneID, projectID).Scan(&pivrStage)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if pivrStage.Valid && strings.TrimSpace(pivrStage.String) == "P" {
		return httperror.New(http.StatusBadRequest, "p_stage_requirement_target_not_allowed", "P 阶段里程碑下不允许创建需求类工作目标")
	}
	return nil
}

func normalizeProjectWorkItemReviewLevel(body map[string]any) int64 {
	value, ok := firstProjectWorkItemBodyValue(body, "review_level", "reviewLevel")
	if !ok {
		return 1
	}
	var number float64
	if _, err := fmt.Sscan(fmt.Sprint(value), &number); err != nil {
		return 1
	}
	rounded := int64(number)
	if number-float64(rounded) >= 0.5 {
		rounded++
	}
	if rounded < 0 {
		return 0
	}
	if rounded > 4 {
		return 4
	}
	return rounded
}

func firstProjectWorkItemBodyValue(body map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := body[key]
		if ok && value != nil {
			return value, true
		}
	}
	return nil, false
}

func projectWorkItemsPage(query url.Values) projectListPage {
	page := parseProjectPositiveInt(query.Get("page"), 1)
	pageSize := parseProjectPositiveInt(firstNonEmptyProjectParam(query, "pageSize", "page_size", "limit"), 20)
	page = clampProjectInt(page, 1, 100000)
	pageSize = clampProjectInt(pageSize, 1, 100)
	return projectListPage{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func projectWorkItemsWhere(projectID int64, query url.Values) ([]string, []any, error) {
	where := []string{"wi.project_id = ?"}
	args := []any{projectID}
	serviceDesk := projectWorkItemsServiceDeskQuery(query)

	if value := strings.TrimSpace(query.Get("type")); value != "" {
		where = append(where, "wi.type = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("status")); value != "" {
		where = append(where, "wi.status = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "milestoneId", "milestone_id")); value != "" {
		id, err := parseID(value, "milestone_id")
		if err != nil {
			return nil, nil, err
		}
		where = append(where, "wi.milestone_id = ?")
		args = append(args, id)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "assigneeUid", "assignee_uid")); value != "" {
		where = append(where, "wi.assignee_uid = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("priority")); value != "" {
		where = append(where, "wi.priority = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("search")); value != "" {
		where = append(where, "(wi.title LIKE ? OR wi.item_key LIKE ? OR wse.source_ticket_code LIKE ? OR wse.customer_code LIKE ? OR wse.environment_code LIKE ?)")
		keyword := "%" + value + "%"
		args = append(args, keyword, keyword, keyword, keyword, keyword)
	}
	if serviceDesk {
		where = append(where, "wse.source_ticket_code IS NOT NULL")
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "customerCode", "customer_code")); value != "" {
		where = append(where, "wse.customer_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "environmentCode", "environment_code")); value != "" {
		where = append(where, "wse.environment_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "slaStatusSnapshot", "sla_status_snapshot", "slaStatus")); value != "" {
		where = append(where, "wse.sla_status_snapshot = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("tier")); value != "" {
		where = append(where, "wi.tier = ?")
		args = append(args, value)
	} else if value, ok := firstProjectWorkItemQueryValue(query, "parentId", "parent_id"); ok {
		if strings.TrimSpace(value) == "" || strings.TrimSpace(value) == "null" {
			where = append(where, "wi.parent_id IS NULL")
		} else {
			id, err := parseID(value, "parent_id")
			if err != nil {
				return nil, nil, err
			}
			where = append(where, "wi.parent_id = ?")
			args = append(args, id)
		}
	} else if !serviceDesk {
		where = append(where, "wi.tier = 'target'")
	}

	return where, args, nil
}

func directWorkItemsWhere(query url.Values, currentUser string) ([]string, []any, error) {
	where := make([]string, 0, 10)
	args := make([]any, 0, 10)
	serviceDesk := projectWorkItemsServiceDeskQuery(query)

	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "projectId", "project_id")); value != "" {
		id, err := parseID(value, "project_id")
		if err != nil {
			return nil, nil, err
		}
		where = append(where, "wi.project_id = ?")
		args = append(args, id)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "projectCode", "project_code")); value != "" {
		where = append(where, "p.project_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("type")); value != "" {
		where = append(where, "wi.type = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("status")); value != "" {
		where = append(where, "wi.status = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "milestoneId", "milestone_id")); value != "" {
		id, err := parseID(value, "milestone_id")
		if err != nil {
			return nil, nil, err
		}
		where = append(where, "wi.milestone_id = ?")
		args = append(args, id)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "assigneeUid", "assignee_uid")); value != "" {
		where = append(where, "wi.assignee_uid = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "reporterUid", "reporter_uid")); value != "" {
		where = append(where, "wi.reporter_uid = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("priority")); value != "" {
		where = append(where, "wi.priority = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "keyword", "search", "q")); value != "" {
		where = append(where, "(wi.title LIKE ? OR wi.item_key LIKE ? OR wi.type LIKE ? OR wi.status LIKE ? OR wi.assignee_uid LIKE ? OR wi.reporter_uid LIKE ? OR wse.source_ticket_code LIKE ? OR wse.customer_code LIKE ? OR wse.environment_code LIKE ?)")
		keyword := "%" + value + "%"
		args = append(args, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword)
	}
	if serviceDesk {
		where = append(where, "wse.source_ticket_code IS NOT NULL")
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "customerCode", "customer_code")); value != "" {
		where = append(where, "wse.customer_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "environmentCode", "environment_code")); value != "" {
		where = append(where, "wse.environment_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "slaStatusSnapshot", "sla_status_snapshot", "slaStatus")); value != "" {
		where = append(where, "wse.sla_status_snapshot = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("tier")); value != "" {
		where = append(where, "wi.tier = ?")
		args = append(args, value)
	} else if value, ok := firstProjectWorkItemQueryValue(query, "parentId", "parent_id"); ok {
		if strings.TrimSpace(value) == "" || strings.TrimSpace(value) == "null" {
			where = append(where, "wi.parent_id IS NULL")
		} else {
			id, err := parseID(value, "parent_id")
			if err != nil {
				return nil, nil, err
			}
			where = append(where, "wi.parent_id = ?")
			args = append(args, id)
		}
	} else if !serviceDesk {
		where = append(where, "wi.tier = 'target'")
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, visibilityWhere)
	args = append(args, visibilityArgs...)

	return where, args, nil
}

func projectWorkItemsServiceDeskQuery(query url.Values) bool {
	for _, key := range []string{"serviceDesk", "service_desk", "sourceTicket", "source_ticket"} {
		value := strings.TrimSpace(strings.ToLower(query.Get(key)))
		if value == "1" || value == "true" || value == "yes" {
			return true
		}
	}
	return false
}

func firstProjectWorkItemQueryValue(query url.Values, keys ...string) (string, bool) {
	for _, key := range keys {
		values, ok := query[key]
		if !ok {
			continue
		}
		if len(values) == 0 {
			return "", true
		}
		return values[0], true
	}
	return "", false
}

func (a *Adapter) queryProjectWorkItemRows(
	ctx context.Context,
	whereSQL string,
	args []any,
	limit int,
	offset int,
	orderBy string,
) ([]projectWorkItemRow, error) {
	sqlText := `
		SELECT
			wi.id,
			wi.project_id,
			wi.milestone_id,
			wi.item_number,
			wi.item_key,
			wi.type,
			wi.tier,
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
			wi.required,
			wi.template_key,
			wi.routine_scope,
			wi.beneficiary_dept_code,
			wi.is_unplanned,
			wi.carryover_origin_item_key,
			wi.carryover_origin_milestone_id,
			wi.carryover_count,
			wi.carryover_governance_abnormal,
			wi.approval_status,
			DATE_FORMAT(wi.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			ml.name AS milestone_name,
			IFNULL(cc.child_count, 0) AS child_count,
			wse.source_ticket_code,
			wse.customer_code AS service_customer_code,
			wse.environment_code AS service_environment_code,
			DATE_FORMAT(wse.response_due_at, '%Y-%m-%d %H:%i:%s') AS response_due_at,
			DATE_FORMAT(wse.resolution_due_at, '%Y-%m-%d %H:%i:%s') AS resolution_due_at,
			wse.sla_status_snapshot,
			DATE_FORMAT(wse.first_responded_at, '%Y-%m-%d %H:%i:%s') AS first_responded_at,
			DATE_FORMAT(wse.resolved_at, '%Y-%m-%d %H:%i:%s') AS resolved_at,
			DATE_FORMAT(wse.last_synced_at, '%Y-%m-%d %H:%i:%s') AS service_ext_last_synced_at
		FROM work_items wi
		LEFT JOIN milestones ml ON ml.id = wi.milestone_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		LEFT JOIN (
			SELECT parent_id, COUNT(*) AS child_count
			FROM work_items
			WHERE parent_id IS NOT NULL
			GROUP BY parent_id
		) cc ON cc.parent_id = wi.id
		` + whereSQL + `
		ORDER BY ` + orderBy
	queryArgs := append([]any{}, args...)
	if limit > 0 {
		sqlText += " LIMIT ? OFFSET ?"
		queryArgs = append(queryArgs, limit, offset)
	}

	rows, err := a.DB().QueryContext(ctx, sqlText, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("query project work items: %w", err)
	}
	defer rows.Close()

	items := make([]projectWorkItemRow, 0)
	for rows.Next() {
		item, err := scanProjectWorkItemRow(rows)
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

func (a *Adapter) queryDirectWorkItemRows(
	ctx context.Context,
	whereSQL string,
	args []any,
	limit int,
	offset int,
	orderBy string,
) ([]projectWorkItemRow, error) {
	sqlText := `
		SELECT
			wi.id,
			wi.project_id,
			wi.milestone_id,
			wi.item_number,
			wi.item_key,
			wi.type,
			wi.tier,
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
			wi.required,
			wi.template_key,
			wi.routine_scope,
			wi.beneficiary_dept_code,
			wi.is_unplanned,
			wi.carryover_origin_item_key,
			wi.carryover_origin_milestone_id,
			wi.carryover_count,
			wi.carryover_governance_abnormal,
			wi.approval_status,
			DATE_FORMAT(wi.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			ml.name AS milestone_name,
			IFNULL(cc.child_count, 0) AS child_count,
			wse.source_ticket_code,
			wse.customer_code AS service_customer_code,
			wse.environment_code AS service_environment_code,
			DATE_FORMAT(wse.response_due_at, '%Y-%m-%d %H:%i:%s') AS response_due_at,
			DATE_FORMAT(wse.resolution_due_at, '%Y-%m-%d %H:%i:%s') AS resolution_due_at,
			wse.sla_status_snapshot,
			DATE_FORMAT(wse.first_responded_at, '%Y-%m-%d %H:%i:%s') AS first_responded_at,
			DATE_FORMAT(wse.resolved_at, '%Y-%m-%d %H:%i:%s') AS resolved_at,
			DATE_FORMAT(wse.last_synced_at, '%Y-%m-%d %H:%i:%s') AS service_ext_last_synced_at
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN milestones ml ON ml.id = wi.milestone_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		LEFT JOIN (
			SELECT parent_id, COUNT(*) AS child_count
			FROM work_items
			WHERE parent_id IS NOT NULL
			GROUP BY parent_id
		) cc ON cc.parent_id = wi.id
		` + whereSQL + `
		ORDER BY ` + orderBy
	queryArgs := append([]any{}, args...)
	if limit > 0 {
		sqlText += " LIMIT ? OFFSET ?"
		queryArgs = append(queryArgs, limit, offset)
	}

	rows, err := a.DB().QueryContext(ctx, sqlText, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("query direct work items: %w", err)
	}
	defer rows.Close()

	items := make([]projectWorkItemRow, 0)
	for rows.Next() {
		item, err := scanProjectWorkItemRow(rows)
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

func scanProjectWorkItemRow(rows *sql.Rows) (projectWorkItemRow, error) {
	var item projectWorkItemRow
	var description, startDate, severity, assigneeUID, reporterUID, dueDate, templateKey, milestoneName sql.NullString
	var routineScope, beneficiaryDeptCode, carryoverOriginItemKey sql.NullString
	var sourceTicketCode, customerCode, environmentCode, responseDueAt, resolutionDueAt, slaStatusSnapshot sql.NullString
	var firstRespondedAt, resolvedAt, serviceExtLastSyncedAt sql.NullString
	var estimatedHours sql.NullFloat64
	var milestoneID, parentID, carryoverOriginMilestoneID sql.NullInt64
	var required, isUnplanned, carryoverGovernanceAbnormal sql.NullInt64
	if err := rows.Scan(
		&item.ID,
		&item.ProjectID,
		&milestoneID,
		&item.ItemNumber,
		&item.ItemKey,
		&item.Type,
		&item.Tier,
		&item.Title,
		&description,
		&startDate,
		&item.Status,
		&item.Priority,
		&severity,
		&item.Weight,
		&assigneeUID,
		&reporterUID,
		&dueDate,
		&estimatedHours,
		&parentID,
		&item.SortOrder,
		&required,
		&templateKey,
		&routineScope,
		&beneficiaryDeptCode,
		&isUnplanned,
		&carryoverOriginItemKey,
		&carryoverOriginMilestoneID,
		&item.CarryoverCount,
		&carryoverGovernanceAbnormal,
		&item.ApprovalStatus,
		&item.CreatedAt,
		&item.UpdatedAt,
		&milestoneName,
		&item.ChildCount,
		&sourceTicketCode,
		&customerCode,
		&environmentCode,
		&responseDueAt,
		&resolutionDueAt,
		&slaStatusSnapshot,
		&firstRespondedAt,
		&resolvedAt,
		&serviceExtLastSyncedAt,
	); err != nil {
		return item, fmt.Errorf("scan project work item: %w", err)
	}
	item.Description = nullableString(description)
	item.MilestoneID = nullableInt64(milestoneID)
	item.StartDate = nullableString(startDate)
	item.Severity = nullableString(severity)
	item.AssigneeUID = nullableString(assigneeUID)
	item.ReporterUID = nullableString(reporterUID)
	item.DueDate = nullableString(dueDate)
	item.EstimatedHours = nullableFloat64(estimatedHours)
	item.ParentID = nullableInt64(parentID)
	item.Required = required.Valid && required.Int64 != 0
	item.TemplateKey = nullableString(templateKey)
	item.RoutineScope = nullableString(routineScope)
	item.BeneficiaryDeptCode = nullableString(beneficiaryDeptCode)
	item.IsUnplanned = isUnplanned.Valid && isUnplanned.Int64 != 0
	item.CarryoverOriginItemKey = nullableString(carryoverOriginItemKey)
	item.CarryoverOriginMilestoneID = nullableInt64(carryoverOriginMilestoneID)
	item.CarryoverGovernanceAbnormal = carryoverGovernanceAbnormal.Valid && carryoverGovernanceAbnormal.Int64 != 0
	item.MilestoneName = nullableString(milestoneName)
	item.SourceTicketCode = nullableString(sourceTicketCode)
	item.CustomerCode = nullableString(customerCode)
	item.EnvironmentCode = nullableString(environmentCode)
	item.ResponseDueAt = nullableString(responseDueAt)
	item.ResolutionDueAt = nullableString(resolutionDueAt)
	item.SLAStatusSnapshot = nullableString(slaStatusSnapshot)
	item.FirstRespondedAt = nullableString(firstRespondedAt)
	item.ResolvedAt = nullableString(resolvedAt)
	item.ServiceExtLastSyncedAt = nullableString(serviceExtLastSyncedAt)
	return item, nil
}

func (item projectWorkItemRow) mapProjectWorkItem() map[string]any {
	return map[string]any{
		"id":                          item.ID,
		"projectId":                   item.ProjectID,
		"milestoneId":                 item.MilestoneID,
		"itemNumber":                  item.ItemNumber,
		"itemKey":                     item.ItemKey,
		"type":                        item.Type,
		"tier":                        item.Tier,
		"title":                       item.Title,
		"description":                 item.Description,
		"startDate":                   item.StartDate,
		"status":                      item.Status,
		"priority":                    item.Priority,
		"severity":                    item.Severity,
		"weight":                      item.Weight,
		"assigneeUid":                 item.AssigneeUID,
		"reporterUid":                 item.ReporterUID,
		"dueDate":                     item.DueDate,
		"estimatedHours":              item.EstimatedHours,
		"parentId":                    item.ParentID,
		"sortOrder":                   item.SortOrder,
		"required":                    item.Required,
		"templateKey":                 item.TemplateKey,
		"routineScope":                item.RoutineScope,
		"beneficiaryDeptCode":         item.BeneficiaryDeptCode,
		"isUnplanned":                 item.IsUnplanned,
		"carryoverOriginItemKey":      item.CarryoverOriginItemKey,
		"carryoverOriginMilestoneId":  item.CarryoverOriginMilestoneID,
		"carryoverCount":              item.CarryoverCount,
		"carryoverGovernanceAbnormal": item.CarryoverGovernanceAbnormal,
		"approvalStatus":              item.ApprovalStatus,
		"createdAt":                   item.CreatedAt,
		"updatedAt":                   item.UpdatedAt,
		"milestoneName":               item.MilestoneName,
		"childCount":                  item.ChildCount,
		"sourceTicketCode":            item.SourceTicketCode,
		"customerCode":                item.CustomerCode,
		"environmentCode":             item.EnvironmentCode,
		"responseDueAt":               item.ResponseDueAt,
		"resolutionDueAt":             item.ResolutionDueAt,
		"slaStatusSnapshot":           item.SLAStatusSnapshot,
		"firstRespondedAt":            item.FirstRespondedAt,
		"resolvedAt":                  item.ResolvedAt,
		"serviceExtLastSyncedAt":      item.ServiceExtLastSyncedAt,
	}
}
