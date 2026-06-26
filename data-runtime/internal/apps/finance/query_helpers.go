package finance

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type pageParams struct {
	page     int
	pageSize int
	offset   int
}

func (a *Adapter) ListResource(ctx context.Context, spec ListResourceSpec, query url.Values) (ListResult[map[string]any], error) {
	page := getPageParams(query)
	where := make([]string, 0)
	args := make([]any, 0)

	if containsString(spec.Select, "deleted_at") {
		where = append(where, "deleted_at IS NULL")
	}

	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" && len(spec.SearchColumns) > 0 {
		searchParts := make([]string, 0, len(spec.SearchColumns))
		for _, column := range spec.SearchColumns {
			searchParts = append(searchParts, column+" LIKE ? ESCAPE '\\\\'")
			args = append(args, likeKeyword(keyword))
		}
		where = append(where, "("+strings.Join(searchParts, " OR ")+")")
	}

	if status := strings.TrimSpace(query.Get("status")); status != "" && spec.StatusColumn != "" {
		where = append(where, spec.StatusColumn+" = ?")
		args = append(args, status)
	}

	if dateFrom := strings.TrimSpace(query.Get("dateFrom")); dateFrom != "" && spec.DateColumn != "" {
		where = append(where, spec.DateColumn+" >= ?")
		args = append(args, dateFrom)
	}

	if dateTo := strings.TrimSpace(query.Get("dateTo")); dateTo != "" && spec.DateColumn != "" {
		where = append(where, spec.DateColumn+" <= ?")
		args = append(args, dateTo)
	}

	filterableCodes := []string{"customer_code", "contract_code", "project_code", "receivable_plan_code", "department_code", "employee_uid", "period_month", "allocation_type"}
	for _, column := range filterableCodes {
		value := strings.TrimSpace(query.Get(column))
		if value == "" {
			value = strings.TrimSpace(query.Get(camelCaseColumn(column)))
		}
		if value != "" && containsString(spec.Select, column) {
			where = append(where, column+" = ?")
			args = append(args, value)
		}
	}

	if isApplicantRequestTable(spec.Table) {
		applyApplicantRequestListAccess(&where, &args, query)
	}
	if isExpenseLedgerTable(spec.Table) {
		applyExpenseLedgerListAccess(&where, &args, query)
	}
	if isProjectFinanceTable(spec.Table) {
		applyProjectFinanceListAccess(&where, &args, query)
	}
	if isEmployeeCostSnapshotTable(spec.Table) {
		if err := requireProjectFinanceGlobalQueryAccess(query); err != nil {
			return ListResult[map[string]any]{}, err
		}
	}
	if isFinanceEmployeePerformanceTable(spec.Table) {
		applyFinanceEmployeePerformanceListAccess(&where, &args, query)
	}
	if isPerformanceCalculationSnapshotTable(spec.Table) {
		applyPerformanceCalculationSnapshotListAccess(&where, &args, query)
	}
	if isPerformanceRuleTable(spec.Table) {
		if err := requireFinancePerformanceGlobalQueryAccess(query); err != nil {
			return ListResult[map[string]any]{}, err
		}
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM "+spec.Table+whereSQL, args...).Scan(&total); err != nil {
		return ListResult[map[string]any]{}, err
	}

	rows, err := a.db.QueryContext(
		ctx,
		"SELECT "+strings.Join(spec.Select, ", ")+" FROM "+spec.Table+whereSQL+" ORDER BY "+spec.DefaultOrderBy+" LIMIT ? OFFSET ?",
		append(args, page.pageSize, page.offset)...,
	)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}
	defer rows.Close()

	data, err := rowsToMaps(rows)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}

	return ListResult[map[string]any]{
		Data:     data,
		Total:    total,
		Page:     page.page,
		PageSize: int64(page.pageSize),
	}, nil
}

func camelCaseColumn(column string) string {
	parts := strings.Split(column, "_")
	if len(parts) == 1 {
		return column
	}
	var builder strings.Builder
	builder.WriteString(parts[0])
	for _, part := range parts[1:] {
		if part == "" {
			continue
		}
		builder.WriteString(strings.ToUpper(part[:1]))
		builder.WriteString(part[1:])
	}
	return builder.String()
}

func (a *Adapter) GetRecordByCode(ctx context.Context, spec DetailResourceSpec, code string, query url.Values) (DataResult[map[string]any], error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "code_required", "code is required")
	}

	whereSQL := "code = ?"
	if spec.SoftDelete {
		whereSQL += " AND deleted_at IS NULL"
	}

	rows, err := a.db.QueryContext(ctx, "SELECT * FROM "+spec.Table+" WHERE "+whereSQL+" LIMIT 1", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer rows.Close()

	data, err := rowsToMaps(rows)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if len(data) == 0 {
		return DataResult[map[string]any]{}, httperror.New(http.StatusNotFound, "record_not_found", spec.NotFoundMessage)
	}
	if isApplicantRequestTable(spec.Table) {
		if err := requireApplicantRequestQueryAccess(query, data[0]); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isExpenseLedgerTable(spec.Table) {
		if err := requireExpenseLedgerQueryAccess(query, data[0]); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isFinanceEmployeePerformanceTable(spec.Table) {
		if err := requireFinanceEmployeePerformanceQueryAccess(query, data[0]); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isPerformanceCalculationSnapshotTable(spec.Table) {
		if err := requirePerformanceCalculationSnapshotQueryAccess(query, data[0]); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isPerformanceRuleTable(spec.Table) {
		if err := requireFinancePerformanceGlobalQueryAccess(query); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	return DataResult[map[string]any]{Data: data[0]}, nil
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0)
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}

	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = normalizeSQLValue(values[i])
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func queryMaps(ctx context.Context, conn *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func normalizeSQLValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func getPageParams(query url.Values) pageParams {
	page := clampInt(parsePositiveInt(query.Get("page"), 1), 1, 100000)
	pageSize := clampInt(parsePositiveInt(query.Get("pageSize"), 20), 1, 100)
	return pageParams{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func amountFromMap(row map[string]any, key string) float64 {
	value, ok := row[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	case float64:
		return typed
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(strings.ReplaceAll(fmt.Sprint(typed), ",", "")), 64)
		if err != nil {
			return 0
		}
		return parsed
	}
}
