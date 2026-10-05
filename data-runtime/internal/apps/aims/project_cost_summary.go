package aims

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProjectCostSummaryRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method == http.MethodGet {
		if projectCode, ok := pathParam(path, "/v1/aims/service/projects/", "/cost-summary"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.projectCostSummary(ctx, projectCode, query)
			return data, "aims.service.projects.cost_summary.get", true, err
		}
	}
	if method == http.MethodPost {
		if projectCode, ok := pathParam(path, "/v1/aims/service/projects/", "/cost-summary:recalculate"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.recalculateProjectCostSummary(ctx, projectCode, body)
			return data, "aims.service.projects.cost_summary.recalculate", true, err
		}
	}
	return nil, "", false, nil
}

func (a *Adapter) projectCostSummary(ctx context.Context, projectCode string, query url.Values) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	where := []string{"project_code = ?", "deleted_at IS NULL"}
	args := []any{projectCode}
	if periodStart := strings.TrimSpace(query.Get("period_start")); periodStart != "" {
		where = append(where, "period_start >= ?")
		args = append(args, periodStart)
	}
	if periodEnd := strings.TrimSpace(query.Get("period_end")); periodEnd != "" {
		where = append(where, "period_end <= ?")
		args = append(args, periodEnd)
	}
	items, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM project_cost_summary
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY period_start DESC, period_end DESC, is_current DESC, version DESC, id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	var current map[string]any
	for _, item := range items {
		if fmt.Sprint(item["is_current"]) == "1" {
			current = item
			break
		}
	}
	return map[string]any{"project_code": projectCode, "current": current, "items": items, "total": len(items)}, nil
}

func (a *Adapter) recalculateProjectCostSummary(ctx context.Context, projectCode string, body map[string]any) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	periodStart := firstBodyText(body, "periodStart", "period_start")
	periodEnd := firstBodyText(body, "periodEnd", "period_end")
	if periodStart == "" || periodEnd == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_period", "periodStart and periodEnd are required")
	}
	if periodEnd < periodStart {
		return nil, httperror.New(http.StatusBadRequest, "invalid_period", "periodEnd must be on or after periodStart")
	}
	sourceVersion := firstBodyText(body, "sourceVersion", "source_version")
	operator := aimsActor(body)
	rates := projectCostHourlyRates(body)
	defaultRate, err := optionalAimsBodyFloat(body, "defaultHourlyCost", "default_hourly_cost")
	if err != nil || defaultRate < 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_cost_rate", "default hourly cost must be non-negative")
	}
	outsourcedCost, err := optionalAimsBodyFloat(body, "outsourcedCost", "outsourced_cost")
	if err != nil || outsourcedCost < 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_cost", "outsourcedCost must be non-negative")
	}
	otherCost, err := optionalAimsBodyFloat(body, "otherCost", "other_cost")
	if err != nil || otherCost < 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_cost", "otherCost must be non-negative")
	}

	project, err := projectByCode(ctx, a.DB(), projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}

	entries, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT
		  t.uid,
		  COUNT(*) AS worklog_count,
		  COALESCE(SUM(t.hours), 0) AS total_hours
		FROM time_entries t
		INNER JOIN aims_projects p ON p.id = t.project_id
		WHERE p.project_code = ?
		  AND t.weekly_report_id IS NULL
		  AND t.entry_date >= ?
		  AND t.entry_date <= ?
		GROUP BY t.uid
		ORDER BY t.uid ASC
	`, projectCode, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}

	totalWorklogs := int64(0)
	totalHours := 0.0
	laborCost := 0.0
	details := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		uid := strings.TrimSpace(fmt.Sprint(entry["uid"]))
		worklogs := aimsAnyInt64(entry["worklog_count"])
		hours := aimsAnyFloat(entry["total_hours"])
		rate := defaultRate
		if explicit, ok := rates[uid]; ok {
			rate = explicit
		}
		cost := hours * rate
		totalWorklogs += worklogs
		totalHours += hours
		laborCost += cost
		details = append(details, map[string]any{
			"uid":           uid,
			"worklog_count": worklogs,
			"hours":         hours,
			"hourly_cost":   rate,
			"labor_cost":    cost,
		})
	}
	totalCost := laborCost + outsourcedCost + otherCost
	calculationKey := firstBodyText(body, "calculationKey", "calculation_key")
	if calculationKey == "" {
		calculationKey = projectCostCalculationKey(projectCode, periodStart, periodEnd, sourceVersion, totalWorklogs, totalHours, laborCost, outsourcedCost, otherCost, rates, defaultRate)
	}
	detailJSON, err := json.Marshal(map[string]any{
		"worklogs":            details,
		"cost_rate_source":    firstBodyText(body, "costRateSource", "cost_rate_source"),
		"default_hourly_cost": defaultRate,
	})
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	existing, err := aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM project_cost_summary
		WHERE project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND calculation_key = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, projectCode, periodStart, periodEnd, calculationKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"summary": existing, "idempotent": true, "worklogs": details}, nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_cost_summary
		SET is_current = 0,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND deleted_at IS NULL
		  AND is_current = 1
	`, nullableText(operator), projectCode, periodStart, periodEnd); err != nil {
		return nil, err
	}
	var version int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1
		FROM project_cost_summary
		WHERE project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND deleted_at IS NULL
	`, projectCode, periodStart, periodEnd).Scan(&version); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_cost_summary (
		  project_code, period_start, period_end, total_worklogs, total_hours,
		  labor_cost, outsourced_cost, other_cost, total_cost,
		  calculation_key, source_version, calculated_at, version, is_current,
		  detail_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
	`, projectCode, periodStart, periodEnd, totalWorklogs, totalHours, laborCost, outsourcedCost, otherCost, totalCost, calculationKey, nullableText(sourceVersion), version, string(detailJSON), nullableText(operator), nullableText(operator))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	summary, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM project_cost_summary WHERE id = ? LIMIT 1", id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"summary": summary, "idempotent": false, "worklogs": details}, nil
}

func projectCostHourlyRates(body map[string]any) map[string]float64 {
	result := make(map[string]float64)
	for _, key := range []string{"hourlyCosts", "hourly_costs"} {
		raw, ok := body[key]
		if !ok || raw == nil {
			continue
		}
		if typed, ok := raw.(map[string]any); ok {
			for uid, value := range typed {
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64); err == nil && parsed >= 0 {
					result[strings.TrimSpace(uid)] = parsed
				}
			}
		}
	}
	for _, key := range []string{"standardCosts", "standard_costs"} {
		raw, ok := body[key]
		if !ok || raw == nil {
			continue
		}
		items, ok := raw.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			uid := firstBodyText(entry, "uid", "employeeUid", "employee_uid")
			if uid == "" {
				continue
			}
			rate, err := optionalAimsBodyFloat(entry, "hourlyCost", "hourly_cost", "standardHourlyCost", "standard_hourly_cost")
			if err == nil && rate >= 0 {
				result[uid] = rate
			}
		}
	}
	return result
}

func optionalAimsBodyFloat(body map[string]any, keys ...string) (float64, error) {
	for _, key := range keys {
		if _, ok := body[key]; !ok {
			continue
		}
		return bodyFloat(body, key)
	}
	return 0, nil
}

func projectCostCalculationKey(projectCode string, periodStart string, periodEnd string, sourceVersion string, totalWorklogs int64, totalHours float64, laborCost float64, outsourcedCost float64, otherCost float64, rates map[string]float64, defaultRate float64) string {
	keys := make([]string, 0, len(rates))
	for uid := range rates {
		keys = append(keys, uid)
	}
	sort.Strings(keys)
	parts := []string{
		projectCode,
		periodStart,
		periodEnd,
		sourceVersion,
		fmt.Sprintf("%d", totalWorklogs),
		fmt.Sprintf("%.4f", totalHours),
		fmt.Sprintf("%.2f", laborCost),
		fmt.Sprintf("%.2f", outsourcedCost),
		fmt.Sprintf("%.2f", otherCost),
		fmt.Sprintf("%.4f", defaultRate),
	}
	for _, uid := range keys {
		parts = append(parts, uid, fmt.Sprintf("%.4f", rates[uid]))
	}
	sum := sha1.Sum([]byte(strings.Join(parts, "|")))
	return "aims-project-cost:" + hex.EncodeToString(sum[:])
}

func aimsAnyFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case []byte:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(string(typed)), 64)
		return parsed
	default:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		return parsed
	}
}

func aimsAnyInt64(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case []byte:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(string(typed)), 10, 64)
		return parsed
	default:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return parsed
	}
}
