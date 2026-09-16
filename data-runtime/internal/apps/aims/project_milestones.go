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

type projectMilestone struct {
	ID             int64                       `json:"id"`
	ProjectID      int64                       `json:"projectId"`
	TemplateKey    *string                     `json:"templateKey"`
	Name           string                      `json:"name"`
	Description    *string                     `json:"description"`
	Mode           string                      `json:"mode"`
	PivrStage      *string                     `json:"pivrStage"`
	PaymentTermID  *int64                      `json:"paymentTermId"`
	StartDate      *string                     `json:"startDate"`
	EndDate        *string                     `json:"endDate"`
	Status         string                      `json:"status"`
	Deliverables   []milestoneDeliverableState `json:"deliverables"`
	RecurrenceRule *string                     `json:"recurrenceRule"`
	SortOrder      int64                       `json:"sortOrder"`
	CreatedBy      *string                     `json:"createdBy"`
	CreatedAt      string                      `json:"createdAt"`
	UpdatedAt      string                      `json:"updatedAt"`
	Progress       int64                       `json:"progress"`
}

type projectMilestoneDeliverableRow struct {
	ID              int64
	Name            string
	Required        int64
	Status          string
	DeliverableType string
	QualityStatus   string
}

type directProjectMilestoneRecord struct {
	ID        int64
	ProjectID int64
	Mode      string
	PivrStage *string
	EndDate   *string
}

func (a *Adapter) handleProjectMilestonesRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	projectID, ok := pathParam(path, "/v1/aims/projects/", "/milestones")
	if !ok {
		return nil, "", false, nil
	}

	switch method {
	case http.MethodGet:
		data, err := a.listProjectMilestones(ctx, projectID, query)
		return data, "aims.projects.milestones.list", true, err
	case http.MethodPost:
		data, err := a.createProjectMilestone(ctx, projectID, query, body)
		return data, "aims.projects.milestones.create", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) handleDirectMilestonesRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if method == http.MethodGet && path == "/v1/aims/milestones" {
		data, err := a.listDirectMilestones(ctx, query)
		return data, "aims.milestones.list", true, err
	}

	milestoneID, ok := directPathParam(path, "/v1/aims/milestones/")
	if !ok {
		return nil, "", false, nil
	}

	switch method {
	case http.MethodGet:
		data, err := a.getDirectMilestone(ctx, milestoneID, query)
		return data, "aims.milestones.get", true, err
	case http.MethodPut, http.MethodPatch:
		data, err := a.updateDirectMilestone(ctx, milestoneID, query, body)
		return data, "aims.milestones.update", true, err
	case http.MethodDelete:
		data, err := a.deleteDirectMilestone(ctx, milestoneID, query)
		return data, "aims.milestones.delete", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) listProjectMilestones(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			m.id,
			m.project_id,
			m.template_key,
			m.name,
			m.description,
			m.mode,
			m.pivr_stage,
			m.payment_term_id,
			DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
			m.status,
			m.recurrence_rule,
			m.sort_order,
			m.created_by,
			DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(m.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			IFNULL(wp.total_weight, 0) AS total_weight,
			IFNULL(wp.completed_weight, 0) AS completed_weight
		FROM milestones m
		LEFT JOIN (
			SELECT milestone_id, project_id,
			       SUM(weight) AS total_weight,
			       SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END) AS completed_weight
			FROM work_items
			WHERE project_id = ?
			GROUP BY milestone_id, project_id
		) wp ON wp.project_id = m.project_id AND wp.milestone_id = m.id
		WHERE m.project_id = ?
		ORDER BY m.sort_order ASC, m.start_date ASC
	`, projectID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]projectMilestone, 0)
	milestoneIDs := make([]int64, 0)
	for rows.Next() {
		var item projectMilestone
		var templateKey, description, pivrStage, startDate, endDate, recurrenceRule, createdBy sql.NullString
		var paymentTermID sql.NullInt64
		var createdAt, updatedAt sql.NullString
		var totalWeight, completedWeight float64
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&templateKey,
			&item.Name,
			&description,
			&item.Mode,
			&pivrStage,
			&paymentTermID,
			&startDate,
			&endDate,
			&item.Status,
			&recurrenceRule,
			&item.SortOrder,
			&createdBy,
			&createdAt,
			&updatedAt,
			&totalWeight,
			&completedWeight,
		); err != nil {
			return nil, err
		}
		item.TemplateKey = nullableString(templateKey)
		item.Description = nullableString(description)
		item.PivrStage = nullableString(pivrStage)
		item.PaymentTermID = nullableInt64(paymentTermID)
		item.StartDate = nullableString(startDate)
		item.EndDate = nullableString(endDate)
		item.RecurrenceRule = nullableString(recurrenceRule)
		item.CreatedBy = nullableString(createdBy)
		item.CreatedAt = nullStringOr(createdAt, "")
		item.UpdatedAt = nullStringOr(updatedAt, "")
		if totalWeight > 0 {
			item.Progress = int64((completedWeight/totalWeight)*100 + 0.5)
		}
		milestoneIDs = append(milestoneIDs, item.ID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	deliverables, err := a.projectMilestoneDeliverablesMap(ctx, projectID, milestoneIDs)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Deliverables = deliverables[items[index].ID]
	}

	return map[string]any{"milestones": items}, nil
}

func (a *Adapter) listDirectMilestones(ctx context.Context, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	where, args, err := directMilestonesWhere(query, currentUser)
	if err != nil {
		return nil, err
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	page := projectWorkItemsPage(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		`+whereSQL,
		args...,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("count direct milestones: %w", err)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			m.id,
			m.project_id,
			m.template_key,
			m.name,
			m.description,
			m.mode,
			m.pivr_stage,
			m.payment_term_id,
			DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
			m.status,
			m.recurrence_rule,
			m.sort_order,
			m.created_by,
			DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(m.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			IFNULL(wp.total_weight, 0) AS total_weight,
			IFNULL(wp.completed_weight, 0) AS completed_weight
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		LEFT JOIN (
			SELECT milestone_id, project_id,
			       SUM(weight) AS total_weight,
			       SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END) AS completed_weight
			FROM work_items
			GROUP BY milestone_id, project_id
		) wp ON wp.project_id = m.project_id AND wp.milestone_id = m.id
		`+whereSQL+`
		ORDER BY m.updated_at DESC, m.id DESC
		LIMIT ? OFFSET ?
	`, append(append([]any{}, args...), page.pageSize, page.offset)...)
	if err != nil {
		return nil, fmt.Errorf("query direct milestones: %w", err)
	}
	defer rows.Close()

	items := make([]projectMilestone, 0)
	for rows.Next() {
		item, err := scanProjectMilestoneListRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func directMilestonesWhere(query url.Values, currentUser string) ([]string, []any, error) {
	where := make([]string, 0, 8)
	args := make([]any, 0, 8)

	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "projectId", "project_id")); value != "" {
		id, err := parseID(value, "project_id")
		if err != nil {
			return nil, nil, err
		}
		where = append(where, "m.project_id = ?")
		args = append(args, id)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "projectCode", "project_code")); value != "" {
		where = append(where, "p.project_code = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("status")); value != "" {
		where = append(where, "m.status = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(query.Get("mode")); value != "" {
		where = append(where, "m.mode = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "pivrStage", "pivr_stage")); value != "" {
		where = append(where, "m.pivr_stage = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "templateKey", "template_key")); value != "" {
		where = append(where, "m.template_key = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(firstNonEmptyProjectParam(query, "keyword", "search", "q")); value != "" {
		where = append(where, "(m.name LIKE ? OR m.status LIKE ? OR m.pivr_stage LIKE ? OR m.template_key LIKE ?)")
		keyword := "%" + value + "%"
		args = append(args, keyword, keyword, keyword, keyword)
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, visibilityWhere)
	args = append(args, visibilityArgs...)
	return where, args, nil
}

func (a *Adapter) getDirectMilestone(ctx context.Context, rawMilestoneID string, query url.Values) (projectMilestone, error) {
	milestoneID, err := parseID(rawMilestoneID, "milestone_id")
	if err != nil {
		return projectMilestone{}, err
	}

	item, err := a.directMilestone(ctx, milestoneID)
	if err != nil {
		return projectMilestone{}, err
	}
	if err := a.requireProjectReadAccess(ctx, strconv.FormatInt(item.ProjectID, 10), query); err != nil {
		return projectMilestone{}, err
	}

	deliverables, err := a.projectMilestoneDeliverablesMap(ctx, item.ProjectID, []int64{item.ID})
	if err != nil {
		return projectMilestone{}, err
	}
	item.Deliverables = deliverables[item.ID]
	return item, nil
}

func (a *Adapter) createProjectMilestone(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+rawProjectID, query, body, rawProjectID); err != nil {
		return nil, err
	}

	uid := currentUserFrom(query, body)
	name := firstBodyText(body, "name")
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_name", "里程碑名称不能为空")
	}

	mode := firstBodyText(body, "mode")
	if mode == "" {
		mode = "rolling_plan"
	}
	endDate := firstBodyText(body, "endDate", "end_date")
	if mode == "strong_constraint" && endDate == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_deadline", "强约束模式必须设置截止日期")
	}

	pivrStage := firstBodyText(body, "pivrStage", "pivr_stage")
	paymentTermID, err := projectMilestoneBodyID(body, "paymentTermId", "payment_term_id")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTermId must be a positive integer")
	}
	if paymentTermID > 0 {
		var contractID sql.NullInt64
		if err := a.DB().QueryRowContext(ctx, `
			SELECT contract_id
			FROM aims_projects
			WHERE id = ?
		`, projectID).Scan(&contractID); err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if !contractID.Valid {
			return nil, httperror.New(http.StatusBadRequest, "project_contract_required", "项目未关联合同，不能绑定回款条款")
		}
		if pivrStage != "V" {
			return nil, httperror.New(http.StatusBadRequest, "payment_term_stage_required", "回款条款只能绑定到验证交付(V)阶段的里程碑")
		}
	}

	var paymentTermValue any
	if paymentTermID > 0 {
		paymentTermValue = paymentTermID
	}
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO milestones
			(project_id, name, description, mode, pivr_stage, payment_term_id, start_date, end_date, recurrence_rule, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		projectID,
		name,
		nullableText(firstBodyText(body, "description")),
		mode,
		nullableText(pivrStage),
		paymentTermValue,
		nullableText(firstBodyText(body, "startDate", "start_date")),
		nullableText(endDate),
		nullableText(firstBodyText(body, "recurrenceRule", "recurrence_rule")),
		uid,
	)
	if err != nil {
		return nil, err
	}
	milestoneID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	if deliverables, ok := firstBodyValue(body, "deliverables"); ok {
		if err := a.syncProjectMilestoneDeliverables(ctx, projectID, milestoneID, uid, deliverables); err != nil {
			return nil, err
		}
	}

	return map[string]any{"id": milestoneID}, nil
}

func (a *Adapter) updateDirectMilestone(ctx context.Context, rawMilestoneID string, query url.Values, body map[string]any) (any, error) {
	milestoneID, err := parseID(rawMilestoneID, "milestone_id")
	if err != nil {
		return nil, err
	}

	record, err := a.directMilestoneRecord(ctx, milestoneID)
	if err != nil {
		return nil, err
	}
	if err := a.requireMilestoneCompletionUnlocked(ctx, milestoneID); err != nil {
		return nil, err
	}
	uid := currentUserFrom(query, body)
	if err := a.requireProjectManagerOrScopedAdmin(ctx, record.ProjectID, uid, query); err != nil {
		return nil, err
	}

	fields := make([]string, 0)
	params := make([]any, 0)

	if value, ok := firstBodyValue(body, "name"); ok {
		fields = append(fields, "name = ?")
		params = append(params, strings.TrimSpace(projectMilestoneBodyText(value)))
	}
	if value, ok := firstBodyValue(body, "description"); ok {
		fields = append(fields, "description = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "startDate", "start_date"); ok {
		fields = append(fields, "start_date = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "endDate", "end_date"); ok {
		fields = append(fields, "end_date = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "mode"); ok {
		fields = append(fields, "mode = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "pivrStage", "pivr_stage"); ok {
		fields = append(fields, "pivr_stage = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	paymentTermValue, paymentTermProvided := firstBodyValue(body, "paymentTermId", "payment_term_id")
	if paymentTermProvided {
		fields = append(fields, "payment_term_id = ?")
		params = append(params, projectMilestoneNullablePositiveID(paymentTermValue))
	}
	if value, ok := firstBodyValue(body, "status"); ok {
		fields = append(fields, "status = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "recurrenceRule", "recurrence_rule"); ok {
		fields = append(fields, "recurrence_rule = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}
	if value, ok := firstBodyValue(body, "sortOrder", "sort_order"); ok {
		fields = append(fields, "sort_order = ?")
		params = append(params, projectMilestoneSQLValue(value))
	}

	deliverables, deliverablesProvided := firstBodyValue(body, "deliverables")
	if len(fields) == 0 && !deliverablesProvided {
		return nil, httperror.New(http.StatusBadRequest, "no_milestone_update_fields", "没有需要更新的字段")
	}

	finalMode := record.Mode
	if value, ok := firstBodyValue(body, "mode"); ok {
		finalMode = projectMilestoneBodyText(value)
	}
	finalEndDate := ""
	if record.EndDate != nil {
		finalEndDate = strings.TrimSpace(*record.EndDate)
	}
	if value, ok := firstBodyValue(body, "endDate", "end_date"); ok {
		finalEndDate = projectMilestoneBodyText(value)
	}
	if finalMode == "strong_constraint" && strings.TrimSpace(finalEndDate) == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_deadline", "强约束模式必须设置截止日期")
	}

	if paymentTermProvided && projectMilestoneBodyText(paymentTermValue) != "" {
		paymentTermID, err := projectMilestonePositiveIDValue(paymentTermValue)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTermId must be a positive integer")
		}
		if paymentTermID > 0 {
			if err := a.requireProjectContractForMilestone(ctx, record.ProjectID); err != nil {
				return nil, err
			}
			finalPivrStage := ""
			if record.PivrStage != nil {
				finalPivrStage = strings.TrimSpace(*record.PivrStage)
			}
			if value, ok := firstBodyValue(body, "pivrStage", "pivr_stage"); ok {
				finalPivrStage = projectMilestoneBodyText(value)
			}
			if finalPivrStage != "V" {
				return nil, httperror.New(http.StatusBadRequest, "payment_term_stage_required", "回款条款只能绑定到验证交付(V)阶段的里程碑")
			}
		}
	}

	if len(fields) > 0 {
		params = append(params, milestoneID)
		if _, err := a.DB().ExecContext(ctx, `
			UPDATE milestones
			SET `+strings.Join(fields, ", ")+`
			WHERE id = ?
		`, params...); err != nil {
			return nil, err
		}
	}

	if deliverablesProvided {
		if err := a.syncProjectMilestoneDeliverables(ctx, record.ProjectID, milestoneID, uid, deliverables); err != nil {
			return nil, err
		}
	}

	return nil, nil
}

func (a *Adapter) deleteDirectMilestone(ctx context.Context, rawMilestoneID string, query url.Values) (any, error) {
	milestoneID, err := parseID(rawMilestoneID, "milestone_id")
	if err != nil {
		return nil, err
	}

	record, err := a.directMilestoneRecord(ctx, milestoneID)
	if err != nil {
		return nil, err
	}
	if err := a.requireMilestoneCompletionUnlocked(ctx, milestoneID); err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, record.ProjectID, strings.TrimSpace(query.Get("current_user")), query); err != nil {
		return nil, err
	}

	var workItemCount int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM work_items
		WHERE milestone_id = ?
	`, milestoneID).Scan(&workItemCount); err != nil {
		return nil, err
	}
	if workItemCount > 0 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"milestone_has_work_items",
			fmt.Sprintf("该里程碑下有 %d 个工作项，请先移动或删除后再删除里程碑", workItemCount),
		)
	}

	if _, err := a.DB().ExecContext(ctx, `
		DELETE FROM milestones
		WHERE id = ?
	`, milestoneID); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) directMilestone(ctx context.Context, milestoneID int64) (projectMilestone, error) {
	var item projectMilestone
	var templateKey, description, pivrStage, startDate, endDate, recurrenceRule, createdBy sql.NullString
	var paymentTermID sql.NullInt64
	var createdAt, updatedAt sql.NullString
	var totalWeight, completedWeight float64
	err := a.DB().QueryRowContext(ctx, `
		SELECT
			m.id,
			m.project_id,
			m.template_key,
			m.name,
			m.description,
			m.mode,
			m.pivr_stage,
			m.payment_term_id,
			DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
			m.status,
			m.recurrence_rule,
			m.sort_order,
			m.created_by,
			DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(m.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			IFNULL(SUM(wi.weight), 0) AS total_weight,
			IFNULL(SUM(CASE WHEN wi.status = 'completed' THEN wi.weight ELSE 0 END), 0) AS completed_weight
		FROM milestones m
		LEFT JOIN work_items wi
		  ON wi.project_id = m.project_id
		 AND wi.milestone_id = m.id
		WHERE m.id = ?
		GROUP BY m.id
	`, milestoneID).Scan(
		&item.ID,
		&item.ProjectID,
		&templateKey,
		&item.Name,
		&description,
		&item.Mode,
		&pivrStage,
		&paymentTermID,
		&startDate,
		&endDate,
		&item.Status,
		&recurrenceRule,
		&item.SortOrder,
		&createdBy,
		&createdAt,
		&updatedAt,
		&totalWeight,
		&completedWeight,
	)
	if err == sql.ErrNoRows {
		return projectMilestone{}, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}
	if err != nil {
		return projectMilestone{}, err
	}

	item.TemplateKey = nullableString(templateKey)
	item.Description = nullableString(description)
	item.PivrStage = nullableString(pivrStage)
	item.PaymentTermID = nullableInt64(paymentTermID)
	item.StartDate = nullableString(startDate)
	item.EndDate = nullableString(endDate)
	item.RecurrenceRule = nullableString(recurrenceRule)
	item.CreatedBy = nullableString(createdBy)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	if totalWeight > 0 {
		item.Progress = int64((completedWeight/totalWeight)*100 + 0.5)
	}
	return item, nil
}

func scanProjectMilestoneListRow(rows *sql.Rows) (projectMilestone, error) {
	var item projectMilestone
	var templateKey, description, pivrStage, startDate, endDate, recurrenceRule, createdBy sql.NullString
	var paymentTermID sql.NullInt64
	var createdAt, updatedAt sql.NullString
	var totalWeight, completedWeight float64
	if err := rows.Scan(
		&item.ID,
		&item.ProjectID,
		&templateKey,
		&item.Name,
		&description,
		&item.Mode,
		&pivrStage,
		&paymentTermID,
		&startDate,
		&endDate,
		&item.Status,
		&recurrenceRule,
		&item.SortOrder,
		&createdBy,
		&createdAt,
		&updatedAt,
		&totalWeight,
		&completedWeight,
	); err != nil {
		return item, fmt.Errorf("scan project milestone: %w", err)
	}
	item.TemplateKey = nullableString(templateKey)
	item.Description = nullableString(description)
	item.PivrStage = nullableString(pivrStage)
	item.PaymentTermID = nullableInt64(paymentTermID)
	item.StartDate = nullableString(startDate)
	item.EndDate = nullableString(endDate)
	item.RecurrenceRule = nullableString(recurrenceRule)
	item.CreatedBy = nullableString(createdBy)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	if totalWeight > 0 {
		item.Progress = int64((completedWeight/totalWeight)*100 + 0.5)
	}
	return item, nil
}

func (a *Adapter) directMilestoneRecord(ctx context.Context, milestoneID int64) (directProjectMilestoneRecord, error) {
	var record directProjectMilestoneRecord
	var pivrStage, endDate sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT
			id,
			project_id,
			mode,
			pivr_stage,
			DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
		FROM milestones
		WHERE id = ?
	`, milestoneID).Scan(
		&record.ID,
		&record.ProjectID,
		&record.Mode,
		&pivrStage,
		&endDate,
	)
	if err == sql.ErrNoRows {
		return directProjectMilestoneRecord{}, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}
	if err != nil {
		return directProjectMilestoneRecord{}, err
	}
	record.PivrStage = nullableString(pivrStage)
	record.EndDate = nullableString(endDate)
	return record, nil
}

func (a *Adapter) requireProjectContractForMilestone(ctx context.Context, projectID int64) error {
	var contractID sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT contract_id
		FROM aims_projects
		WHERE id = ?
	`, projectID).Scan(&contractID); err != nil && err != sql.ErrNoRows {
		return err
	}
	if !contractID.Valid {
		return httperror.New(http.StatusBadRequest, "project_contract_required", "项目未关联合同，不能绑定回款条款")
	}
	return nil
}

func (a *Adapter) projectMilestoneDeliverablesMap(ctx context.Context, projectID int64, milestoneIDs []int64) (map[int64][]milestoneDeliverableState, error) {
	deliverables := make(map[int64][]milestoneDeliverableState)
	if len(milestoneIDs) == 0 {
		return deliverables, nil
	}

	placeholders := milestonePlaceholders(len(milestoneIDs))
	args := make([]any, 0, 1+len(milestoneIDs)*2)
	args = append(args, projectID)
	for _, id := range milestoneIDs {
		args = append(args, id)
	}
	for _, id := range milestoneIDs {
		args = append(args, id)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			COALESCE(d.milestone_owner_id, wi.milestone_id) AS milestone_owner_id,
			d.id,
			d.name,
			d.`+"`required`"+`,
			d.status,
			d.deliverable_type,
			d.quality_status
		FROM deliverables d
		LEFT JOIN work_items wi ON wi.id = COALESCE(d.matter_id, d.target_id)
		WHERE d.project_id = ?
		  AND (
		    d.milestone_owner_id IN (`+placeholders+`)
		    OR wi.milestone_id IN (`+placeholders+`)
		  )
		ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query project milestone deliverables: %w", err)
	}
	defer rows.Close()

	seenByMilestone := make(map[int64]map[string]int)
	for rows.Next() {
		var milestoneID int64
		var id int64
		var name, deliverableType, qualityStatus string
		var required int64
		var status string
		if err := rows.Scan(&milestoneID, &id, &name, &required, &status, &deliverableType, &qualityStatus); err != nil {
			return nil, err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		seen := seenByMilestone[milestoneID]
		if seen == nil {
			seen = make(map[string]int)
			seenByMilestone[milestoneID] = seen
		}
		list := deliverables[milestoneID]
		if index, ok := seen[name]; ok {
			mergeMilestoneDeliverableState(&list[index], milestoneDeliverableState{
				ID: id, Name: name, Required: required != 0, Completed: status == "approved",
				Status: status, DeliverableType: deliverableType, QualityStatus: qualityStatus,
			})
			deliverables[milestoneID] = list
			continue
		}
		seen[name] = len(list)
		deliverables[milestoneID] = append(list, milestoneDeliverableState{
			ID: id, Name: name, Required: required != 0, Completed: status == "approved",
			Status: status, DeliverableType: deliverableType, QualityStatus: qualityStatus,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	reqArgs := make([]any, 0, 1+len(milestoneIDs))
	reqArgs = append(reqArgs, projectID)
	for _, id := range milestoneIDs {
		reqArgs = append(reqArgs, id)
	}
	reqRows, err := a.DB().QueryContext(ctx, `
		SELECT milestone_id, title, status, `+"`required`"+`
		FROM work_items
		WHERE project_id = ?
		  AND tier = 'target'
		  AND type = 'requirement'
		  AND milestone_id IN (`+placeholders+`)
		ORDER BY sort_order ASC, created_at ASC
	`, reqArgs...)
	if err != nil {
		return nil, fmt.Errorf("query project milestone requirement deliverables: %w", err)
	}
	defer reqRows.Close()
	for reqRows.Next() {
		var milestoneID int64
		var title string
		var status string
		var required int64
		if err := reqRows.Scan(&milestoneID, &title, &status, &required); err != nil {
			return nil, err
		}
		title = strings.TrimSpace(title)
		if title == "" {
			continue
		}
		seen := seenByMilestone[milestoneID]
		if seen == nil {
			seen = make(map[string]int)
			seenByMilestone[milestoneID] = seen
		}
		if _, ok := seen[title]; ok {
			continue
		}
		seen[title] = len(deliverables[milestoneID])
		deliverables[milestoneID] = append(deliverables[milestoneID], milestoneDeliverableState{
			Name:      title,
			Required:  required != 0,
			Completed: status == "completed",
		})
	}
	if err := reqRows.Err(); err != nil {
		return nil, err
	}

	return deliverables, nil
}

func (a *Adapter) syncProjectMilestoneDeliverables(ctx context.Context, projectID int64, milestoneID int64, createdBy string, rawItems any) error {
	normalized := normalizeProjectMilestoneDeliverables(rawItems)

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, name, `+"`required`"+`, status
		FROM deliverables
		WHERE project_id = ?
		  AND milestone_owner_id = ?
	`, projectID, milestoneID)
	if err != nil {
		return err
	}
	defer rows.Close()

	existingByName := make(map[string]projectMilestoneDeliverableRow)
	for rows.Next() {
		var row projectMilestoneDeliverableRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Required, &row.Status); err != nil {
			return err
		}
		existingByName[row.Name] = row
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if len(normalized) == 0 {
		_, err := a.DB().ExecContext(ctx, `
			DELETE FROM deliverables
			WHERE project_id = ?
			  AND milestone_owner_id = ?
		`, projectID, milestoneID)
		return err
	}

	var projectCode sql.NullString
	if err := a.DB().QueryRowContext(ctx, `
		SELECT project_code
		FROM aims_projects
		WHERE id = ?
	`, projectID).Scan(&projectCode); err != nil && err != sql.ErrNoRows {
		return err
	}
	var projectCodeValue any
	if projectCode.Valid {
		projectCodeValue = projectCode.String
	}

	names := make([]string, 0, len(normalized))
	for _, item := range normalized {
		names = append(names, item.Name)
	}
	deleteArgs := make([]any, 0, 2+len(names))
	deleteArgs = append(deleteArgs, projectID, milestoneID)
	for _, name := range names {
		deleteArgs = append(deleteArgs, name)
	}
	if _, err := a.DB().ExecContext(ctx, `
		DELETE FROM deliverables
		WHERE project_id = ?
		  AND milestone_owner_id = ?
		  AND name NOT IN (`+milestonePlaceholders(len(names))+`)
	`, deleteArgs...); err != nil {
		return err
	}

	for index, item := range normalized {
		status := "pending"
		if item.Completed {
			status = "approved"
		}
		if existing, ok := existingByName[item.Name]; ok {
			if item.Completed {
				if err := a.requireDeliverableQualityBeforeApproval(ctx, existing.ID); err != nil {
					return err
				}
			}
			if _, err := a.DB().ExecContext(ctx, `
				UPDATE deliverables
				SET `+"`required`"+` = ?, sort_order = ?, status = ?
				WHERE id = ?
			`, boolInt(item.Required), index, status, existing.ID); err != nil {
				return err
			}
			continue
		}
		if item.Completed && item.Required {
			return httperror.New(http.StatusConflict, "deliverable_quality_gate_required", "new required document deliverable cannot be created as approved before quality review")
		}

		if _, err := a.DB().ExecContext(ctx, `
			INSERT INTO deliverables
				(project_owner_id, milestone_owner_id, target_id, matter_id,
				 name, description, acceptance_criteria, deliverable_type, `+"`required`"+`, sort_order,
				 status, project_id, project_code, created_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			nil,
			milestoneID,
			nil,
			nil,
			item.Name,
			nil,
			nil,
			"document",
			boolInt(item.Required),
			index,
			status,
			projectID,
			projectCodeValue,
			createdBy,
		); err != nil {
			return err
		}
	}

	return nil
}

func normalizeProjectMilestoneDeliverables(rawItems any) []milestoneDeliverableState {
	items, ok := rawItems.([]any)
	if !ok {
		return []milestoneDeliverableState{}
	}

	normalized := make([]milestoneDeliverableState, 0, len(items))
	seen := make(map[string]struct{})
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(fmt.Sprint(item["name"]))
		if name == "" || name == "<nil>" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}

		required := true
		if value, ok := item["required"].(bool); ok && !value {
			required = false
		}
		normalized = append(normalized, milestoneDeliverableState{
			Name:      name,
			Required:  required,
			Completed: jsTruthy(item["completed"]),
		})
	}
	return normalized
}

func projectMilestoneBodyID(body map[string]any, keys ...string) (int64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return 0, nil
		}
		id, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return 0, err
		}
		if id <= 0 {
			return 0, nil
		}
		return id, nil
	}
	return 0, nil
}

func projectMilestoneSQLValue(value any) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return nil
	}
	return value
}

func projectMilestoneBodyText(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func projectMilestonePositiveIDValue(value any) (int64, error) {
	text := projectMilestoneBodyText(value)
	if text == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(text, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid payment term id")
	}
	return id, nil
}

func projectMilestoneNullablePositiveID(value any) any {
	id, err := projectMilestonePositiveIDValue(value)
	if err != nil || id <= 0 {
		return nil
	}
	return id
}

func milestonePlaceholders(count int) string {
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func jsTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0
	case int:
		return typed != 0
	case int64:
		return typed != 0
	default:
		return true
	}
}
