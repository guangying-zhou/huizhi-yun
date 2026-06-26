package people

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) dashboardOverview(ctx context.Context) (map[string]any, error) {
	activeEmployees, err := a.count(ctx, "people_employees", "archived_at IS NULL AND employment_status = 'active'")
	if err != nil {
		return nil, err
	}
	currentAssignments, err := a.count(ctx, "people_assignments", "effective_to IS NULL")
	if err != nil {
		return nil, err
	}
	activeCycles, err := a.count(ctx, "people_performance_cycles", "status IN ('draft', 'collecting', 'calculating')")
	if err != nil {
		return nil, err
	}
	currentCost, err := a.currentMonthActualCost(ctx)
	if err != nil {
		return nil, err
	}

	cycles, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_performance_cycles
		WHERE status IN ('draft', 'collecting', 'calculating')
		ORDER BY period_end DESC, id DESC
		LIMIT 6
	`)
	if err != nil {
		return nil, err
	}
	assignments, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_assignments
		ORDER BY effective_from DESC, id DESC
		LIMIT 8
	`)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"metrics": []map[string]any{
			{"label": "在职员工", "value": activeEmployees, "hint": "people_employees", "color": "success"},
			{"label": "当前任职", "value": currentAssignments, "hint": "effective_to 为空", "color": "primary"},
			{"label": "进行中周期", "value": activeCycles, "hint": "draft / collecting / calculating", "color": "warning"},
			{"label": "本月实际成本", "value": currentCost, "hint": "people_cost_snapshots", "color": "secondary"},
		},
		"quick_links": []map[string]any{
			{"label": "员工台账", "description": "维护员工最小事实、岗位、职级和成本口径", "to": "/employees", "icon": "i-lucide-users"},
			{"label": "任职变更", "description": "承接入转调离和 Workflow 审批回写", "to": "/assignments", "icon": "i-lucide-arrow-left-right"},
			{"label": "职级设置", "description": "维护 M/P 职级工资和绩效工资范围", "to": "/settings/standard-costs", "icon": "i-lucide-calculator"},
			{"label": "成本快照", "description": "月度固化标准成本和实际成本", "to": "/cost-snapshots", "icon": "i-lucide-wallet-cards"},
		},
		"active_cycles":      cycles,
		"recent_assignments": assignments,
	}, nil
}

func (a *Adapter) count(ctx context.Context, table string, where string) (int64, error) {
	sqlText := "SELECT COUNT(*) FROM " + table
	if strings.TrimSpace(where) != "" {
		sqlText += " WHERE " + where
	}
	var count int64
	if err := a.DB().QueryRowContext(ctx, sqlText).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (a *Adapter) currentMonthActualCost(ctx context.Context) (float64, error) {
	var total float64
	err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE(SUM(actual_cost), 0)
		FROM people_cost_snapshots
		WHERE period_month = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')
	`).Scan(&total)
	return total, err
}

func (a *Adapter) employeeProfile(ctx context.Context, employeeUID string, query url.Values) (map[string]any, error) {
	employee, err := a.queryRowMap(ctx, `
		SELECT *
		FROM people_employees
		WHERE archived_at IS NULL
		  AND (employee_uid = ? OR employee_no = ? OR login_name = ?)
		LIMIT 1
	`, employeeUID, employeeUID, employeeUID)
	if err != nil {
		return nil, err
	}
	if employee == nil {
		return nil, httperror.New(http.StatusNotFound, "employee_not_found", "Employee not found")
	}
	if err := requireEmployeeRecordQueryAccess(query, employee); err != nil {
		return nil, err
	}

	uid := cleanAnyString(employee["employee_uid"])
	assignments, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_assignments
		WHERE employee_uid = ?
		ORDER BY effective_from DESC, id DESC
	`, uid)
	if err != nil {
		return nil, err
	}
	costSnapshots, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_cost_snapshots
		WHERE employee_uid = ?
		ORDER BY period_month DESC, id DESC
		LIMIT 12
	`, uid)
	if err != nil {
		return nil, err
	}
	contributions, err := a.queryMaps(ctx, `
		SELECT pcs.*, pe.display_name AS employee_name
		FROM people_contribution_snapshots pcs
		LEFT JOIN people_employees pe ON pe.employee_uid = pcs.employee_uid
		WHERE pcs.employee_uid = ?
		ORDER BY pcs.cycle_code DESC, pcs.updated_at DESC, pcs.id DESC
		LIMIT 80
	`, uid)
	if err != nil {
		return nil, err
	}
	cycles, err := a.queryMaps(ctx, `
		SELECT DISTINCT pc.*
		FROM people_performance_cycles pc
		INNER JOIN people_contribution_snapshots pcs ON pcs.cycle_code = pc.cycle_code
		WHERE pcs.employee_uid = ?
		ORDER BY pc.period_end DESC, pc.id DESC
		LIMIT 20
	`, uid)
	if err != nil {
		return nil, err
	}
	documents, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_documents
		WHERE employee_uid = ?
		ORDER BY id DESC
		LIMIT 30
	`, uid)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"employee":              employee,
		"assignments":           assignments,
		"cost_snapshots":        costSnapshots,
		"project_contributions": contributions,
		"performance_cycles":    cycles,
		"documents":             documents,
	}, nil
}

func (a *Adapter) performanceCycleList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := peopleListPage(query)
	where := make([]string, 0)
	args := make([]any, 0)

	if keyword := firstCleanEmployeeAccessValue(query.Get("keyword"), query.Get("search"), query.Get("q")); keyword != "" {
		where = append(where, "(cycle_code LIKE ? ESCAPE '\\\\' OR cycle_name LIKE ? ESCAPE '\\\\' OR project_code LIKE ? ESCAPE '\\\\')")
		like := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(keyword) + "%"
		args = append(args, like, like, like)
	}
	if status := firstCleanEmployeeAccessValue(query.Get("status")); status != "" && status != "all" {
		where = append(where, "status = ?")
		args = append(args, status)
	}
	if projectCode := firstCleanEmployeeAccessValue(query.Get("project_code"), query.Get("projectCode")); projectCode != "" {
		where = append(where, "project_code = ?")
		args = append(args, projectCode)
	}
	if cycleType := firstCleanEmployeeAccessValue(query.Get("cycle_type"), query.Get("cycleType")); cycleType != "" {
		where = append(where, "cycle_type = ?")
		args = append(args, cycleType)
	}
	if scopeType := firstCleanEmployeeAccessValue(query.Get("scope_type"), query.Get("scopeType")); scopeType != "" {
		where = append(where, "scope_type = ?")
		args = append(args, scopeType)
	}

	scopeWhere, scopeArgs, err := performanceCycleScopeWhere(query)
	if err != nil {
		return nil, err
	}
	if scopeWhere != "" {
		where = append(where, scopeWhere)
		args = append(args, scopeArgs...)
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM people_performance_cycles"+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	items, err := a.queryMaps(
		ctx,
		"SELECT * FROM people_performance_cycles"+whereSQL+" ORDER BY period_end DESC, id DESC LIMIT ? OFFSET ?",
		append(args, page.pageSize, page.offset)...,
	)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) performanceCycleRecord(ctx context.Context, cycleCode string, query url.Values) (map[string]any, error) {
	cycle, err := a.performanceCycleByCode(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	if cycle == nil {
		return nil, httperror.New(http.StatusNotFound, "performance_cycle_not_found", "Performance cycle not found")
	}
	if err := a.requirePerformanceCycleAccess(ctx, cycleCode, query); err != nil {
		return nil, err
	}
	return cycle, nil
}

func (a *Adapter) performanceCycleDetail(ctx context.Context, cycleCode string, query url.Values) (map[string]any, error) {
	cycle, err := a.performanceCycleRecord(ctx, cycleCode, query)
	if err != nil {
		return nil, err
	}

	contributionWhere := []string{"pcs.cycle_code = ?"}
	contributionArgs := []any{cycleCode}
	scopeClause, scopeArgs, err := employeeScopedRowClause(query, "pcs.employee_uid")
	if err != nil {
		return nil, err
	}
	if scopeClause != "" {
		contributionWhere = append(contributionWhere, scopeClause)
		contributionArgs = append(contributionArgs, scopeArgs...)
	}

	contributionWhereSQL := strings.Join(contributionWhere, " AND ")
	contributions, err := a.queryMaps(ctx, `
		SELECT pcs.*, pe.display_name AS employee_name
		FROM people_contribution_snapshots pcs
		LEFT JOIN people_employees pe ON pe.employee_uid = pcs.employee_uid
		WHERE `+contributionWhereSQL+`
		ORDER BY pcs.project_code ASC, pcs.employee_uid ASC, pcs.id ASC
	`, contributionArgs...)
	if err != nil {
		return nil, err
	}
	summary, err := a.queryRowMap(ctx, `
		SELECT
			COUNT(DISTINCT pcs.employee_uid) AS employee_count,
			COUNT(DISTINCT pcs.project_code) AS project_count,
			COALESCE(SUM(pcs.work_hours), 0) AS work_hours,
			ROUND(COALESCE(AVG(pcs.contribution_score), 0), 1) AS avg_score
		FROM people_contribution_snapshots pcs
		WHERE `+contributionWhereSQL+`
	`, contributionArgs...)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		summary = map[string]any{}
	}

	return map[string]any{
		"cycle":                  cycle,
		"summary":                summary,
		"contribution_snapshots": contributions,
	}, nil
}

func (a *Adapter) performanceCycleByCode(ctx context.Context, cycleCode string) (map[string]any, error) {
	cycle, err := a.queryRowMap(ctx, `
		SELECT *
		FROM people_performance_cycles
		WHERE cycle_code = ?
		LIMIT 1
	`, cycleCode)
	if err != nil {
		return nil, err
	}
	if cycle == nil {
		return nil, httperror.New(http.StatusNotFound, "performance_cycle_not_found", "Performance cycle not found")
	}
	return cycle, nil
}

func (a *Adapter) requirePerformanceCycleAccess(ctx context.Context, cycleCode string, query url.Values) error {
	scopeWhere, scopeArgs, err := performanceCycleScopeWhere(query)
	if err != nil {
		return err
	}
	if scopeWhere == "" {
		return nil
	}
	var marker int
	err = a.DB().QueryRowContext(ctx, "SELECT 1 FROM people_performance_cycles WHERE cycle_code = ? AND "+scopeWhere+" LIMIT 1", append([]any{cycleCode}, scopeArgs...)...).Scan(&marker)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	return performanceCycleForbiddenIfScoped(query)
}

func (a *Adapter) employeeCostSnapshot(ctx context.Context, employeeUID string, query url.Values) (map[string]any, error) {
	periodMonth := strings.TrimSpace(query.Get("period_month"))
	sqlText := `
		SELECT *
		FROM people_cost_snapshots
		WHERE employee_uid = ?
	`
	args := []any{employeeUID}
	if periodMonth != "" {
		sqlText += " AND period_month = ?"
		args = append(args, periodMonth)
	}
	sqlText += " ORDER BY period_month DESC, id DESC LIMIT 1"

	snapshot, err := a.queryRowMap(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, httperror.New(http.StatusNotFound, "cost_snapshot_not_found", "Cost snapshot not found")
	}
	employee, err := a.queryRowMap(ctx, `
		SELECT employee_uid, employee_no, display_name, dept_code, dept_name, position_code, position_name, rank_code
		FROM people_employees
		WHERE employee_uid = ?
		LIMIT 1
	`, employeeUID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"employee": employee,
		"snapshot": snapshot,
	}, nil
}

func (a *Adapter) projectPeopleCosts(ctx context.Context, projectCode string, query url.Values) (map[string]any, error) {
	periodMonth := strings.TrimSpace(query.Get("period_month"))
	joinPeriod := ""
	args := []any{}
	if periodMonth != "" {
		joinPeriod = " AND cs.period_month = ?"
		args = append(args, periodMonth)
	}
	args = append(args, projectCode)

	items, err := a.queryMaps(ctx, `
		SELECT
			pcs.cycle_code,
			pcs.employee_uid,
			pe.display_name AS employee_name,
			pe.dept_code,
			pe.dept_name,
			pe.position_code,
			pe.position_name,
			pe.rank_code,
			pc.period_start,
			pc.period_end,
			cs.period_month,
			cs.cost_source,
			COALESCE(cs.cost_basis, 'standard') AS cost_basis,
			cs.standard_rate_code,
			COALESCE(cs.standard_cost, 0) AS standard_cost,
			COALESCE(cs.actual_cost, 0) AS actual_cost,
			CASE
				WHEN COALESCE(cs.cost_basis, 'standard') = 'actual' AND COALESCE(cs.actual_cost, 0) > 0 THEN COALESCE(cs.actual_cost, 0)
				WHEN COALESCE(cs.standard_cost, 0) > 0 THEN COALESCE(cs.standard_cost, 0)
				ELSE COALESCE(cs.actual_cost, 0)
			END AS effective_cost,
			COALESCE(SUM(pcs.work_hours), 0) AS work_hours,
			COALESCE(total.total_work_hours, 0) AS total_work_hours,
			CASE
				WHEN COALESCE(total.total_work_hours, 0) > 0
				THEN ROUND(COALESCE(SUM(pcs.work_hours), 0) / total.total_work_hours, 4)
				ELSE 0
			END AS allocation_ratio,
			ROUND(
				COALESCE(cs.actual_cost, 0) *
				CASE
					WHEN COALESCE(total.total_work_hours, 0) > 0
					THEN COALESCE(SUM(pcs.work_hours), 0) / total.total_work_hours
					ELSE 0
				END,
				2
			) AS allocated_actual_cost,
			ROUND(
				COALESCE(cs.standard_cost, 0) *
				CASE
					WHEN COALESCE(total.total_work_hours, 0) > 0
					THEN COALESCE(SUM(pcs.work_hours), 0) / total.total_work_hours
					ELSE 0
				END,
				2
			) AS allocated_standard_cost,
			ROUND(
				CASE
					WHEN COALESCE(cs.cost_basis, 'standard') = 'actual' AND COALESCE(cs.actual_cost, 0) > 0 THEN COALESCE(cs.actual_cost, 0)
					WHEN COALESCE(cs.standard_cost, 0) > 0 THEN COALESCE(cs.standard_cost, 0)
					ELSE COALESCE(cs.actual_cost, 0)
				END *
				CASE
					WHEN COALESCE(total.total_work_hours, 0) > 0
					THEN COALESCE(SUM(pcs.work_hours), 0) / total.total_work_hours
					ELSE 0
				END,
				2
			) AS allocated_cost,
			ROUND(COALESCE(AVG(pcs.contribution_score), 0), 1) AS contribution_score
		FROM people_contribution_snapshots pcs
		INNER JOIN people_performance_cycles pc ON pc.cycle_code = pcs.cycle_code
		LEFT JOIN people_employees pe ON pe.employee_uid = pcs.employee_uid
		LEFT JOIN (
			SELECT cycle_code, employee_uid, SUM(work_hours) AS total_work_hours
			FROM people_contribution_snapshots
			GROUP BY cycle_code, employee_uid
		) total ON total.cycle_code = pcs.cycle_code AND total.employee_uid = pcs.employee_uid
		LEFT JOIN people_cost_snapshots cs ON cs.employee_uid = pcs.employee_uid
			AND cs.period_month BETWEEN DATE_FORMAT(pc.period_start, '%Y-%m') AND DATE_FORMAT(pc.period_end, '%Y-%m')`+joinPeriod+`
		WHERE pcs.project_code = ?
		GROUP BY
			pcs.cycle_code,
			pcs.employee_uid,
			pe.display_name,
			pe.dept_code,
			pe.dept_name,
			pe.position_code,
			pe.position_name,
			pe.rank_code,
			pc.period_start,
			pc.period_end,
			cs.period_month,
			cs.cost_source,
			cs.cost_basis,
			cs.standard_rate_code,
			cs.standard_cost,
			cs.actual_cost,
			total.total_work_hours
		ORDER BY allocated_cost DESC, work_hours DESC, pcs.employee_uid ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	actualTotal := 0.0
	standardTotal := 0.0
	allocatedActualTotal := 0.0
	allocatedStandardTotal := 0.0
	allocatedCostTotal := 0.0
	for _, item := range items {
		actualTotal += float64FromAny(item["actual_cost"])
		standardTotal += float64FromAny(item["standard_cost"])
		allocatedActualTotal += float64FromAny(item["allocated_actual_cost"])
		allocatedStandardTotal += float64FromAny(item["allocated_standard_cost"])
		allocatedCostTotal += float64FromAny(item["allocated_cost"])
	}
	return map[string]any{
		"project_code":                  projectCode,
		"period_month":                  periodMonth,
		"total_actual_cost":             allocatedActualTotal,
		"total_allocated_actual_cost":   allocatedActualTotal,
		"total_standard_cost":           allocatedStandardTotal,
		"total_allocated_standard_cost": allocatedStandardTotal,
		"total_allocated_cost":          allocatedCostTotal,
		"total_monthly_actual_cost":     actualTotal,
		"total_monthly_standard_cost":   standardTotal,
		"people_costs":                  items,
		"source_description":            "standard/actual cost_snapshots + contribution_snapshots allocated by project work-hour ratio",
	}, nil
}
