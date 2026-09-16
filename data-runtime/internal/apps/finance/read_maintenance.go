package finance

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type maintenanceFinancialScope struct {
	CustomerCode           string
	ContractCodes          []string
	ProjectCodes           []string
	AuthorizedProjectCodes []string
	ProjectScoped          bool
	PeriodMonth            string
}

func (a *Adapter) MaintenanceFinancialSummary(ctx context.Context, customerCode string, query url.Values) (DataResult[map[string]any], error) {
	scope, err := maintenanceFinancialScopeFromQuery(customerCode, query)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if scope.ProjectScoped && len(scope.ProjectCodes) == 0 {
		return emptyMaintenanceFinancialSummary(scope), nil
	}

	invoiceSummary, err := queryOneMap(ctx, a.db, `
		SELECT
		  COALESCE(SUM(invoice_amount), 0) AS invoice_amount,
		  COUNT(*) AS invoice_count,
		  MAX(invoice_date) AS latest_invoice_date
		FROM finance_invoice
		WHERE `+maintenanceFinanceWhere(scope, "customer_code", "contract_code", "project_code", "DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m')")+`
		  AND deleted_at IS NULL
		  AND status NOT IN ('canceled', 'red_reversed')
	`, maintenanceFinanceArgs(scope, "customer", "contract", "project", "authorized_project", "period")...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	receiptSummary, err := queryOneMap(ctx, a.db, `
		SELECT
		  COALESCE(SUM(receipt.received_amount), 0) AS received_amount,
		  COUNT(*) AS receipt_count,
		  MAX(receipt.received_at) AS latest_received_at,
		  COALESCE(SUM(CASE WHEN income_type.code = 'maintenance' THEN receipt.received_amount ELSE 0 END), 0) AS maintenance_classified_received_amount
		FROM finance_receipt receipt
		LEFT JOIN finance_income_type income_type ON income_type.id = receipt.income_type_id
		WHERE `+maintenanceFinanceWhere(scope, "receipt.customer_code", "receipt.contract_code", "receipt.project_code", "DATE_FORMAT(receipt.received_at, '%Y-%m')")+`
		  AND receipt.deleted_at IS NULL
		  AND receipt.status <> 'canceled'
	`, maintenanceFinanceArgs(scope, "customer", "contract", "project", "authorized_project", "period")...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	reconciliationSummary, err := queryOneMap(ctx, a.db, `
		SELECT
		  COALESCE(SUM(reconciled_amount), 0) AS reconciled_amount,
		  COUNT(*) AS reconciliation_count,
		  MAX(reconciled_at) AS latest_reconciled_at
		FROM finance_reconciliation
		WHERE `+maintenanceFinanceWhere(scope, "customer_code", "contract_code", "project_code", "DATE_FORMAT(reconciled_at, '%Y-%m')")+`
		  AND status = 'active'
	`, maintenanceFinanceArgs(scope, "customer", "contract", "project", "authorized_project", "period")...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	projectSummaryWhere, projectSummaryArgs := maintenanceProjectSummaryWhere(scope)
	projectSummary, err := queryOneMap(ctx, a.db, `
		SELECT
		  COALESCE(SUM(direct_expense_amount), 0) AS direct_expense_amount,
		  COALESCE(SUM(labor_cost_amount), 0) AS labor_cost_amount,
		  COALESCE(SUM(allocated_cost_amount), 0) AS allocated_cost_amount,
		  CASE
		    WHEN SUM(CASE WHEN cost_readiness_status <> 'ready' THEN 1 ELSE 0 END) > 0 THEN NULL
		    ELSE SUM(gross_profit_amount)
		  END AS project_gross_profit_amount,
		  SUM(CASE WHEN cost_readiness_status <> 'ready' THEN 1 ELSE 0 END) AS not_ready_project_count,
		  COUNT(DISTINCT project_code) AS project_count
		FROM project_finance_summary
		WHERE `+projectSummaryWhere,
		projectSummaryArgs...,
	)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	allocationRows, err := maintenanceCostAllocations(ctx, a, scope)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	periodRows, err := queryMaps(ctx, a.db, `
		SELECT
		  period_month,
		  COALESCE(SUM(invoice_amount), 0) AS invoice_amount,
		  COALESCE(SUM(received_amount), 0) AS received_amount,
		  COALESCE(SUM(direct_expense_amount), 0) AS direct_expense_amount,
		  COALESCE(SUM(labor_cost_amount), 0) AS labor_cost_amount,
		  COALESCE(SUM(allocated_cost_amount), 0) AS allocated_cost_amount,
		  CASE
		    WHEN SUM(CASE WHEN cost_readiness_status <> 'ready' THEN 1 ELSE 0 END) > 0 THEN NULL
		    ELSE SUM(gross_profit_amount)
		  END AS gross_profit_amount,
		  SUM(CASE WHEN cost_readiness_status <> 'ready' THEN 1 ELSE 0 END) AS not_ready_project_count
		FROM project_finance_summary
		WHERE `+projectSummaryWhere+`
		GROUP BY period_month
		ORDER BY period_month DESC
		LIMIT 24
	`, projectSummaryArgs...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	invoiceAmount := amountFromMap(invoiceSummary, "invoice_amount")
	receivedAmount := amountFromMap(receiptSummary, "received_amount")
	reconciledAmount := amountFromMap(reconciliationSummary, "reconciled_amount")
	directExpenseAmount := amountFromMap(projectSummary, "direct_expense_amount")
	laborCostAmount := amountFromMap(projectSummary, "labor_cost_amount")
	allocatedCostAmount := amountFromMap(projectSummary, "allocated_cost_amount")
	serviceCostAmount := directExpenseAmount + laborCostAmount + allocatedCostAmount
	notReadyProjectCount := amountFromMap(projectSummary, "not_ready_project_count")
	projectCount := amountFromMap(projectSummary, "project_count")
	costReady := projectCount > 0 && notReadyProjectCount == 0 && (len(scope.ProjectCodes) == 0 || projectCount >= float64(len(scope.ProjectCodes)))
	costReadinessStatus := "not_ready"
	var grossProfitAmount any
	var grossMarginRate any
	if costReady {
		costReadinessStatus = "ready"
		gross := receivedAmount - serviceCostAmount
		grossProfitAmount = fmt.Sprintf("%.2f", gross)
		if receivedAmount > 0 {
			grossMarginRate = fmt.Sprintf("%.4f", gross/receivedAmount)
		}
	}

	return DataResult[map[string]any]{Data: map[string]any{
		"customerCode":   scope.CustomerCode,
		"contractCodes":  scope.ContractCodes,
		"projectCodes":   scope.ProjectCodes,
		"periodMonth":    nullableText(scope.PeriodMonth),
		"scopeQualified": len(scope.ContractCodes) > 0 || len(scope.ProjectCodes) > 0,
		"summary": map[string]any{
			"invoiceAmount":                       fmt.Sprintf("%.2f", invoiceAmount),
			"invoiceCount":                        amountFromMap(invoiceSummary, "invoice_count"),
			"receivedAmount":                      fmt.Sprintf("%.2f", receivedAmount),
			"receiptCount":                        amountFromMap(receiptSummary, "receipt_count"),
			"maintenanceClassifiedReceivedAmount": fmt.Sprintf("%.2f", amountFromMap(receiptSummary, "maintenance_classified_received_amount")),
			"reconciledAmount":                    fmt.Sprintf("%.2f", reconciledAmount),
			"reconciliationCount":                 amountFromMap(reconciliationSummary, "reconciliation_count"),
			"unreconciledAmount":                  fmt.Sprintf("%.2f", receivedAmount-reconciledAmount),
			"directExpenseAmount":                 fmt.Sprintf("%.2f", directExpenseAmount),
			"laborCostAmount":                     fmt.Sprintf("%.2f", laborCostAmount),
			"allocatedCostAmount":                 fmt.Sprintf("%.2f", allocatedCostAmount),
			"serviceCostAmount":                   fmt.Sprintf("%.2f", serviceCostAmount),
			"grossProfitAmount":                   grossProfitAmount,
			"grossMarginRate":                     grossMarginRate,
			"costReadinessStatus":                 costReadinessStatus,
			"notReadyProjectCount":                notReadyProjectCount,
			"projectCount":                        projectCount,
			"latestInvoiceDate":                   invoiceSummary["latest_invoice_date"],
			"latestReceivedAt":                    receiptSummary["latest_received_at"],
			"latestReconciledAt":                  reconciliationSummary["latest_reconciled_at"],
		},
		"periods":     periodRows,
		"allocations": allocationRows,
	}}, nil
}

func maintenanceFinancialScopeFromQuery(customerCode string, query url.Values) (maintenanceFinancialScope, error) {
	customerCode = strings.TrimSpace(customerCode)
	if customerCode == "" {
		return maintenanceFinancialScope{}, httperror.New(http.StatusBadRequest, "customer_code_required", "customerCode is required")
	}
	periodMonth := strings.TrimSpace(firstNonEmpty(query.Get("periodMonth"), query.Get("period_month")))
	if periodMonth != "" {
		normalized, err := periodMonthValue(periodMonth)
		if err != nil {
			return maintenanceFinancialScope{}, err
		}
		periodMonth = normalized
	}
	projectCodes, authorizedProjectCodes, projectScoped := maintenanceProjectCodesFromQuery(query)
	scope := maintenanceFinancialScope{
		CustomerCode:           customerCode,
		ContractCodes:          parseCodes(firstNonEmpty(query.Get("contractCodes"), query.Get("contract_codes"), query.Get("contract_code"))),
		ProjectCodes:           projectCodes,
		AuthorizedProjectCodes: authorizedProjectCodes,
		ProjectScoped:          projectScoped,
		PeriodMonth:            periodMonth,
	}
	if len(scope.ContractCodes) == 0 && len(scope.ProjectCodes) == 0 && !scope.ProjectScoped {
		return maintenanceFinancialScope{}, httperror.New(http.StatusBadRequest, "maintenance_scope_required", "at least one maintenance contract or project code is required")
	}
	return scope, nil
}

func maintenanceProjectCodesFromQuery(query url.Values) ([]string, []string, bool) {
	requested := projectFinanceRequestedProjectCodesFromQuery(query)
	switch projectFinanceAccessFromQuery(query) {
	case "", "all":
		return requested, nil, false
	case "projects":
		allowed := projectFinanceCodesFromQuery(query)
		if len(requested) == 0 {
			return allowed, allowed, true
		}
		return intersectProjectFinanceCodes(requested, allowed), allowed, true
	default:
		return nil, nil, true
	}
}

func maintenanceFinanceWhere(scope maintenanceFinancialScope, customerColumn string, contractColumn string, projectColumn string, periodExpr string) string {
	parts := []string{customerColumn + " = ?"}
	businessScope := make([]string, 0, 2)
	if len(scope.ContractCodes) > 0 {
		businessScope = append(businessScope, contractColumn+" IN ("+placeholders(len(scope.ContractCodes))+")")
	}
	if len(scope.ProjectCodes) > 0 {
		businessScope = append(businessScope, projectColumn+" IN ("+placeholders(len(scope.ProjectCodes))+")")
	}
	if len(businessScope) == 0 {
		parts = append(parts, "1 = 0")
	} else {
		parts = append(parts, "("+strings.Join(businessScope, " OR ")+")")
	}
	if scope.ProjectScoped {
		if len(scope.AuthorizedProjectCodes) == 0 {
			parts = append(parts, "1 = 0")
		} else {
			parts = append(parts, projectColumn+" IN ("+placeholders(len(scope.AuthorizedProjectCodes))+")")
		}
	}
	if scope.PeriodMonth != "" {
		parts = append(parts, periodExpr+" = ?")
	}
	return strings.Join(parts, " AND ")
}

func maintenanceFinanceArgs(scope maintenanceFinancialScope, include ...string) []any {
	args := make([]any, 0, 1+len(scope.ContractCodes)+len(scope.ProjectCodes)+1)
	for _, item := range include {
		switch item {
		case "customer":
			args = append(args, scope.CustomerCode)
		case "contract":
			for _, code := range scope.ContractCodes {
				args = append(args, code)
			}
		case "project":
			for _, code := range scope.ProjectCodes {
				args = append(args, code)
			}
		case "authorized_project":
			if scope.ProjectScoped {
				for _, code := range scope.AuthorizedProjectCodes {
					args = append(args, code)
				}
			}
		case "period":
			if scope.PeriodMonth != "" {
				args = append(args, scope.PeriodMonth)
			}
		}
	}
	return args
}

func maintenanceProjectSummaryWhere(scope maintenanceFinancialScope) (string, []any) {
	parts := []string{"customer_code = ?"}
	args := []any{scope.CustomerCode}
	businessScope := make([]string, 0, 2)
	if len(scope.ContractCodes) > 0 {
		businessScope = append(businessScope, "contract_code IN ("+placeholders(len(scope.ContractCodes))+")")
		for _, code := range scope.ContractCodes {
			args = append(args, code)
		}
	}
	if len(scope.ProjectCodes) > 0 {
		businessScope = append(businessScope, "project_code IN ("+placeholders(len(scope.ProjectCodes))+")")
		for _, code := range scope.ProjectCodes {
			args = append(args, code)
		}
	}
	if len(businessScope) == 0 {
		parts = append(parts, "1 = 0")
	} else {
		parts = append(parts, "("+strings.Join(businessScope, " OR ")+")")
	}
	if scope.ProjectScoped {
		if len(scope.AuthorizedProjectCodes) == 0 {
			parts = append(parts, "1 = 0")
		} else {
			parts = append(parts, "project_code IN ("+placeholders(len(scope.AuthorizedProjectCodes))+")")
			for _, code := range scope.AuthorizedProjectCodes {
				args = append(args, code)
			}
		}
	}
	if scope.PeriodMonth != "" {
		parts = append(parts, "period_month = ?")
		args = append(args, scope.PeriodMonth)
	}
	return strings.Join(parts, " AND "), args
}

func emptyMaintenanceFinancialSummary(scope maintenanceFinancialScope) DataResult[map[string]any] {
	return DataResult[map[string]any]{Data: map[string]any{
		"customerCode":   scope.CustomerCode,
		"contractCodes":  scope.ContractCodes,
		"projectCodes":   scope.ProjectCodes,
		"periodMonth":    nullableText(scope.PeriodMonth),
		"scopeQualified": true,
		"summary": map[string]any{
			"invoiceAmount":                       "0.00",
			"invoiceCount":                        0,
			"receivedAmount":                      "0.00",
			"receiptCount":                        0,
			"maintenanceClassifiedReceivedAmount": "0.00",
			"reconciledAmount":                    "0.00",
			"reconciliationCount":                 0,
			"unreconciledAmount":                  "0.00",
			"directExpenseAmount":                 "0.00",
			"laborCostAmount":                     "0.00",
			"allocatedCostAmount":                 "0.00",
			"serviceCostAmount":                   "0.00",
			"grossProfitAmount":                   nil,
			"grossMarginRate":                     nil,
			"costReadinessStatus":                 "not_ready",
			"notReadyProjectCount":                0,
			"projectCount":                        0,
			"latestInvoiceDate":                   nil,
			"latestReceivedAt":                    nil,
			"latestReconciledAt":                  nil,
		},
		"periods":     []map[string]any{},
		"allocations": []map[string]any{},
	}}
}

func maintenanceCostAllocations(ctx context.Context, a *Adapter, scope maintenanceFinancialScope) ([]map[string]any, error) {
	if len(scope.ProjectCodes) == 0 {
		return []map[string]any{}, nil
	}
	parts := []string{"project_code IN (" + placeholders(len(scope.ProjectCodes)) + ")", "status = 'active'"}
	args := make([]any, 0, len(scope.ProjectCodes)+1)
	for _, code := range scope.ProjectCodes {
		args = append(args, code)
	}
	if scope.PeriodMonth != "" {
		parts = append(parts, "period_month = ?")
		args = append(args, scope.PeriodMonth)
	}
	return queryMaps(ctx, a.db, `
		SELECT
		  project_code,
		  period_month,
		  allocation_type,
		  COALESCE(SUM(amount), 0) AS amount,
		  COUNT(*) AS allocation_count
		FROM project_cost_allocation
		WHERE `+strings.Join(parts, " AND ")+`
		GROUP BY project_code, period_month, allocation_type
		ORDER BY period_month DESC, project_code ASC, allocation_type ASC
		LIMIT 100
	`, args...)
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
