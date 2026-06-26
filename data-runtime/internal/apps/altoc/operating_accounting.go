package altoc

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type contractLineCostAllocationInput struct {
	ProjectCode       string
	AllocationType    string
	AllocationRatio   *float64
	AllocatedAmount   *float64
	AllocatedWorkdays *float64
	EffectiveFrom     string
	EffectiveTo       string
	SourceType        string
	SourceRefCode     string
}

type serviceCostInput struct {
	ProjectCode       string
	EnvironmentCode   string
	TotalHours        float64
	TotalCost         float64
	TicketCount       int64
	SLATicketCount    int64
	CalculationSource string
}

func (a *Adapter) handleOperatingAccountingGet(ctx context.Context, path string, query url.Values) (any, string, bool, error) {
	if contractCode, ok := pathParam(path, "/v1/altoc/analytics/contract/", ""); ok {
		data, err := a.contractAnalytics(ctx, unescapePathParam(contractCode), query)
		return runtimeOK(data), "altoc.analytics.contract", true, err
	}
	if customerCode, ok := pathParam(path, "/v1/altoc/analytics/customer/", ""); ok {
		data, err := a.customerAnalytics(ctx, unescapePathParam(customerCode), query)
		return runtimeOK(data), "altoc.analytics.customer", true, err
	}
	if lineCode, ok := pathParam(path, "/v1/altoc/service/contract-lines/", "/cost-allocations"); ok {
		data, err := a.listContractLineCostAllocations(ctx, unescapePathParam(lineCode))
		return runtimeOK(data), "altoc.service.contract_lines.cost_allocations.list", true, err
	}
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/cost-summary"); ok {
		data, err := a.serviceCostSummary(ctx, unescapePathParam(agreementCode), query)
		return runtimeOK(data), "altoc.service.service_agreements.cost_summary.get", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleOperatingAccountingPost(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if lineCode, ok := pathParam(path, "/v1/altoc/service/contract-lines/", "/cost-allocations"); ok {
		data, err := a.replaceContractLineCostAllocations(ctx, unescapePathParam(lineCode), body)
		return runtimeOK(data), "altoc.service.contract_lines.cost_allocations.replace", true, err
	}
	if contractCode, ok := pathParam(path, "/v1/altoc/service/contracts/", "/profit-summary:recalculate"); ok {
		data, err := a.recalculateContractProfitSummary(ctx, unescapePathParam(contractCode), body)
		return runtimeOK(data), "altoc.service.contracts.profit_summary.recalculate", true, err
	}
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/cost-summary:recalculate"); ok {
		data, err := a.recalculateServiceCostSummary(ctx, unescapePathParam(agreementCode), body)
		return runtimeOK(data), "altoc.service.service_agreements.cost_summary.recalculate", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) listContractLineCostAllocations(ctx context.Context, lineCode string) (map[string]any, error) {
	line, err := altocContractLineByCode(ctx, a.DB(), lineCode)
	if err != nil {
		return nil, err
	}
	if line == nil {
		return nil, httperror.New(http.StatusNotFound, "contract_line_not_found", "contract line not found")
	}
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM contract_line_cost_allocation
		WHERE contract_line_code = ?
		  AND deleted_at IS NULL
		ORDER BY status ASC, project_code ASC, id ASC
	`, line["code"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract_line": line, "items": items, "total": len(items)}, nil
}

func (a *Adapter) replaceContractLineCostAllocations(ctx context.Context, lineCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	allocations, err := parseContractLineCostAllocationInputs(body)
	if err != nil {
		return nil, err
	}
	if err := validateContractLineCostAllocations(allocations); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	line, err := altocContractLineByCode(ctx, tx, lineCode)
	if err != nil {
		return nil, err
	}
	if line == nil {
		return nil, httperror.New(http.StatusNotFound, "contract_line_not_found", "contract line not found")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_line_cost_allocation
		SET status = 'closed',
		    deleted_at = CURRENT_TIMESTAMP,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_line_code = ?
		  AND deleted_at IS NULL
		  AND status = 'active'
	`, nullableText(operator), line["code"]); err != nil {
		return nil, err
	}
	for _, allocation := range allocations {
		snapshot, _ := json.Marshal(allocation)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO contract_line_cost_allocation (
			  tenant_id, contract_line_id, contract_line_code, contract_code, project_code,
			  allocation_type, allocation_ratio, allocated_amount, allocated_workdays,
			  effective_from, effective_to, status, source_type, source_ref_code,
			  snapshot_json, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
		`,
			nullableText(firstBodyText(body, "tenantId", "tenant_id")),
			line["id"],
			line["code"],
			line["contract_code"],
			allocation.ProjectCode,
			allocation.AllocationType,
			nullableFloat(allocation.AllocationRatio),
			nullableFloat(allocation.AllocatedAmount),
			nullableFloat(allocation.AllocatedWorkdays),
			nullableText(allocation.EffectiveFrom),
			nullableText(allocation.EffectiveTo),
			firstNonEmptyText(allocation.SourceType, "manual"),
			nullableText(allocation.SourceRefCode),
			string(snapshot),
			nullableText(operator),
			nullableText(operator),
		); err != nil {
			return nil, err
		}
	}
	items, err := altocQueryMaps(ctx, tx, `
		SELECT *
		FROM contract_line_cost_allocation
		WHERE contract_line_code = ?
		  AND deleted_at IS NULL
		ORDER BY project_code ASC, id ASC
	`, line["code"])
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"contract_line": line, "items": items, "total": len(items)}, nil
}

func (a *Adapter) recalculateContractProfitSummary(ctx context.Context, contractCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	periodStart := firstBodyText(body, "periodStart", "period_start")
	periodEnd := firstBodyText(body, "periodEnd", "period_end")
	if periodStart == "" || periodEnd == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_period", "periodStart and periodEnd are required")
	}
	if periodEnd < periodStart {
		return nil, httperror.New(http.StatusBadRequest, "invalid_period", "periodEnd must be on or after periodStart")
	}
	projectCosts, err := projectCostsFromBody(body)
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	sourceVersion := firstBodyText(body, "sourceVersion", "source_version")

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := altocQueryOneMap(ctx, tx, `
		SELECT c.*, cu.code AS customer_code
		FROM contract c
		LEFT JOIN customer cu ON cu.id = c.customer_id
		WHERE c.code = ?
		  AND c.deleted_at IS NULL
		LIMIT 1
	`, contractCode)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "contract_not_found", "contract not found")
	}
	lines, err := altocQueryMaps(ctx, tx, `
		SELECT cl.*, c.code AS contract_code, cu.code AS customer_code
		FROM contract_line cl
		INNER JOIN contract c ON c.id = cl.contract_id
		LEFT JOIN customer cu ON cu.id = c.customer_id
		WHERE c.code = ?
		  AND cl.deleted_at IS NULL
		ORDER BY cl.sort_no ASC, cl.id ASC
	`, contractCode)
	if err != nil {
		return nil, err
	}
	allocations, err := contractCostAllocationsByLine(ctx, tx, contract["id"], periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	if err := ensureProjectCostsAllocated(projectCosts, allocations); err != nil {
		return nil, err
	}
	workdayTotals := projectWorkdayTotals(allocations)
	results := make([]map[string]any, 0, len(lines))
	idempotent := true
	for _, line := range lines {
		lineCode := altocMapText(line, "code")
		revenue, err := contractLineRevenue(ctx, tx, line["id"], periodStart, periodEnd)
		if err != nil {
			return nil, err
		}
		lineCost, details := allocatedContractLineCost(allocations[lineCode], projectCosts, workdayTotals)
		profit := revenue - lineCost
		var margin any
		if revenue != 0 {
			margin = profit / revenue
		}
		projectCount := len(details)
		calculationKey := firstBodyText(body, "calculationKey", "calculation_key")
		if calculationKey == "" {
			calculationKey = contractLineProfitCalculationKey(lineCode, periodStart, periodEnd, sourceVersion, revenue, lineCost, details)
		}
		detailJSON, _ := json.Marshal(map[string]any{"allocations": details})
		summary, existed, err := insertContractLineProfitSummaryTx(ctx, tx, line, periodStart, periodEnd, revenue, lineCost, profit, margin, projectCount, calculationKey, sourceVersion, string(detailJSON), operator)
		if err != nil {
			return nil, err
		}
		if !existed {
			idempotent = false
		}
		results = append(results, summary)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":    contract,
		"periodStart": periodStart,
		"periodEnd":   periodEnd,
		"items":       results,
		"total":       len(results),
		"idempotent":  idempotent,
	}, nil
}

func (a *Adapter) serviceCostSummary(ctx context.Context, agreementCode string, query url.Values) (map[string]any, error) {
	agreement, err := serviceAgreementByCode(ctx, a.DB(), agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	where := []string{"service_agreement_code = ?", "deleted_at IS NULL"}
	args := []any{agreementCode}
	if periodStart := strings.TrimSpace(query.Get("period_start")); periodStart != "" {
		where = append(where, "period_start >= ?")
		args = append(args, periodStart)
	}
	if periodEnd := strings.TrimSpace(query.Get("period_end")); periodEnd != "" {
		where = append(where, "period_end <= ?")
		args = append(args, periodEnd)
	}
	if projectCode := strings.TrimSpace(firstNonEmptyText(query.Get("project_code"), query.Get("projectCode"))); projectCode != "" {
		where = append(where, "project_code = ?")
		args = append(args, projectCode)
	}
	if environmentCode := strings.TrimSpace(firstNonEmptyText(query.Get("environment_code"), query.Get("environmentCode"))); environmentCode != "" {
		where = append(where, "environment_code = ?")
		args = append(args, environmentCode)
	}
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM service_cost_summary
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY period_start DESC, period_end DESC, is_current DESC, version DESC, project_code ASC, id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	return map[string]any{"service_agreement": agreement, "items": items, "total": len(items)}, nil
}

func (a *Adapter) recalculateServiceCostSummary(ctx context.Context, agreementCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	periodStart := firstBodyText(body, "periodStart", "period_start")
	periodEnd := firstBodyText(body, "periodEnd", "period_end")
	if periodStart == "" || periodEnd == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_period", "periodStart and periodEnd are required")
	}
	if periodEnd < periodStart {
		return nil, httperror.New(http.StatusBadRequest, "invalid_period", "periodEnd must be on or after periodStart")
	}
	inputs, err := parseServiceCostInputs(body)
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	sourceVersion := firstBodyText(body, "sourceVersion", "source_version")
	defaultEnvironment := firstBodyText(body, "environmentCode", "environment_code")

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}

	results := make([]map[string]any, 0, len(inputs))
	idempotent := true
	for _, input := range inputs {
		if input.EnvironmentCode == "" {
			input.EnvironmentCode = defaultEnvironment
		}
		ticketCount, slaTicketCount, err := serviceTicketCountsTx(ctx, tx, agreement, input.ProjectCode, input.EnvironmentCode, periodStart, periodEnd)
		if err != nil {
			return nil, err
		}
		input.TicketCount = ticketCount
		input.SLATicketCount = slaTicketCount
		calculationKey := firstBodyText(body, "calculationKey", "calculation_key")
		if calculationKey == "" {
			calculationKey = serviceCostCalculationKey(agreementCode, periodStart, periodEnd, sourceVersion, input)
		}
		detailJSON, _ := json.Marshal(map[string]any{
			"project_code":       input.ProjectCode,
			"environment_code":   nullableText(input.EnvironmentCode),
			"ticket_count":       ticketCount,
			"sla_ticket_count":   slaTicketCount,
			"total_hours":        input.TotalHours,
			"total_cost":         input.TotalCost,
			"calculation_source": input.CalculationSource,
		})
		summary, existed, err := insertServiceCostSummaryTx(ctx, tx, agreementCode, input.ProjectCode, input.EnvironmentCode, periodStart, periodEnd, ticketCount, slaTicketCount, input.TotalHours, input.TotalCost, calculationKey, string(detailJSON), operator)
		if err != nil {
			return nil, err
		}
		if !existed {
			idempotent = false
		}
		results = append(results, summary)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"service_agreement": agreement,
		"periodStart":       periodStart,
		"periodEnd":         periodEnd,
		"items":             results,
		"total":             len(results),
		"idempotent":        idempotent,
	}, nil
}

func (a *Adapter) contractAnalytics(ctx context.Context, contractCode string, query url.Values) (map[string]any, error) {
	contract, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT c.*, cu.code AS customer_code
		FROM contract c
		LEFT JOIN customer cu ON cu.id = c.customer_id
		WHERE c.code = ?
		  AND c.deleted_at IS NULL
		LIMIT 1
	`, contractCode)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "contract_not_found", "contract not found")
	}
	where, args := profitSummaryWhere(query, "contract_code", contractCode)
	lines, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM contract_line_profit_summary
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY period_start ASC, contract_line_code ASC, version DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	serviceCosts, err := serviceCostRowsByContract(ctx, a.DB(), contractCode, query)
	if err != nil {
		return nil, err
	}
	revenue, lineCost, lineProfit := summarizeProfitRows(lines)
	serviceCost := summarizeServiceCostRows(serviceCosts)
	totalCost := lineCost + serviceCost
	profit := revenue - totalCost
	return map[string]any{
		"contract":    contract,
		"revenue":     revenue,
		"cost":        totalCost,
		"profit":      profit,
		"margin":      marginValue(profit, revenue),
		"lineCost":    lineCost,
		"lineProfit":  lineProfit,
		"serviceCost": serviceCost,
		"breakdown": map[string]any{
			"lines":        lines,
			"serviceCosts": serviceCosts,
		},
	}, nil
}

func (a *Adapter) customerAnalytics(ctx context.Context, customerCode string, query url.Values) (map[string]any, error) {
	customer, err := altocQueryOneMap(ctx, a.DB(), "SELECT * FROM customer WHERE code = ? AND deleted_at IS NULL LIMIT 1", customerCode)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
	}
	where, args := profitSummaryWhere(query, "customer_code", customerCode)
	lines, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM contract_line_profit_summary
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY period_start ASC, contract_code ASC, contract_line_code ASC, version DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	serviceCosts, err := serviceCostRowsByCustomer(ctx, a.DB(), customerCode, query)
	if err != nil {
		return nil, err
	}
	revenue, lineCost, lineProfit := summarizeProfitRows(lines)
	serviceCost := summarizeServiceCostRows(serviceCosts)
	totalCost := lineCost + serviceCost
	profit := revenue - totalCost
	return map[string]any{
		"customer":    customer,
		"revenue":     revenue,
		"cost":        totalCost,
		"profit":      profit,
		"margin":      marginValue(profit, revenue),
		"lineCost":    lineCost,
		"lineProfit":  lineProfit,
		"serviceCost": serviceCost,
		"breakdown": map[string]any{
			"lines":        lines,
			"serviceCosts": serviceCosts,
		},
	}, nil
}

func parseContractLineCostAllocationInputs(body map[string]any) ([]contractLineCostAllocationInput, error) {
	raw := body["allocations"]
	if raw == nil {
		raw = body["items"]
	}
	if raw == nil {
		raw = []any{body}
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocations", "allocations must be an array")
	}
	result := make([]contractLineCostAllocationInput, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocation", "allocation item is invalid")
		}
		allocationType := normalizeCostAllocationType(firstBodyText(entry, "allocationType", "allocation_type"))
		if allocationType == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocation_type", "allocationType is invalid")
		}
		allocation := contractLineCostAllocationInput{
			ProjectCode:    firstBodyText(entry, "projectCode", "project_code"),
			AllocationType: allocationType,
			EffectiveFrom:  firstBodyText(entry, "effectiveFrom", "effective_from"),
			EffectiveTo:    firstBodyText(entry, "effectiveTo", "effective_to"),
			SourceType:     firstBodyText(entry, "sourceType", "source_type"),
			SourceRefCode:  firstBodyText(entry, "sourceRefCode", "source_ref_code"),
		}
		if value, present, err := optionalAltocBodyFloat(entry, "allocationRatio", "allocation_ratio"); err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocation_ratio", "allocationRatio is invalid")
		} else if present {
			allocation.AllocationRatio = &value
		}
		if value, present, err := optionalAltocBodyFloat(entry, "allocatedAmount", "allocated_amount"); err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocation_amount", "allocatedAmount is invalid")
		} else if present {
			allocation.AllocatedAmount = &value
		}
		if value, present, err := optionalAltocBodyFloat(entry, "allocatedWorkdays", "allocated_workdays", "plannedWorkdays", "planned_workdays"); err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cost_allocation_workdays", "allocatedWorkdays is invalid")
		} else if present {
			allocation.AllocatedWorkdays = &value
		}
		result = append(result, allocation)
	}
	return result, nil
}

func validateContractLineCostAllocations(allocations []contractLineCostAllocationInput) error {
	if len(allocations) == 0 {
		return httperror.New(http.StatusBadRequest, "missing_cost_allocations", "at least one cost allocation is required")
	}
	ratioTotal := 0.0
	hasRatio := false
	for _, allocation := range allocations {
		if allocation.ProjectCode == "" {
			return httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
		}
		switch allocation.AllocationType {
		case "direct":
		case "ratio":
			hasRatio = true
			if allocation.AllocationRatio == nil || *allocation.AllocationRatio <= 0 {
				return httperror.New(http.StatusBadRequest, "invalid_cost_allocation_ratio", "ratio allocation requires allocationRatio > 0")
			}
			ratioTotal += *allocation.AllocationRatio
		case "amount":
			if allocation.AllocatedAmount == nil || *allocation.AllocatedAmount < 0 {
				return httperror.New(http.StatusBadRequest, "invalid_cost_allocation_amount", "amount allocation requires allocatedAmount >= 0")
			}
		case "workdays":
			if allocation.AllocatedWorkdays == nil || *allocation.AllocatedWorkdays <= 0 {
				return httperror.New(http.StatusBadRequest, "invalid_cost_allocation_workdays", "workdays allocation requires allocatedWorkdays > 0")
			}
		}
	}
	if hasRatio && (ratioTotal < 99.9999 || ratioTotal > 100.0001) {
		return httperror.New(http.StatusBadRequest, "invalid_cost_allocation_ratio_total", "ratio allocations must total 100")
	}
	return nil
}

func normalizeCostAllocationType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "direct":
		return "direct"
	case "ratio", "amount", "workdays":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func altocContractLineByCode(ctx context.Context, conn altocQueryer, lineCode string) (map[string]any, error) {
	lineCode = strings.TrimSpace(lineCode)
	if lineCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_line_code", "contractLineCode is required")
	}
	return altocQueryOneMap(ctx, conn, `
		SELECT cl.*, c.code AS contract_code, cu.code AS customer_code
		FROM contract_line cl
		INNER JOIN contract c ON c.id = cl.contract_id
		LEFT JOIN customer cu ON cu.id = c.customer_id
		WHERE cl.code = ?
		  AND cl.deleted_at IS NULL
		  AND c.deleted_at IS NULL
		LIMIT 1
	`, lineCode)
}

func projectCostsFromBody(body map[string]any) (map[string]float64, error) {
	result := make(map[string]float64)
	for _, key := range []string{"projectCosts", "project_costs"} {
		raw, ok := body[key]
		if !ok || raw == nil {
			continue
		}
		switch typed := raw.(type) {
		case map[string]any:
			for projectCode, value := range typed {
				cost, err := parseAltocFloat(value)
				if err != nil || cost < 0 {
					return nil, httperror.New(http.StatusBadRequest, "invalid_project_cost", "project cost must be non-negative")
				}
				result[strings.TrimSpace(projectCode)] = cost
			}
		case []any:
			for _, item := range typed {
				entry, ok := item.(map[string]any)
				if !ok {
					return nil, httperror.New(http.StatusBadRequest, "invalid_project_cost", "project cost item is invalid")
				}
				projectCode := firstBodyText(entry, "projectCode", "project_code")
				cost, present, err := optionalAltocBodyFloat(entry, "totalCost", "total_cost", "cost")
				if projectCode == "" || !present || err != nil || cost < 0 {
					return nil, httperror.New(http.StatusBadRequest, "invalid_project_cost", "project cost item requires projectCode and non-negative totalCost")
				}
				result[projectCode] = cost
			}
		}
	}
	return result, nil
}

func parseServiceCostInputs(body map[string]any) ([]serviceCostInput, error) {
	raw := body["serviceCosts"]
	if raw == nil {
		raw = body["service_costs"]
	}
	if raw == nil {
		raw = body["items"]
	}
	if raw != nil {
		items, ok := raw.([]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_service_costs", "serviceCosts must be an array")
		}
		result := make([]serviceCostInput, 0, len(items))
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				return nil, httperror.New(http.StatusBadRequest, "invalid_service_cost", "service cost item is invalid")
			}
			projectCode := firstBodyText(entry, "projectCode", "project_code")
			totalCost, present, err := optionalAltocBodyFloat(entry, "totalCost", "total_cost", "cost")
			if projectCode == "" || !present || err != nil || totalCost < 0 {
				return nil, httperror.New(http.StatusBadRequest, "invalid_service_cost", "service cost item requires projectCode and non-negative totalCost")
			}
			totalHours, _, err := optionalAltocBodyFloat(entry, "totalHours", "total_hours", "hours")
			if err != nil || totalHours < 0 {
				return nil, httperror.New(http.StatusBadRequest, "invalid_service_hours", "service totalHours must be non-negative")
			}
			result = append(result, serviceCostInput{
				ProjectCode:       projectCode,
				EnvironmentCode:   firstBodyText(entry, "environmentCode", "environment_code"),
				TotalHours:        totalHours,
				TotalCost:         totalCost,
				CalculationSource: firstNonEmptyText(firstBodyText(entry, "calculationSource", "calculation_source"), "aims_project_cost_summary"),
			})
		}
		if len(result) == 0 {
			return nil, httperror.New(http.StatusBadRequest, "missing_service_costs", "at least one service cost item is required")
		}
		return result, nil
	}

	projectCosts, err := projectCostsFromBody(body)
	if err != nil {
		return nil, err
	}
	if len(projectCosts) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_service_costs", "serviceCosts or projectCosts is required")
	}
	keys := sortedProjectCodes(projectCosts)
	result := make([]serviceCostInput, 0, len(keys))
	for _, projectCode := range keys {
		result = append(result, serviceCostInput{
			ProjectCode:       projectCode,
			EnvironmentCode:   firstBodyText(body, "environmentCode", "environment_code"),
			TotalCost:         projectCosts[projectCode],
			CalculationSource: "project_costs",
		})
	}
	return result, nil
}

func ensureProjectCostsAllocated(projectCosts map[string]float64, allocations map[string][]map[string]any) error {
	if len(projectCosts) == 0 {
		return nil
	}
	allocatedProjects := map[string]bool{}
	for _, rows := range allocations {
		for _, row := range rows {
			if projectCode := altocMapText(row, "project_code"); projectCode != "" {
				allocatedProjects[projectCode] = true
			}
		}
	}
	missing := []string{}
	for _, projectCode := range sortedProjectCodes(projectCosts) {
		if projectCosts[projectCode] == 0 {
			continue
		}
		if !allocatedProjects[projectCode] {
			missing = append(missing, projectCode)
		}
	}
	if len(missing) > 0 {
		return httperror.New(http.StatusConflict, "unallocated_project_cost", "project costs require explicit contract line cost allocations: "+strings.Join(missing, ","))
	}
	return nil
}

func contractCostAllocationsByLine(ctx context.Context, conn altocQueryer, contractID any, periodStart string, periodEnd string) (map[string][]map[string]any, error) {
	rows, err := altocQueryMaps(ctx, conn, `
		SELECT a.*
		FROM contract_line_cost_allocation a
		INNER JOIN contract_line cl ON cl.code = a.contract_line_code
		WHERE cl.contract_id = ?
		  AND a.deleted_at IS NULL
		  AND a.status = 'active'
		  AND (a.effective_from IS NULL OR a.effective_from <= ?)
		  AND (a.effective_to IS NULL OR a.effective_to >= ?)
		ORDER BY a.contract_line_code ASC, a.project_code ASC, a.id ASC
	`, contractID, periodEnd, periodStart)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]map[string]any)
	for _, row := range rows {
		lineCode := altocMapText(row, "contract_line_code")
		result[lineCode] = append(result[lineCode], row)
	}
	return result, nil
}

func projectWorkdayTotals(allocations map[string][]map[string]any) map[string]float64 {
	result := make(map[string]float64)
	for _, rows := range allocations {
		for _, row := range rows {
			if altocMapText(row, "allocation_type") != "workdays" {
				continue
			}
			projectCode := altocMapText(row, "project_code")
			result[projectCode] += altocAnyFloat(row["allocated_workdays"])
		}
	}
	return result
}

func contractLineRevenue(ctx context.Context, conn altocQueryer, contractLineID any, periodStart string, periodEnd string) (float64, error) {
	row, err := altocQueryOneMap(ctx, conn, `
		SELECT COALESCE(SUM(
		  CASE
		    WHEN paid_amount IS NOT NULL AND paid_amount > 0 THEN paid_amount
		    ELSE amount
		  END
		), 0) AS revenue
		FROM contract_billing_schedule
		WHERE contract_line_id = ?
		  AND direction = 'receivable'
		  AND deleted_at IS NULL
		  AND status <> 'cancelled'
		  AND COALESCE(due_date, expected_date) >= ?
		  AND COALESCE(due_date, expected_date) <= ?
	`, contractLineID, periodStart, periodEnd)
	if err != nil {
		return 0, err
	}
	if row == nil {
		return 0, nil
	}
	return altocAnyFloat(row["revenue"]), nil
}

func allocatedContractLineCost(allocations []map[string]any, projectCosts map[string]float64, workdayTotals map[string]float64) (float64, []map[string]any) {
	total := 0.0
	details := make([]map[string]any, 0, len(allocations))
	for _, allocation := range allocations {
		projectCode := altocMapText(allocation, "project_code")
		projectCost := projectCosts[projectCode]
		allocationType := altocMapText(allocation, "allocation_type")
		allocated := 0.0
		switch allocationType {
		case "direct":
			allocated = projectCost
		case "ratio":
			allocated = projectCost * altocAnyFloat(allocation["allocation_ratio"]) / 100
		case "amount":
			allocated = altocAnyFloat(allocation["allocated_amount"])
		case "workdays":
			denominator := workdayTotals[projectCode]
			if denominator > 0 {
				allocated = projectCost * altocAnyFloat(allocation["allocated_workdays"]) / denominator
			}
		}
		total += allocated
		details = append(details, map[string]any{
			"project_code":       projectCode,
			"allocation_type":    allocationType,
			"project_cost":       projectCost,
			"allocated_cost":     allocated,
			"allocation_ratio":   allocation["allocation_ratio"],
			"allocated_amount":   allocation["allocated_amount"],
			"allocated_workdays": allocation["allocated_workdays"],
		})
	}
	return total, details
}

func serviceTicketCountsTx(ctx context.Context, tx *sql.Tx, agreement map[string]any, projectCode string, environmentCode string, periodStart string, periodEnd string) (int64, int64, error) {
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COUNT(*) AS ticket_count,
		  COALESCE(SUM(CASE
		    WHEN sla_status IS NOT NULL AND sla_status <> '' AND sla_status <> 'not_started' THEN 1
		    WHEN response_due_at IS NOT NULL OR resolution_due_at IS NOT NULL THEN 1
		    ELSE 0
		  END), 0) AS sla_ticket_count
		FROM service_ticket
		WHERE deleted_at IS NULL
		  AND status <> 'cancelled'
		  AND (service_agreement_id = ? OR service_agreement_code = ?)
		  AND (? = '' OR project_code = ? OR aims_project_code = ?)
		  AND (? = '' OR environment_code = ?)
		  AND DATE(COALESCE(closed_at, resolved_at, created_at)) >= ?
		  AND DATE(COALESCE(closed_at, resolved_at, created_at)) <= ?
	`, agreement["id"], agreement["code"], projectCode, projectCode, projectCode, environmentCode, environmentCode, periodStart, periodEnd)
	if err != nil {
		return 0, 0, err
	}
	if row == nil {
		return 0, 0, nil
	}
	return altocAnyInt64(row["ticket_count"]), altocAnyInt64(row["sla_ticket_count"]), nil
}

func insertContractLineProfitSummaryTx(ctx context.Context, tx *sql.Tx, line map[string]any, periodStart string, periodEnd string, revenue float64, cost float64, profit float64, margin any, projectCount int, calculationKey string, sourceVersion string, detailJSON string, operator string) (map[string]any, bool, error) {
	lineCode := altocMapText(line, "code")
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_line_profit_summary
		WHERE contract_line_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND calculation_key = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, lineCode, periodStart, periodEnd, calculationKey)
	if err != nil || existing != nil {
		return existing, existing != nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_line_profit_summary
		SET is_current = 0,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_line_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND deleted_at IS NULL
		  AND is_current = 1
	`, nullableText(operator), lineCode, periodStart, periodEnd); err != nil {
		return nil, false, err
	}
	var version int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1
		FROM contract_line_profit_summary
		WHERE contract_line_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND deleted_at IS NULL
	`, lineCode, periodStart, periodEnd).Scan(&version); err != nil {
		return nil, false, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO contract_line_profit_summary (
		  contract_line_code, contract_code, customer_code, period_start, period_end,
		  total_revenue, total_cost, gross_profit, gross_margin, project_count,
		  calculation_key, source_version, calculated_at, version, is_current,
		  detail_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
	`, lineCode, line["contract_code"], line["customer_code"], periodStart, periodEnd, revenue, cost, profit, margin, projectCount, calculationKey, nullableText(sourceVersion), version, detailJSON, nullableText(operator), nullableText(operator))
	if err != nil {
		return nil, false, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, false, err
	}
	summary, err := altocQueryOneMap(ctx, tx, "SELECT * FROM contract_line_profit_summary WHERE id = ? LIMIT 1", id)
	return summary, false, err
}

func insertServiceCostSummaryTx(ctx context.Context, tx *sql.Tx, agreementCode string, projectCode string, environmentCode string, periodStart string, periodEnd string, ticketCount int64, slaTicketCount int64, totalHours float64, totalCost float64, calculationKey string, detailJSON string, operator string) (map[string]any, bool, error) {
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_cost_summary
		WHERE service_agreement_code = ?
		  AND project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND calculation_key = ?
		  AND ((environment_code IS NULL AND ? IS NULL) OR environment_code = ?)
		  AND deleted_at IS NULL
		LIMIT 1
	`, agreementCode, projectCode, periodStart, periodEnd, calculationKey, nullableText(environmentCode), environmentCode)
	if err != nil || existing != nil {
		return existing, existing != nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE service_cost_summary
		SET is_current = 0,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE service_agreement_code = ?
		  AND project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND ((environment_code IS NULL AND ? IS NULL) OR environment_code = ?)
		  AND deleted_at IS NULL
		  AND is_current = 1
	`, nullableText(operator), agreementCode, projectCode, periodStart, periodEnd, nullableText(environmentCode), environmentCode); err != nil {
		return nil, false, err
	}
	var version int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1
		FROM service_cost_summary
		WHERE service_agreement_code = ?
		  AND project_code = ?
		  AND period_start = ?
		  AND period_end = ?
		  AND ((environment_code IS NULL AND ? IS NULL) OR environment_code = ?)
		  AND deleted_at IS NULL
	`, agreementCode, projectCode, periodStart, periodEnd, nullableText(environmentCode), environmentCode).Scan(&version); err != nil {
		return nil, false, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO service_cost_summary (
		  service_agreement_code, project_code, environment_code, period_start, period_end,
		  ticket_count, sla_ticket_count, total_hours, total_cost,
		  calculation_key, calculated_at, version, is_current,
		  detail_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
	`, agreementCode, projectCode, nullableText(environmentCode), periodStart, periodEnd, ticketCount, slaTicketCount, totalHours, totalCost, calculationKey, version, detailJSON, nullableText(operator), nullableText(operator))
	if err != nil {
		return nil, false, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, false, err
	}
	summary, err := altocQueryOneMap(ctx, tx, "SELECT * FROM service_cost_summary WHERE id = ? LIMIT 1", id)
	return summary, false, err
}

func profitSummaryWhere(query url.Values, field string, value string) ([]string, []any) {
	where := []string{field + " = ?", "deleted_at IS NULL", "is_current = 1"}
	args := []any{value}
	if periodStart := strings.TrimSpace(query.Get("period_start")); periodStart != "" {
		where = append(where, "period_start >= ?")
		args = append(args, periodStart)
	}
	if periodEnd := strings.TrimSpace(query.Get("period_end")); periodEnd != "" {
		where = append(where, "period_end <= ?")
		args = append(args, periodEnd)
	}
	return where, args
}

func serviceCostRowsByContract(ctx context.Context, conn altocQueryer, contractCode string, query url.Values) ([]map[string]any, error) {
	where := []string{"ct.code = ?", "scs.deleted_at IS NULL", "scs.is_current = 1", "sa.deleted_at IS NULL", "ct.deleted_at IS NULL"}
	args := []any{contractCode}
	if periodStart := strings.TrimSpace(query.Get("period_start")); periodStart != "" {
		where = append(where, "scs.period_start >= ?")
		args = append(args, periodStart)
	}
	if periodEnd := strings.TrimSpace(query.Get("period_end")); periodEnd != "" {
		where = append(where, "scs.period_end <= ?")
		args = append(args, periodEnd)
	}
	return altocQueryMaps(ctx, conn, `
		SELECT scs.*, sa.contract_id, sa.contract_line_id, ct.code AS contract_code, sa.customer_code
		FROM service_cost_summary scs
		INNER JOIN service_agreement sa ON sa.code = scs.service_agreement_code
		INNER JOIN contract ct ON ct.id = sa.contract_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY scs.period_start ASC, scs.service_agreement_code ASC, scs.project_code ASC, scs.version DESC
	`, args...)
}

func serviceCostRowsByCustomer(ctx context.Context, conn altocQueryer, customerCode string, query url.Values) ([]map[string]any, error) {
	where := []string{"COALESCE(sa.customer_code, cu.code) = ?", "scs.deleted_at IS NULL", "scs.is_current = 1", "sa.deleted_at IS NULL", "ct.deleted_at IS NULL"}
	args := []any{customerCode}
	if periodStart := strings.TrimSpace(query.Get("period_start")); periodStart != "" {
		where = append(where, "scs.period_start >= ?")
		args = append(args, periodStart)
	}
	if periodEnd := strings.TrimSpace(query.Get("period_end")); periodEnd != "" {
		where = append(where, "scs.period_end <= ?")
		args = append(args, periodEnd)
	}
	return altocQueryMaps(ctx, conn, `
		SELECT scs.*, sa.contract_id, sa.contract_line_id, ct.code AS contract_code, COALESCE(sa.customer_code, cu.code) AS customer_code
		FROM service_cost_summary scs
		INNER JOIN service_agreement sa ON sa.code = scs.service_agreement_code
		INNER JOIN contract ct ON ct.id = sa.contract_id
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY scs.period_start ASC, scs.service_agreement_code ASC, scs.project_code ASC, scs.version DESC
	`, args...)
}

func summarizeProfitRows(rows []map[string]any) (float64, float64, float64) {
	revenue := 0.0
	cost := 0.0
	profit := 0.0
	for _, row := range rows {
		revenue += altocAnyFloat(row["total_revenue"])
		cost += altocAnyFloat(row["total_cost"])
		profit += altocAnyFloat(row["gross_profit"])
	}
	return revenue, cost, profit
}

func summarizeServiceCostRows(rows []map[string]any) float64 {
	total := 0.0
	for _, row := range rows {
		total += altocAnyFloat(row["total_cost"])
	}
	return total
}

func marginValue(profit float64, revenue float64) any {
	if revenue == 0 {
		return nil
	}
	return profit / revenue
}

func contractLineProfitCalculationKey(lineCode string, periodStart string, periodEnd string, sourceVersion string, revenue float64, cost float64, details []map[string]any) string {
	detailBytes, _ := json.Marshal(details)
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%s|%s|%.2f|%.2f|%s", lineCode, periodStart, periodEnd, sourceVersion, revenue, cost, string(detailBytes))))
	return "altoc-line-profit:" + hex.EncodeToString(sum[:])
}

func serviceCostCalculationKey(agreementCode string, periodStart string, periodEnd string, sourceVersion string, input serviceCostInput) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s|%.4f|%.2f|%d|%d",
		agreementCode,
		input.ProjectCode,
		firstNonEmptyText(input.EnvironmentCode, "-"),
		periodStart,
		periodEnd,
		sourceVersion,
		input.TotalHours,
		input.TotalCost,
		input.TicketCount,
		input.SLATicketCount,
	)))
	return "altoc-service-cost:" + hex.EncodeToString(sum[:])
}

func optionalAltocBodyFloat(body map[string]any, keys ...string) (float64, bool, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		parsed, err := parseAltocFloat(value)
		return parsed, true, err
	}
	return 0, false, nil
}

func parseAltocFloat(value any) (float64, error) {
	var parsed float64
	var err error
	switch typed := value.(type) {
	case float64:
		parsed = typed
	case float32:
		parsed = float64(typed)
	case int:
		parsed = float64(typed)
	case int64:
		parsed = float64(typed)
	case []byte:
		parsed, err = strconv.ParseFloat(strings.TrimSpace(string(typed)), 64)
	default:
		parsed, err = strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	}
	if err != nil {
		return 0, err
	}
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0, fmt.Errorf("invalid finite number")
	}
	return parsed, nil
}

func altocAnyFloat(value any) float64 {
	parsed, _ := parseAltocFloat(value)
	return parsed
}

func altocAnyInt64(value any) int64 {
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

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func sortedProjectCodes(costs map[string]float64) []string {
	keys := make([]string, 0, len(costs))
	for key := range costs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
