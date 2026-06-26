package people

import (
	"context"
	"fmt"
	"hash/fnv"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type financeCostParameters struct {
	Code                     string
	Name                     string
	BaseSalary               float64
	WelfareCostRate          float64
	ManagementAllocationRate float64
	ResourceAllocationCost   float64
	Currency                 string
	EffectiveDate            string
}

func (a *Adapter) generateCostSnapshots(ctx context.Context, body map[string]any) (map[string]any, error) {
	periodMonth, monthStart, monthEnd, err := costSnapshotPeriod(body)
	if err != nil {
		return nil, err
	}
	parameters, ok := financeCostParametersFromBody(body)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "missing_finance_cost_parameters", "cost_parameters from Finance is required")
	}
	operator := cleanBodyString(body, "operator_uid", "current_user", "created_by", "updated_by")
	if operator == "" {
		operator = "people.standard-cost.generate"
	}

	employees, err := a.costSnapshotEmployees(ctx, employeeUIDsFromBody(body))
	if err != nil {
		return nil, err
	}
	rates, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_standard_cost_rates
		WHERE enabled = 1
		  AND (position_code IS NULL OR position_code = '')
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY effective_from DESC, sort_order ASC, id DESC
	`, monthEnd, monthStart)
	if err != nil {
		return nil, err
	}

	generated := 0
	skipped := make([]map[string]any, 0)
	for _, employee := range employees {
		employeeUID := cleanAnyString(employee["employee_uid"])
		if employeeUID == "" {
			continue
		}

		rate := bestStandardCostRate(employee, rates)
		standardCost := 0.0
		currency := firstNonEmptyString(parameters.Currency, "CNY")
		costSource := "standard_rate"
		sourceBizType := "rank_standard_cost"
		sourceBizID := ""
		standardRateCode := ""
		refs := map[string]any{
			"generated_by": "people.service.cost_snapshots.generate",
			"period_month": periodMonth,
			"cost_basis":   "standard",
			"finance_cost_parameters": map[string]any{
				"code":                       parameters.Code,
				"name":                       parameters.Name,
				"effective_date":             parameters.EffectiveDate,
				"base_salary":                parameters.BaseSalary,
				"welfare_cost_rate":          parameters.WelfareCostRate,
				"management_allocation_rate": parameters.ManagementAllocationRate,
				"resource_allocation_cost":   parameters.ResourceAllocationCost,
			},
			"note": "actual_cost is set to standard cost until payroll/actual cost is available",
		}

		if rate != nil {
			components := calculateRankStandardCost(rate, parameters)
			standardCost = components["monthly_standard_cost"]
			currency = firstNonEmptyString(cleanAnyString(rate["currency"]), currency)
			standardRateCode = cleanAnyString(rate["rate_code"])
			sourceBizID = standardRateCode
			refs["standard_rate_code"] = standardRateCode
			refs["standard_rate_name"] = cleanAnyString(rate["rate_name"])
			refs["rank_series"] = cleanAnyString(rate["rank_series"])
			refs["rank_level"] = rate["rank_level"]
			refs["rank_code"] = cleanAnyString(rate["rank_code"])
			refs["components"] = components
		}

		if standardCost <= 0 {
			skipped = append(skipped, map[string]any{
				"employee_uid": employeeUID,
				"reason":       "missing_rank_standard_cost",
			})
			continue
		}

		snapshotCode := stableCostSnapshotCode(periodMonth, employeeUID)
		if _, err := a.DB().ExecContext(ctx, `
			INSERT INTO people_cost_snapshots (
				snapshot_code,
				employee_uid,
				period_month,
				standard_cost,
				actual_cost,
				currency,
				cost_source,
				cost_basis,
				standard_rate_code,
				source_app,
				source_biz_type,
				source_biz_id,
				source_refs,
				created_by,
				updated_by
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'standard', ?, 'people', ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				standard_cost = VALUES(standard_cost),
				actual_cost = VALUES(actual_cost),
				currency = VALUES(currency),
				cost_source = VALUES(cost_source),
				cost_basis = VALUES(cost_basis),
				standard_rate_code = VALUES(standard_rate_code),
				source_app = VALUES(source_app),
				source_biz_type = VALUES(source_biz_type),
				source_biz_id = VALUES(source_biz_id),
				source_refs = VALUES(source_refs),
				updated_by = VALUES(updated_by),
				updated_at = CURRENT_TIMESTAMP
		`,
			snapshotCode,
			employeeUID,
			periodMonth,
			standardCost,
			standardCost,
			currency,
			costSource,
			nullableString(standardRateCode),
			sourceBizType,
			sourceBizID,
			jsonColumnValue(refs),
			operator,
			operator,
		); err != nil {
			return nil, err
		}

		if _, err := a.DB().ExecContext(ctx, `
			UPDATE people_employees
			SET monthly_standard_cost = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
			WHERE employee_uid = ?
		`, standardCost, operator, employeeUID); err != nil {
			return nil, err
		}

		generated++
	}

	return map[string]any{
		"period_month":      periodMonth,
		"employee_count":    len(employees),
		"rate_count":        len(rates),
		"generated":         generated,
		"skipped":           skipped,
		"cost_basis":        "standard",
		"source_table":      "people_standard_cost_rates",
		"snapshot_table":    "people_cost_snapshots",
		"finance_parameter": parameters.Code,
		"calculation_note":  "monthly_standard_cost = base_salary + rank_salary + performance_midpoint + welfare_cost + management_allocation + resource_allocation",
	}, nil
}

func (a *Adapter) resolveStandardCosts(ctx context.Context, query url.Values) (map[string]any, error) {
	effectiveDate := strings.TrimSpace(firstNonEmptyString(query.Get("effective_date"), query.Get("effectiveDate")))
	if effectiveDate == "" {
		effectiveDate = time.Now().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", effectiveDate); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_effective_date", "effective_date must be YYYY-MM-DD")
	}

	employeeUIDs := employeeUIDsFromQuery(query)
	if len(employeeUIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_employee_uids", "employee_uids is required")
	}

	employees, err := a.standardCostEmployees(ctx, employeeUIDs)
	if err != nil {
		return nil, err
	}
	assignments, err := a.effectiveAssignmentsByEmployee(ctx, employeeUIDs, effectiveDate)
	if err != nil {
		return nil, err
	}
	rates, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_standard_cost_rates
		WHERE enabled = 1
		  AND (position_code IS NULL OR position_code = '')
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY effective_from DESC, sort_order ASC, id DESC
	`, effectiveDate, effectiveDate)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]any, 0, len(employees))
	skipped := make([]map[string]any, 0)
	seen := map[string]bool{}
	for _, employee := range employees {
		employeeUID := cleanAnyString(employee["employee_uid"])
		if employeeUID == "" {
			continue
		}
		seen[employeeUID] = true
		resolved := copyMap(employee)
		rankSource := "employee"
		if assignment, ok := assignments[employeeUID]; ok {
			applyAssignmentSnapshot(resolved, assignment)
			rankSource = "assignment"
			resolved["assignment_code"] = assignment["assignment_code"]
			resolved["assignment_effective_from"] = assignment["effective_from"]
			resolved["assignment_effective_to"] = assignment["effective_to"]
		}
		rate := bestStandardCostRate(resolved, rates)
		if rate == nil {
			skipped = append(skipped, map[string]any{
				"employee_uid": employeeUID,
				"rank_code":    cleanAnyString(resolved["rank_code"]),
				"reason":       "missing_rank_standard_cost",
			})
			continue
		}
		items = append(items, map[string]any{
			"employee_uid":      employeeUID,
			"employee_no":       resolved["employee_no"],
			"employee_name":     firstNonEmptyString(cleanAnyString(resolved["display_name"]), cleanAnyString(resolved["employee_name"])),
			"employment_type":   resolved["employment_type"],
			"employment_status": resolved["employment_status"],
			"dept_code":         resolved["dept_code"],
			"dept_name":         resolved["dept_name"],
			"position_code":     resolved["position_code"],
			"position_name":     resolved["position_name"],
			"rank_code":         resolved["rank_code"],
			"rank_name":         resolved["rank_name"],
			"cost_center_code":  resolved["cost_center_code"],
			"rank_source":       rankSource,
			"standard_rate":     standardCostRateSummary(rate),
		})
	}
	for _, employeeUID := range employeeUIDs {
		if seen[employeeUID] {
			continue
		}
		skipped = append(skipped, map[string]any{
			"employee_uid": employeeUID,
			"reason":       "employee_not_found",
		})
	}

	return map[string]any{
		"effective_date": effectiveDate,
		"employee_count": len(employeeUIDs),
		"resolved":       len(items),
		"rate_count":     len(rates),
		"items":          items,
		"skipped":        skipped,
		"cost_basis":     "standard",
		"source_table":   "people_standard_cost_rates",
	}, nil
}

func costSnapshotPeriod(body map[string]any) (string, string, string, error) {
	periodMonth := cleanBodyString(body, "period_month", "periodMonth")
	if periodMonth == "" {
		periodMonth = time.Now().Format("2006-01")
	}
	if len(periodMonth) != 7 {
		return "", "", "", httperror.New(http.StatusBadRequest, "invalid_period_month", "period_month must be YYYY-MM")
	}
	start, err := time.Parse("2006-01-02", periodMonth+"-01")
	if err != nil || start.Format("2006-01") != periodMonth {
		return "", "", "", httperror.New(http.StatusBadRequest, "invalid_period_month", "period_month must be YYYY-MM")
	}
	end := start.AddDate(0, 1, -1)
	return periodMonth, start.Format("2006-01-02"), end.Format("2006-01-02"), nil
}

func employeeUIDsFromQuery(query url.Values) []string {
	result := make([]string, 0)
	seen := map[string]bool{}
	add := func(value string) {
		for _, item := range strings.Split(value, ",") {
			text := strings.TrimSpace(item)
			if text == "" || seen[text] {
				continue
			}
			seen[text] = true
			result = append(result, text)
		}
	}
	for _, key := range []string{"employee_uids", "employeeUids", "employee_uid", "employeeUid"} {
		for _, value := range query[key] {
			add(value)
		}
	}
	return result
}

func (a *Adapter) standardCostEmployees(ctx context.Context, employeeUIDs []string) ([]map[string]any, error) {
	sqlText := `
		SELECT employee_uid, employee_no, display_name, employment_status, employment_type, dept_code, dept_name,
		       position_code, position_name, rank_code, rank_name, cost_center_code, monthly_standard_cost
		FROM people_employees
		WHERE archived_at IS NULL
		  AND employee_uid IN (` + placeholders(len(employeeUIDs)) + `)
		ORDER BY employee_no ASC, id ASC
	`
	args := make([]any, 0, len(employeeUIDs))
	for _, uid := range employeeUIDs {
		args = append(args, uid)
	}
	return a.queryMaps(ctx, sqlText, args...)
}

func (a *Adapter) effectiveAssignmentsByEmployee(ctx context.Context, employeeUIDs []string, effectiveDate string) (map[string]map[string]any, error) {
	sqlText := `
		SELECT *
		FROM people_assignments
		WHERE employee_uid IN (` + placeholders(len(employeeUIDs)) + `)
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY employee_uid ASC, effective_from DESC, id DESC
	`
	args := make([]any, 0, len(employeeUIDs)+2)
	for _, uid := range employeeUIDs {
		args = append(args, uid)
	}
	args = append(args, effectiveDate, effectiveDate)
	rows, err := a.queryMaps(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	result := map[string]map[string]any{}
	for _, row := range rows {
		employeeUID := cleanAnyString(row["employee_uid"])
		if employeeUID == "" {
			continue
		}
		if _, exists := result[employeeUID]; !exists {
			result[employeeUID] = row
		}
	}
	return result, nil
}

func copyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func applyAssignmentSnapshot(employee map[string]any, assignment map[string]any) {
	for _, key := range []string{"dept_code", "dept_name", "position_code", "position_name", "rank_code", "rank_name", "manager_uid", "cost_center_code"} {
		if value := cleanAnyString(assignment[key]); value != "" {
			employee[key] = value
		}
	}
}

func standardCostRateSummary(rate map[string]any) map[string]any {
	keys := []string{
		"rate_code",
		"rate_name",
		"rank_code",
		"rank_name",
		"rank_series",
		"rank_level",
		"rank_salary",
		"performance_salary_min",
		"performance_salary_max",
		"currency",
		"effective_from",
		"effective_to",
	}
	result := make(map[string]any, len(keys))
	for _, key := range keys {
		result[key] = rate[key]
	}
	return result
}

func (a *Adapter) costSnapshotEmployees(ctx context.Context, employeeUIDs []string) ([]map[string]any, error) {
	sqlText := `
		SELECT employee_uid, employee_no, display_name, employment_status, employment_type, dept_code, dept_name,
		       position_code, position_name, rank_code, rank_name, cost_center_code, monthly_standard_cost
		FROM people_employees
		WHERE archived_at IS NULL
		  AND employment_status IN ('active', 'leaving')
	`
	args := make([]any, 0, len(employeeUIDs))
	if len(employeeUIDs) > 0 {
		sqlText += " AND employee_uid IN (" + placeholders(len(employeeUIDs)) + ")"
		for _, uid := range employeeUIDs {
			args = append(args, uid)
		}
	}
	sqlText += " ORDER BY employee_no ASC, id ASC"
	return a.queryMaps(ctx, sqlText, args...)
}

func employeeUIDsFromBody(body map[string]any) []string {
	result := make([]string, 0)
	seen := map[string]bool{}
	add := func(value any) {
		text := cleanAnyString(value)
		if text == "" || seen[text] {
			return
		}
		seen[text] = true
		result = append(result, text)
	}
	add(body["employee_uid"])
	add(body["employeeUid"])
	for _, key := range []string{"employee_uids", "employeeUids"} {
		raw, ok := body[key].([]any)
		if !ok {
			continue
		}
		for _, item := range raw {
			add(item)
		}
	}
	return result
}

func financeCostParametersFromBody(body map[string]any) (financeCostParameters, bool) {
	raw, nested := firstMapValue(body, "cost_parameters", "costParameters", "finance_cost_parameters", "financeCostParameters")
	if raw == nil {
		raw = body
	}
	parameters := financeCostParameters{
		Code:                     firstNonEmptyString(cleanAnyString(raw["code"]), cleanAnyString(raw["parameter_code"]), cleanAnyString(raw["parameterCode"])),
		Name:                     firstNonEmptyString(cleanAnyString(raw["name"]), cleanAnyString(raw["parameter_name"]), cleanAnyString(raw["parameterName"])),
		BaseSalary:               firstNumber(raw, "base_salary", "baseSalary"),
		WelfareCostRate:          firstNumber(raw, "welfare_cost_rate", "welfareCostRate"),
		ManagementAllocationRate: firstNumber(raw, "management_allocation_rate", "managementAllocationRate"),
		ResourceAllocationCost:   firstNumber(raw, "resource_allocation_cost", "resourceAllocationCost"),
		Currency:                 firstNonEmptyString(cleanAnyString(raw["currency_code"]), cleanAnyString(raw["currencyCode"]), cleanAnyString(raw["currency"])),
		EffectiveDate:            firstNonEmptyString(cleanAnyString(raw["effective_date"]), cleanAnyString(raw["effectiveDate"]), cleanAnyString(raw["effective_from"]), cleanAnyString(raw["effectiveFrom"])),
	}
	hasExplicitParameters := nested || cleanAnyString(body["base_salary"]) != "" || cleanAnyString(body["baseSalary"]) != ""
	return parameters, hasExplicitParameters
}

func firstMapValue(body map[string]any, keys ...string) (map[string]any, bool) {
	for _, key := range keys {
		if typed, ok := body[key].(map[string]any); ok {
			return typed, true
		}
	}
	return nil, false
}

func firstNumber(body map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := body[key]; value != nil && cleanAnyString(value) != "" {
			return float64FromAny(value)
		}
	}
	return 0
}

func calculateRankStandardCost(rate map[string]any, parameters financeCostParameters) map[string]float64 {
	baseSalary := parameters.BaseSalary
	rankSalary := float64FromAny(rate["rank_salary"])
	performanceMin := float64FromAny(rate["performance_salary_min"])
	performanceMax := float64FromAny(rate["performance_salary_max"])
	performanceMidpoint := 0.0
	if performanceMin > 0 || performanceMax > 0 {
		performanceMidpoint = (performanceMin + performanceMax) / 2
	}
	welfareBase := baseSalary + rankSalary + performanceMidpoint
	welfareCost := welfareBase * parameters.WelfareCostRate
	managementBase := welfareBase + welfareCost
	managementAllocation := managementBase * parameters.ManagementAllocationRate
	resourceAllocation := parameters.ResourceAllocationCost
	monthlyStandardCost := baseSalary + rankSalary + performanceMidpoint + welfareCost + managementAllocation + resourceAllocation

	return map[string]float64{
		"base_salary":                 baseSalary,
		"rank_salary":                 rankSalary,
		"performance_salary_min":      performanceMin,
		"performance_salary_max":      performanceMax,
		"performance_salary_midpoint": performanceMidpoint,
		"welfare_cost":                welfareCost,
		"management_allocation":       managementAllocation,
		"resource_allocation":         resourceAllocation,
		"monthly_standard_cost":       monthlyStandardCost,
	}
}

func bestStandardCostRate(employee map[string]any, rates []map[string]any) map[string]any {
	var best map[string]any
	bestScore := -1
	bestEffectiveFrom := ""
	for _, rate := range rates {
		if !standardCostRateMatches(employee, rate) {
			continue
		}
		score := standardCostRateScore(rate)
		effectiveFrom := cleanAnyString(rate["effective_from"])
		if best == nil || score > bestScore || (score == bestScore && effectiveFrom > bestEffectiveFrom) {
			best = rate
			bestScore = score
			bestEffectiveFrom = effectiveFrom
		}
	}
	return best
}

func standardCostRateMatches(employee map[string]any, rate map[string]any) bool {
	employeeRank := cleanAnyString(employee["rank_code"])
	rateRank := cleanAnyString(rate["rank_code"])
	if employeeRank == "" || rateRank == "" || employeeRank != rateRank {
		return false
	}
	return optionalEqual(rate["rank_series"], rankSeriesFromCode(employeeRank)) &&
		optionalEqual(rate["employment_type"], employee["employment_type"]) &&
		optionalEqual(rate["cost_center_code"], employee["cost_center_code"])
}

func standardCostRateScore(rate map[string]any) int {
	score := 0
	if cleanAnyString(rate["rank_code"]) != "" {
		score += 30
	}
	if cleanAnyString(rate["rank_series"]) != "" {
		score += 5
	}
	if cleanAnyString(rate["cost_center_code"]) != "" {
		score += 10
	}
	if cleanAnyString(rate["employment_type"]) != "" {
		score += 8
	}
	return score
}

func rankSeriesFromCode(rankCode string) string {
	rankCode = strings.ToUpper(strings.TrimSpace(rankCode))
	if rankCode == "" {
		return ""
	}
	if strings.HasPrefix(rankCode, "M") {
		return "M"
	}
	if strings.HasPrefix(rankCode, "P") {
		return "P"
	}
	return ""
}

func optionalEqual(required any, actual any) bool {
	requiredText := cleanAnyString(required)
	if requiredText == "" {
		return true
	}
	return requiredText == cleanAnyString(actual)
}

func stableCostSnapshotCode(periodMonth string, employeeUID string) string {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(periodMonth + ":" + employeeUID + ":standard-cost-v1"))
	return fmt.Sprintf("COST-%s-%08X", strings.ReplaceAll(periodMonth, "-", ""), hash.Sum32())
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
