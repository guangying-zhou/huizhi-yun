package altoc

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type altocPageParams struct {
	page     int
	pageSize int
	offset   int
}

func altocNormalizeContractStatus(status any) string {
	value := strings.TrimSpace(fmt.Sprint(status))
	if status == nil || value == "<nil>" {
		return ""
	}
	switch value {
	case "rejected":
		return "draft"
	case "executing", "delivering", "accepted", "service_ended", "expired":
		return "effective"
	default:
		return value
	}
}

func altocNormalizeContractRows(items []map[string]any) {
	for _, item := range items {
		item["status"] = altocNormalizeContractStatus(item["status"])
	}
}

func (a *Adapter) listOpportunities(ctx context.Context, query url.Values) (map[string]any, error) {
	page := altocGetPageParams(query)
	where, args := opportunityWhereParts(query)
	pipelineWhere, pipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "os")
	if err != nil {
		return nil, err
	}
	where = append(where, pipelineWhere...)
	args = append(args, pipelineArgs...)
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM opportunity op
		LEFT JOIN customer cu ON cu.id = op.customer_id
		LEFT JOIN opportunity_stage os ON os.id = op.stage_id
		`+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  op.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  os.name AS stage_name,
		  os.win_rate AS stage_win_rate
		FROM opportunity op
		LEFT JOIN customer cu ON cu.id = op.customer_id
		LEFT JOIN opportunity_stage os ON os.id = op.stage_id
		`+whereSQL+`
		ORDER BY `+opportunityOrderBy(query)+`
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
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

func (a *Adapter) getOpportunity(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	where, args := altocIdentityWhere("op", identifier)
	filters := []string{where, "op.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	opp, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  op.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  os.name AS stage_name,
		  os.win_rate AS stage_win_rate
		FROM opportunity op
		LEFT JOIN customer cu ON cu.id = op.customer_id
		LEFT JOIN opportunity_stage os ON os.id = op.stage_id
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if opp == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}

	oppID := opp["id"]
	stageLogs, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  sl.*,
		  fs.name AS from_stage_name,
		  ts.name AS to_stage_name
		FROM opportunity_stage_log sl
		LEFT JOIN opportunity_stage fs ON fs.id = sl.from_stage_id
		LEFT JOIN opportunity_stage ts ON ts.id = sl.to_stage_id
		WHERE sl.opportunity_id = ?
		ORDER BY sl.changed_at DESC
	`, oppID)
	if err != nil {
		return nil, err
	}
	activities, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM sales_activity
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
		ORDER BY activity_at DESC
		LIMIT 20
	`, oppID)
	if err != nil {
		return nil, err
	}
	quotations, err := altocQueryMaps(ctx, a.DB(), `
		SELECT id, code, quotation_no, version_no, status, amount_tax_inclusive, valid_until, created_at
		FROM quotation
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
		ORDER BY created_at DESC
	`, oppID)
	if err != nil {
		return nil, err
	}
	contactRoles := []map[string]any{}
	if exists, err := altocTableExists(ctx, a.DB(), "opportunity_contact_role"); err != nil {
		return nil, err
	} else if exists {
		contactRoles, err = altocQueryMaps(ctx, a.DB(), `
			SELECT
			  ocr.*,
			  ct.name AS contact_name,
			  ct.mobile AS contact_mobile,
			  ct.email AS contact_email,
			  ct.job_title AS contact_job_title,
			  ct.dept_name AS contact_dept_name
			FROM opportunity_contact_role ocr
			LEFT JOIN contact ct ON ct.id = ocr.contact_id
			WHERE ocr.opportunity_id = ?
			  AND ocr.deleted_at IS NULL
			ORDER BY ocr.is_primary DESC, ocr.id ASC
		`, oppID)
		if err != nil {
			return nil, err
		}
	}

	opp["stage_logs"] = stageLogs
	opp["activities"] = activities
	opp["quotations"] = quotations
	opp["contact_roles"] = contactRoles
	return opp, nil
}

func (a *Adapter) getCustomerScoped(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	where, args := altocIdentityWhere("cu", identifier)
	filters := []string{where, "cu.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "customer", "cu", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)

	customer, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT cu.*
		FROM customer cu
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "customer not found")
	}

	stats, err := a.customerBusinessStats(ctx, customer["id"], query)
	if err != nil {
		return nil, err
	}
	customer["stats"] = stats
	return customer, nil
}

func (a *Adapter) customerBusinessStats(ctx context.Context, customerID any, query url.Values) (map[string]any, error) {
	opportunityWhere := []string{"op.customer_id = ?", "op.deleted_at IS NULL"}
	opportunityArgs := []any{customerID}
	opportunityScopeWhere, opportunityScopeArgs, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	opportunityWhere = append(opportunityWhere, opportunityScopeWhere...)
	opportunityArgs = append(opportunityArgs, opportunityScopeArgs...)
	opportunityStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COALESCE(SUM(CASE WHEN op.status = 'active' THEN 1 ELSE 0 END), 0) AS opportunity_active,
		  COALESCE(SUM(CASE WHEN op.status = 'won' THEN COALESCE(op.amount_tax_inclusive, 0) ELSE 0 END), 0) AS opportunity_won_amount
		FROM opportunity op
		WHERE `+strings.Join(opportunityWhere, " AND "),
		opportunityArgs...,
	)
	if err != nil {
		return nil, err
	}

	contractWhere := []string{"ct.customer_id = ?", "ct.deleted_at IS NULL"}
	contractArgs := []any{customerID}
	contractScopeWhere, contractScopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	contractWhere = append(contractWhere, contractScopeWhere...)
	contractArgs = append(contractArgs, contractScopeArgs...)
	contracts, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  ct.code,
		  ct.amount_tax_inclusive
		FROM contract ct
		WHERE `+strings.Join(contractWhere, " AND "),
		contractArgs...,
	)
	if err != nil {
		return nil, err
	}

	summaries, err := a.financeSummariesByContract(ctx, contractCodesFromRows(contracts))
	if err != nil {
		return nil, err
	}
	return customerBusinessStatsFromRows(opportunityStats, contracts, summaries), nil
}

func customerBusinessStatsFromRows(opportunityStats map[string]any, contracts []map[string]any, summaries map[string]finance.ContractSummary) map[string]any {
	if opportunityStats == nil {
		opportunityStats = map[string]any{}
	}
	if summaries == nil {
		summaries = map[string]finance.ContractSummary{}
	}
	contractAmount := 0.0
	totalReceived := 0.0
	for _, contract := range contracts {
		contractAmount += moneyValue(contract["amount_tax_inclusive"])
		code := strings.TrimSpace(fmt.Sprint(contract["code"]))
		if code == "" || code == "<nil>" {
			continue
		}
		totalReceived += contractFinanceReceivedAmount(summaries[code])
	}
	return map[string]any{
		"opportunity_active":     numberValue(opportunityStats["opportunity_active"], 0),
		"opportunity_won_amount": moneyText(moneyValue(opportunityStats["opportunity_won_amount"])),
		"contract_count":         len(contracts),
		"contract_amount":        moneyText(contractAmount),
		"total_received":         moneyText(totalReceived),
	}
}

func (a *Adapter) listContracts(ctx context.Context, query url.Values) (map[string]any, error) {
	page := altocGetPageParams(query)
	contractColumns, err := altocTableColumns(ctx, a.DB(), "contract")
	if err != nil {
		return nil, err
	}
	where, args := contractWhereParts(query, contractColumns)
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	items, err := altocQueryMaps(ctx, a.DB(), contractListSQL(whereSQL, contractOrderBy(query), contractColumns["is_master_contract"]), args...)
	if err != nil {
		return nil, err
	}
	altocNormalizeContractRows(items)
	if err := a.enrichContractRowsWithFinance(ctx, items); err != nil {
		return nil, err
	}
	items = filterContractRowsByMetrics(items, query)
	sortContractRows(items, query)
	total := int64(len(items))
	summary := summarizeContractRows(items, total)
	pagedItems := paginateContractRows(items, page)

	return map[string]any{
		"items":    pagedItems,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
		"summary":  summary,
	}, nil
}

func (a *Adapter) getContractScoped(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	where, args := altocIdentityWhere("ct", identifier)
	filters := []string{where, "ct.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	return a.getContractWithFilters(ctx, filters, args)
}

func (a *Adapter) getContract(ctx context.Context, identifier string) (map[string]any, error) {
	where, args := altocIdentityWhere("ct", identifier)
	return a.getContractWithFilters(ctx, []string{where, "ct.deleted_at IS NULL"}, args)
}

func (a *Adapter) getContractWithFilters(ctx context.Context, filters []string, args []any) (map[string]any, error) {
	contract, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  op.code AS opportunity_code,
		  op.name AS opportunity_name,
		  q.code AS quotation_code,
		  pc.code AS parent_contract_code,
		  pc.name AS parent_contract_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		LEFT JOIN opportunity op ON op.id = ct.opportunity_id
		LEFT JOIN quotation q ON q.id = ct.quotation_id
		LEFT JOIN contract pc ON pc.id = ct.parent_contract_id
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if _, ok := contract["is_master_contract"]; !ok {
		contract["is_master_contract"] = boolInt(altocPositiveID(contract["parent_contract_id"]) <= 0)
	}
	contract["raw_status"] = contract["status"]
	contract["status"] = altocNormalizeContractStatus(contract["status"])

	contractID := contract["id"]
	paymentTerms, err := a.contractPaymentTerms(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	lines, err := a.contractLines(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	obligations, err := a.contractObligations(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	billingSchedules, err := a.contractBillingSchedules(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	projectLinks, err := a.contractProjectLinks(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	deliveryAssetPlans, err := a.contractDeliveryAssetPlans(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	serviceAgreements, err := a.contractServiceAgreements(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	activationJobs, err := a.contractActivationJobs(ctx, a.DB(), contractID, 5)
	if err != nil {
		return nil, err
	}
	receivablePlans, err := a.contractReceivablePlans(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	parentContract, childContracts, err := a.contractRelations(ctx, a.DB(), contract)
	if err != nil {
		return nil, err
	}
	paymentRecords, err := a.financeReceiptsForContract(ctx, strings.TrimSpace(fmt.Sprint(contract["code"])))
	if err != nil {
		return nil, err
	}
	stats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS plan_count,
		  COALESCE(SUM(rp.amount), 0) AS plan_total,
		  COALESCE(SUM(rp.received_amount), 0) AS plan_received_total,
		  COALESCE(SUM(rp.unreceived_amount), 0) AS plan_unreceived_total
		FROM receivable_plan rp
		WHERE rp.contract_id = ?
		  AND rp.deleted_at IS NULL
	`, contractID)
	if err != nil {
		return nil, err
	}
	if stats == nil {
		stats = map[string]any{}
	}
	financeSummary, err := a.financeSummaryForContract(ctx, strings.TrimSpace(fmt.Sprint(contract["code"])))
	if err != nil {
		return nil, err
	}
	financeReceived := contractFinanceReceivedAmount(financeSummary)
	stats["received_total"] = moneyText(financeReceived)
	stats["finance_received_total"] = moneyText(financeReceived)
	stats["finance_receipt_count"] = financeSummary.ReceiptCount
	contract["finance_summary"] = map[string]any{
		"invoice_amount":     financeSummary.InvoiceAmount,
		"invoice_count":      financeSummary.InvoiceCount,
		"received_amount":    moneyText(financeReceived),
		"receipt_count":      financeSummary.ReceiptCount,
		"latest_received_at": financeSummary.LatestReceivedAt,
	}

	contract["lines"] = lines
	contract["line_summary"] = contractLineSummary(lines, contract["amount_tax_inclusive"])
	contract["obligations"] = obligations
	contract["obligation_summary"] = contractObligationSummary(obligations)
	contract["billing_schedules"] = billingSchedules
	contract["billing_schedule_summary"] = contractBillingScheduleSummary(billingSchedules, contract["amount_tax_inclusive"])
	contract["project_links"] = projectLinks
	contract["delivery_asset_plans"] = deliveryAssetPlans
	contract["service_agreements"] = serviceAgreements
	contract["activation_jobs"] = activationJobs
	if len(activationJobs) > 0 {
		contract["latest_activation_job"] = activationJobs[0]
	}
	contract["parent_contract"] = parentContract
	contract["child_contracts"] = childContracts
	contract["child_contract_count"] = len(childContracts)
	contract["payment_terms"] = paymentTerms
	contract["receivable_plans"] = receivablePlans
	contract["payment_records"] = paymentRecords
	contract["stats"] = stats
	return contract, nil
}

func (a *Adapter) contractRelations(ctx context.Context, conn altocQueryer, contract map[string]any) (map[string]any, []map[string]any, error) {
	var parent map[string]any
	parentID := altocPositiveID(contract["parent_contract_id"])
	if parentID > 0 {
		found, err := altocQueryOneMap(ctx, conn, `
			SELECT id, code, name, status, legal_status, agreement_form, amount_tax_inclusive, effective_date, end_date
			FROM contract
			WHERE id = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, parentID)
		if err != nil {
			return nil, nil, err
		}
		if found != nil {
			found["status"] = altocNormalizeContractStatus(found["status"])
			parent = found
		}
	}

	children, err := altocQueryMaps(ctx, conn, `
		SELECT id, code, name, status, legal_status, agreement_form, amount_tax_inclusive, effective_date, end_date
		FROM contract
		WHERE parent_contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY created_at DESC, id DESC
	`, contract["id"])
	if err != nil {
		return nil, nil, err
	}
	altocNormalizeContractRows(children)
	return parent, children, nil
}

func (a *Adapter) listReceivablePlans(ctx context.Context, query url.Values) (map[string]any, error) {
	page := altocGetPageParams(query)
	where, args := receivablePlanWhereParts(query)
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM receivable_plan rp
		LEFT JOIN customer cu ON cu.id = rp.customer_id
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		`+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  rp.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  ct.code AS contract_code,
		  ct.name AS contract_name
		FROM receivable_plan rp
		LEFT JOIN customer cu ON cu.id = rp.customer_id
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		`+whereSQL+`
		ORDER BY `+receivablePlanOrderBy(query)+`
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
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

func (a *Adapter) getReceivablePlanScoped(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	where, args := altocIdentityWhere("rp", identifier)
	filters := []string{where, "rp.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	return a.getReceivablePlanWithFilters(ctx, filters, args)
}

func (a *Adapter) getReceivablePlan(ctx context.Context, identifier string) (map[string]any, error) {
	where, args := altocIdentityWhere("rp", identifier)
	return a.getReceivablePlanWithFilters(ctx, []string{where, "rp.deleted_at IS NULL"}, args)
}

func (a *Adapter) getReceivablePlanWithFilters(ctx context.Context, filters []string, args []any) (map[string]any, error) {
	plan, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  rp.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  ct.code AS contract_code,
		  ct.name AS contract_name
		FROM receivable_plan rp
		LEFT JOIN customer cu ON cu.id = rp.customer_id
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}

	invoices, err := a.financeInvoicesForReceivablePlan(ctx, plan)
	if err != nil {
		return nil, err
	}
	payments, err := a.financeReceiptsForReceivablePlan(ctx, plan)
	if err != nil {
		return nil, err
	}

	plan["invoices"] = invoices
	plan["payments"] = payments
	return plan, nil
}

func (a *Adapter) listContractInvoices(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	where, args := altocIdentityWhere("ct", identifier)
	filters := []string{where, "ct.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	contract, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT id, code, amount_tax_inclusive
		FROM contract ct
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}

	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return nil, err
	}
	contractCode := strings.TrimSpace(fmt.Sprint(contract["code"]))
	invoiceQuery := cloneValues(query)
	invoiceQuery.Set("contract_code", contractCode)
	if strings.TrimSpace(invoiceQuery.Get("pageSize")) == "" && strings.TrimSpace(invoiceQuery.Get("page_size")) == "" {
		invoiceQuery.Set("pageSize", "100")
	}
	invoices, err := financeSvc.Invoices(ctx, invoiceQuery)
	if err != nil {
		return nil, err
	}
	summary, err := financeSvc.ContractSummary(ctx, contractCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    invoices.Data,
		"total":    invoices.Total,
		"page":     invoices.Page,
		"pageSize": invoices.PageSize,
		"summary":  summary.Data,
	}, nil
}

func (a *Adapter) financeInvoicesForReceivablePlan(ctx context.Context, plan map[string]any) ([]map[string]any, error) {
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("receivable_plan_code", strings.TrimSpace(fmt.Sprint(plan["code"])))
	query.Set("pageSize", "100")
	invoices, err := financeSvc.Invoices(ctx, query)
	if err != nil {
		return nil, err
	}
	return invoices.Data, nil
}

func (a *Adapter) financeReceiptsForContract(ctx context.Context, contractCode string) ([]map[string]any, error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return []map[string]any{}, nil
	}
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("contract_code", contractCode)
	query.Set("pageSize", "100")
	receipts, err := financeSvc.Receipts(ctx, query)
	if err != nil {
		return nil, err
	}
	return receipts.Data, nil
}

func (a *Adapter) financeReceiptsForReceivablePlan(ctx context.Context, plan map[string]any) ([]map[string]any, error) {
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("receivable_plan_code", strings.TrimSpace(fmt.Sprint(plan["code"])))
	query.Set("pageSize", "100")
	receipts, err := financeSvc.Receipts(ctx, query)
	if err != nil {
		return nil, err
	}
	return receipts.Data, nil
}

func (a *Adapter) enrichContractRowsWithFinance(ctx context.Context, rows []map[string]any) error {
	summaries, err := a.financeSummariesByContract(ctx, contractCodesFromRows(rows))
	if err != nil {
		return err
	}
	for _, row := range rows {
		contractCode := strings.TrimSpace(fmt.Sprint(row["code"]))
		summary := summaries[contractCode]
		invoiceTotal := moneyValue(summary.InvoiceAmount)
		contractAmount := moneyValue(row["amount_tax_inclusive"])
		receivedAmount := contractFinanceReceivedAmount(summary)
		planTotal := moneyValue(row["plan_total"])
		planCount := numberValue(row["plan_count"], 0)
		receivableBase := invoiceTotal
		if planCount > 0 {
			receivableBase = planTotal
		}

		row["received_amount"] = moneyText(receivedAmount)
		row["unreceived_amount"] = moneyText(math.Max(contractAmount-receivedAmount, 0))
		row["invoice_amount"] = moneyText(invoiceTotal)
		row["invoice_balance"] = moneyText(math.Max(contractAmount-invoiceTotal, 0))
		row["receivable_uncollected_amount"] = moneyText(math.Max(receivableBase-receivedAmount, 0))
		row["finance_invoice_count"] = summary.InvoiceCount
		row["finance_latest_invoice_date"] = summary.LatestInvoiceDate
		row["finance_receipt_count"] = summary.ReceiptCount
		row["finance_latest_received_at"] = summary.LatestReceivedAt
	}
	return nil
}

func contractFinanceReceivedAmount(summary finance.ContractSummary) float64 {
	return math.Max(moneyValue(summary.ReceivedAmount), 0)
}

func (a *Adapter) financeSummariesByContract(ctx context.Context, codes []string) (map[string]finance.ContractSummary, error) {
	result := make(map[string]finance.ContractSummary, len(codes))
	if len(codes) == 0 {
		return result, nil
	}
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return nil, err
	}
	for start := 0; start < len(codes); start += 80 {
		end := start + 80
		if end > len(codes) {
			end = len(codes)
		}
		query := url.Values{}
		query.Set("contractCodes", strings.Join(codes[start:end], ","))
		summaries, err := financeSvc.ContractSummaries(ctx, query)
		if err != nil {
			return nil, err
		}
		for _, item := range summaries.Data {
			result[item.ContractCode] = item
		}
	}
	return result, nil
}

func (a *Adapter) financeSummaryForContract(ctx context.Context, contractCode string) (finance.ContractSummary, error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return finance.ContractSummary{InvoiceAmount: "0.00"}, nil
	}
	summaries, err := a.financeSummariesByContract(ctx, []string{contractCode})
	if err != nil {
		return finance.ContractSummary{}, err
	}
	if summary, ok := summaries[contractCode]; ok {
		return summary, nil
	}
	return finance.ContractSummary{
		ContractCode:   contractCode,
		InvoiceAmount:  "0.00",
		ReceivedAmount: "0.00",
		RiskStatus:     "normal",
	}, nil
}

func contractCodesFromRows(rows []map[string]any) []string {
	seen := make(map[string]bool, len(rows))
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		code := strings.TrimSpace(fmt.Sprint(row["code"]))
		if code == "" || code == "<nil>" || seen[code] {
			continue
		}
		seen[code] = true
		codes = append(codes, code)
	}
	return codes
}

func filterContractRowsByMetrics(rows []map[string]any, query url.Values) []map[string]any {
	if query.Get("unreceived_nonzero") != "1" &&
		query.Get("invoice_balance_nonzero") != "1" &&
		query.Get("receivable_uncollected_nonzero") != "1" {
		return rows
	}
	filtered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if query.Get("unreceived_nonzero") == "1" && !moneyPositive(moneyValue(row["unreceived_amount"])) {
			continue
		}
		if query.Get("invoice_balance_nonzero") == "1" && !moneyPositive(moneyValue(row["invoice_balance"])) {
			continue
		}
		if query.Get("receivable_uncollected_nonzero") == "1" && !moneyPositive(moneyValue(row["receivable_uncollected_amount"])) {
			continue
		}
		filtered = append(filtered, row)
	}
	return filtered
}

func sortContractRows(rows []map[string]any, query url.Values) {
	kind := contractRowSortKind(strings.TrimSpace(query.Get("sort")))
	if kind == "" || len(rows) < 2 {
		return
	}
	desc := !strings.EqualFold(strings.TrimSpace(query.Get("order")), "asc")
	sort.SliceStable(rows, func(i, j int) bool {
		cmp := compareContractRowValue(kind, rows[i], rows[j])
		if cmp == 0 {
			cmp = compareFloat(moneyValue(rows[i]["id"]), moneyValue(rows[j]["id"]))
		}
		if desc {
			return cmp > 0
		}
		return cmp < 0
	})
}

func contractRowSortKind(column string) string {
	switch column {
	case "amount_tax_inclusive", "receivable_uncollected_amount", "unreceived_amount", "invoice_balance":
		return "number:" + column
	case "sign_date", "effective_date", "end_date", "created_at", "updated_at":
		return "text:" + column
	case "code", "name", "customer_name", "status", "owner_user_id":
		return "text:" + column
	default:
		return ""
	}
}

func compareContractRowValue(kind string, left map[string]any, right map[string]any) int {
	parts := strings.SplitN(kind, ":", 2)
	if len(parts) != 2 {
		return 0
	}
	column := parts[1]
	switch parts[0] {
	case "number":
		return compareFloat(moneyValue(left[column]), moneyValue(right[column]))
	case "text":
		return strings.Compare(contractRowSortText(left[column]), contractRowSortText(right[column]))
	default:
		return 0
	}
}

func contractRowSortText(value any) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "<nil>" {
		return ""
	}
	return strings.ToLower(text)
}

func compareFloat(left float64, right float64) int {
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	default:
		return 0
	}
}

func summarizeContractRows(rows []map[string]any, total int64) map[string]any {
	summary := map[string]any{
		"contract_count":                total,
		"contract_amount":               "0.00",
		"unreceived_amount":             "0.00",
		"invoice_balance":               "0.00",
		"receivable_uncollected_amount": "0.00",
	}
	contractAmount := 0.0
	unreceivedAmount := 0.0
	invoiceBalance := 0.0
	receivableUncollected := 0.0
	for _, row := range rows {
		contractAmount += moneyValue(row["amount_tax_inclusive"])
		unreceivedAmount += moneyValue(row["unreceived_amount"])
		invoiceBalance += moneyValue(row["invoice_balance"])
		receivableUncollected += moneyValue(row["receivable_uncollected_amount"])
	}
	summary["contract_amount"] = moneyText(contractAmount)
	summary["unreceived_amount"] = moneyText(unreceivedAmount)
	summary["invoice_balance"] = moneyText(invoiceBalance)
	summary["receivable_uncollected_amount"] = moneyText(receivableUncollected)
	return summary
}

func paginateContractRows(rows []map[string]any, page altocPageParams) []map[string]any {
	if page.offset >= len(rows) {
		return []map[string]any{}
	}
	end := page.offset + page.pageSize
	if end > len(rows) {
		end = len(rows)
	}
	return rows[page.offset:end]
}

func cloneValues(values url.Values) url.Values {
	cloned := url.Values{}
	for key, items := range values {
		for _, item := range items {
			cloned.Add(key, item)
		}
	}
	return cloned
}

func (a *Adapter) updateReceivablePlan(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "receivable", "edit"); err != nil {
		return nil, err
	}
	where, args := altocIdentityWhere("rp", identifier)
	filters := []string{where, "rp.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(nil, body, "rp", "ct")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	existing, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT rp.id, rp.status, rp.amount, rp.received_amount
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}

	allowed := []string{
		"plan_name",
		"plan_type",
		"status",
		"amount",
		"planned_invoice_date",
		"planned_payment_date",
		"risk_level",
		"owner_user_id",
		"remark",
	}
	set := make([]string, 0, len(allowed)+1)
	updateArgs := make([]any, 0, len(allowed)+2)
	for _, column := range allowed {
		value, ok := body[column]
		if !ok {
			continue
		}
		set = append(set, column+" = ?")
		updateArgs = append(updateArgs, nullableBodyValue(value))
	}
	operator := firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user")
	if operator != "" {
		set = append(set, "updated_by = ?")
		updateArgs = append(updateArgs, operator)
	}
	if len(set) == 0 {
		return a.getReceivablePlan(ctx, identifier)
	}
	updateArgs = append(updateArgs, existing["id"])

	if _, err := a.DB().ExecContext(ctx, "UPDATE receivable_plan SET "+strings.Join(set, ", ")+", updated_at = CURRENT_TIMESTAMP WHERE id = ?", updateArgs...); err != nil {
		return nil, err
	}
	return a.getReceivablePlan(ctx, fmt.Sprint(existing["id"]))
}

func (a *Adapter) confirmReceivablePayment(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "receivable", "confirm"); err != nil {
		return nil, err
	}
	amount := amountForFinanceSync(body, "receivedAmount", "received_amount", "amount")
	if amount <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_received_amount", "receivedAmount must be greater than 0")
	}
	receivedAt := firstBodyText(body, "receivedAt", "received_at")
	if receivedAt == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_received_at", "receivedAt is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	where, args := altocIdentityWhere("rp", identifier)
	filters := []string{where, "rp.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(nil, body, "rp", "ct")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	plan, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  rp.*,
		  ct.code AS contract_code,
		  ct.name AS contract_name,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		LEFT JOIN customer cu ON cu.id = COALESCE(rp.customer_id, ct.customer_id)
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
		FOR UPDATE
	`, args...)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}

	operator := firstNonEmptyText(firstBodyText(body, "operatorUid", "operator_uid", "confirmedBy", "confirmed_by", "createdBy", "created_by", "current_user"), "system")
	receiptCode, err := a.createFinanceReceipt(ctx, map[string]any{
		"id":            plan["contract_id"],
		"code":          plan["contract_code"],
		"name":          plan["contract_name"],
		"customer_id":   plan["customer_id"],
		"customer_code": plan["customer_code"],
		"customer_name": plan["customer_name"],
	}, amount, receivedAt, strings.TrimSpace(fmt.Sprint(plan["code"])), "receivable_confirm", firstNonEmptyText(firstBodyText(body, "note", "remark"), "回款计划确认到账"), operator)
	if err != nil {
		return nil, err
	}

	newReceived := moneyValue(plan["received_amount"]) + amount
	planAmount := moneyValue(plan["amount"])
	newUnreceived := planAmount - newReceived
	if newUnreceived < 0 {
		newUnreceived = 0
	}
	newStatus := "partially_received"
	if planAmount > 0 && newReceived >= planAmount {
		newStatus = "received"
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan
		SET received_amount = ?,
		    unreceived_amount = ?,
		    status = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, fmt.Sprintf("%.2f", newReceived), fmt.Sprintf("%.2f", newUnreceived), newStatus, operator, plan["id"]); err != nil {
		return nil, err
	}

	oldValue, _ := json.Marshal(map[string]any{
		"status":          plan["status"],
		"received_amount": plan["received_amount"],
	})
	newValue, _ := json.Marshal(map[string]any{
		"status":          newStatus,
		"received_amount": fmt.Sprintf("%.2f", newReceived),
		"payment_amount":  fmt.Sprintf("%.2f", amount),
		"payment_code":    receiptCode,
		"payment_source":  "finance_receipt",
	})
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_log (
		  entity_type, entity_id, action, old_value, new_value, operator_id
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "receivable_plan", plan["id"], "status_change", oldValue, newValue, operator); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := a.getReceivablePlan(ctx, fmt.Sprint(plan["id"]))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"receivablePlan":    updated,
		"paymentRecordCode": receiptCode,
		"receiptCode":       receiptCode,
	}, nil
}

func opportunityWhereParts(query url.Values) ([]string, []any) {
	where := []string{"op.deleted_at IS NULL"}
	args := make([]any, 0)
	if keyword := strings.TrimSpace(firstNonEmptyText(query.Get("keyword"), query.Get("search"), query.Get("q"))); keyword != "" {
		where = append(where, `(
			op.code LIKE ? ESCAPE '\\'
			OR op.name LIKE ? ESCAPE '\\'
			OR cu.name LIKE ? ESCAPE '\\'
		)`)
		for i := 0; i < 3; i++ {
			args = append(args, altocLikeKeyword(keyword))
		}
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "op.status = ?")
		args = append(args, status)
	}
	if stageID := strings.TrimSpace(firstNonEmptyText(query.Get("stage_id"), query.Get("stageId"))); stageID != "" {
		where = append(where, "op.stage_id = ?")
		args = append(args, stageID)
	}
	if forecast := strings.TrimSpace(firstNonEmptyText(query.Get("forecast_category"), query.Get("forecastCategory"))); forecast != "" {
		where = append(where, "op.forecast_category = ?")
		args = append(args, forecast)
	}
	if owner := strings.TrimSpace(firstNonEmptyText(query.Get("owner_user_id"), query.Get("ownerUserId"))); owner != "" {
		where = append(where, "op.owner_user_id = ?")
		args = append(args, owner)
	}
	if customerID := strings.TrimSpace(firstNonEmptyText(query.Get("customer_id"), query.Get("customerId"))); customerID != "" {
		where = append(where, "op.customer_id = ?")
		args = append(args, customerID)
	}
	return where, args
}

func opportunityPipelineCodeFromQuery(query url.Values) (string, bool, error) {
	raw := firstNonEmptyText(
		query.Get("pipeline_code"),
		query.Get("pipelineCode"),
		query.Get("sales_pipeline_code"),
		query.Get("salesPipelineCode"),
	)
	if raw == "" {
		return "default", false, nil
	}
	pipelineCode, err := normalizeOpportunityPipelineCode(raw)
	return pipelineCode, true, err
}

func opportunityStagePipelineWhere(ctx context.Context, conn altocQueryer, query url.Values, stageAlias string) ([]string, []any, string, bool, error) {
	columns, err := altocTableColumns(ctx, conn, "opportunity_stage")
	if err != nil {
		return nil, nil, "", false, err
	}
	pipelineCode, _, err := opportunityPipelineCodeFromQuery(query)
	if err != nil {
		return nil, nil, "", false, err
	}
	if !columns["pipeline_code"] {
		return nil, nil, pipelineCode, false, nil
	}
	return []string{altocQualifiedColumn(stageAlias, "pipeline_code") + " = ?"}, []any{pipelineCode}, pipelineCode, true, nil
}

func contractWhereParts(query url.Values, columns map[string]bool) ([]string, []any) {
	where := []string{"ct.deleted_at IS NULL"}
	args := make([]any, 0)
	if keyword := strings.TrimSpace(firstNonEmptyText(query.Get("keyword"), query.Get("search"), query.Get("q"))); keyword != "" {
		where = append(where, `(
			ct.code LIKE ? ESCAPE '\\'
			OR ct.contract_no LIKE ? ESCAPE '\\'
			OR ct.name LIKE ? ESCAPE '\\'
			OR cu.name LIKE ? ESCAPE '\\'
		)`)
		for i := 0; i < 4; i++ {
			args = append(args, altocLikeKeyword(keyword))
		}
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		switch altocNormalizeContractStatus(status) {
		case "effective":
			where = append(where, "ct.status IN ('effective', 'executing', 'delivering', 'accepted', 'service_ended', 'expired')")
		case "draft":
			where = append(where, "ct.status IN ('draft', 'rejected')")
		default:
			where = append(where, "ct.status = ?")
			args = append(args, status)
		}
	}
	if customerID := strings.TrimSpace(firstNonEmptyText(query.Get("customer_id"), query.Get("customerId"))); customerID != "" {
		where = append(where, "ct.customer_id = ?")
		args = append(args, customerID)
	}
	if parentContractID := strings.TrimSpace(firstNonEmptyText(query.Get("parent_contract_id"), query.Get("parentContractId"))); parentContractID != "" {
		where = append(where, "ct.parent_contract_id = ?")
		args = append(args, parentContractID)
	}
	if direction := strings.TrimSpace(query.Get("direction")); direction != "" {
		where = append(where, "ct.direction = ?")
		args = append(args, direction)
	}
	if excludeID := altocPositiveID(firstNonEmptyText(query.Get("exclude_id"), query.Get("excludeId"))); excludeID > 0 {
		where = append(where, "ct.id <> ?")
		args = append(args, excludeID)
	}
	if altocBool(firstNonEmptyText(query.Get("master_only"), query.Get("masterOnly"), query.Get("is_master_contract"), query.Get("isMasterContract"))) {
		if columns["is_master_contract"] {
			where = append(where, "COALESCE(ct.is_master_contract, 0) = 1")
		} else {
			where = append(where, "ct.parent_contract_id IS NULL")
		}
	}
	if owner := strings.TrimSpace(firstNonEmptyText(query.Get("owner_user_id"), query.Get("ownerUserId"))); owner != "" {
		where = append(where, "ct.owner_user_id = ?")
		args = append(args, owner)
	}
	return where, args
}

func receivablePlanWhereParts(query url.Values) ([]string, []any) {
	where := []string{"rp.deleted_at IS NULL"}
	args := make([]any, 0)
	if keyword := strings.TrimSpace(firstNonEmptyText(query.Get("keyword"), query.Get("search"), query.Get("q"))); keyword != "" {
		where = append(where, `(
			rp.code LIKE ? ESCAPE '\\'
			OR rp.plan_name LIKE ? ESCAPE '\\'
			OR ct.code LIKE ? ESCAPE '\\'
			OR ct.name LIKE ? ESCAPE '\\'
			OR cu.name LIKE ? ESCAPE '\\'
		)`)
		for i := 0; i < 5; i++ {
			args = append(args, altocLikeKeyword(keyword))
		}
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "rp.status = ?")
		args = append(args, status)
	}
	if contractID := strings.TrimSpace(query.Get("contract_id")); contractID != "" {
		where = append(where, "rp.contract_id = ?")
		args = append(args, contractID)
	}
	if customerID := strings.TrimSpace(query.Get("customer_id")); customerID != "" {
		where = append(where, "rp.customer_id = ?")
		args = append(args, customerID)
	}
	if owner := strings.TrimSpace(query.Get("owner_user_id")); owner != "" {
		where = append(where, "rp.owner_user_id = ?")
		args = append(args, owner)
	}
	if risk := strings.TrimSpace(query.Get("risk_level")); risk != "" {
		where = append(where, "rp.risk_level = ?")
		args = append(args, risk)
	}
	if query.Get("overdue") == "1" {
		where = append(where, "rp.status = ?")
		args = append(args, "overdue")
	}
	return where, args
}

func altocReceivablePlanReadScopeWhere(query url.Values, body map[string]any, planAlias string, contractAlias string) ([]string, []any, error) {
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	if altocDataAccessMode(scopeBody) == "none" {
		return nil, nil, altocDataAccessForbidden()
	}
	if altocDataAccessMode(scopeBody) == "all" ||
		altocActorHasAdminScope(scopeBody, "receivable") ||
		altocActorHasAdminScope(scopeBody, "payment") ||
		altocActorHasAdminScope(scopeBody, "receivable_plan") ||
		altocActorHasAdminScope(scopeBody, "contract") {
		return nil, nil, nil
	}
	actor := firstBodyText(scopeBody, "current_user", "currentUser", "operator_uid", "operatorUid")
	if actor == "" {
		return nil, nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	clauses := make([]string, 0, 3)
	args := make([]any, 0, 4)
	if strings.TrimSpace(planAlias) != "" {
		clauses = append(clauses, altocQualifiedColumn(planAlias, "owner_user_id")+" = ?")
		args = append(args, actor)
	}
	if strings.TrimSpace(contractAlias) != "" {
		clauses = append(clauses, altocQualifiedColumn(contractAlias, "owner_user_id")+" = ?")
		args = append(args, actor)
		deptCodes := altocScopedDeptCodes(scopeBody)
		if len(deptCodes) > 0 {
			clauses = append(clauses, altocQualifiedColumn(contractAlias, "owner_dept_code")+" IN ("+altocPlaceholders(len(deptCodes))+")")
			for _, deptCode := range deptCodes {
				args = append(args, deptCode)
			}
		}
	}
	if len(clauses) == 0 {
		return []string{"1 = 0"}, nil, nil
	}
	return []string{"(" + strings.Join(clauses, " OR ") + ")"}, args, nil
}

func opportunityOrderBy(query url.Values) string {
	sortColumn := strings.TrimSpace(query.Get("sort"))
	order := altocSortDirection(query)
	switch sortColumn {
	case "name":
		return "op.name " + order + ", op.id " + order
	case "amount", "amount_tax_inclusive":
		return "op.amount_tax_inclusive " + order + ", op.id " + order
	case "expected_sign_date":
		return "op.expected_sign_date " + order + ", op.id " + order
	case "created_at":
		return "op.created_at " + order + ", op.id " + order
	case "stage_id":
		return "op.stage_id " + order + ", op.id " + order
	default:
		return "op.updated_at " + order + ", op.id " + order
	}
}

func contractListSQL(whereSQL string, orderBy string, hasMasterContractColumn bool) string {
	masterContractSelect := "CASE WHEN ct.parent_contract_id IS NULL THEN 1 ELSE 0 END AS is_master_contract"
	if hasMasterContractColumn {
		masterContractSelect = "COALESCE(ct.is_master_contract, 0) AS is_master_contract"
	}
	return `
		SELECT
		  ct.id,
		  ct.code,
		  ct.contract_no,
		  ct.name,
		  ct.customer_id,
		  ct.parent_contract_id,
		  ` + masterContractSelect + `,
		  ct.opportunity_id,
		  ct.quotation_id,
		  ct.status,
		  ct.direction,
		  ct.primary_type,
		  ct.agreement_form,
		  ct.template_code,
		  ct.sign_date,
		  ct.effective_date,
		  ct.end_date,
		  ct.amount_tax_inclusive,
		  ct.amount_tax_exclusive,
		  0 AS received_amount,
		  COALESCE(rps.plan_count, 0) AS plan_count,
		  COALESCE(rps.plan_total, 0) AS plan_total,
		  0 AS invoice_amount,
		  GREATEST(COALESCE(ct.amount_tax_inclusive, 0), 0) AS unreceived_amount,
		  0 AS receivable_uncollected_amount,
		  GREATEST(COALESCE(ct.amount_tax_inclusive, 0), 0) AS invoice_balance,
		  ct.gross_margin_rate,
		  ct.currency_code,
		  ct.payment_term_summary,
		  ct.retention_rate,
		  ct.owner_user_id,
		  ct.created_at,
		  ct.updated_at,
		  cu.name AS customer_name,
		  op.name AS opportunity_name,
		  pct.code AS parent_contract_code,
		  pct.name AS parent_contract_name,
		  COALESCE(scan.contract_scan_count, 0) AS contract_scan_count,
		  scan.contract_scan_document_id,
		  scan.contract_scan_url,
		  scan.contract_scan_title
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		LEFT JOIN opportunity op ON op.id = ct.opportunity_id
		LEFT JOIN contract pct ON pct.id = ct.parent_contract_id
		LEFT JOIN (
		  SELECT contract_id, COUNT(*) AS plan_count, SUM(COALESCE(amount, 0)) AS plan_total
		  FROM receivable_plan
		  WHERE deleted_at IS NULL
		  GROUP BY contract_id
		) rps ON rps.contract_id = ct.id
		LEFT JOIN (
		  SELECT
		    entity_id,
		    COUNT(*) AS contract_scan_count,
		    SUBSTRING_INDEX(GROUP_CONCAT(CAST(id AS CHAR) ORDER BY created_at DESC, id DESC SEPARATOR '\n'), '\n', 1) AS contract_scan_document_id,
		    SUBSTRING_INDEX(GROUP_CONCAT(external_url ORDER BY created_at DESC, id DESC SEPARATOR '\n'), '\n', 1) AS contract_scan_url,
		    SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(document_title, '合同扫描件') ORDER BY created_at DESC, id DESC SEPARATOR '\n'), '\n', 1) AS contract_scan_title
		  FROM document_link
		  WHERE entity_type = 'contract'
		    AND source_type = 'external_url'
		    AND link_type IN ('legacy_contract_scan', 'contract_scan')
		    AND external_url IS NOT NULL
		    AND TRIM(external_url) <> ''
		    AND (
		      external_mime_type = 'application/pdf'
		      OR LOWER(external_url) LIKE '%.pdf%'
		    )
		  GROUP BY entity_id
		) scan ON scan.entity_id = ct.id
		` + whereSQL + `
		ORDER BY ` + orderBy + `
	`
}

func contractOrderBy(query url.Values) string {
	sortColumn := strings.TrimSpace(query.Get("sort"))
	order := altocSortDirection(query)
	switch sortColumn {
	case "sign_date":
		return "ct.sign_date " + order + ", ct.id " + order
	case "effective_date":
		return "ct.effective_date " + order + ", ct.id " + order
	case "end_date":
		return "ct.end_date " + order + ", ct.id " + order
	case "amount_tax_inclusive":
		return "ct.amount_tax_inclusive " + order + ", ct.id " + order
	case "created_at":
		return "ct.created_at " + order + ", ct.id " + order
	default:
		return "ct.updated_at " + order + ", ct.id " + order
	}
}

func receivablePlanOrderBy(query url.Values) string {
	sortColumn := strings.TrimSpace(query.Get("sort"))
	order := altocSortDirection(query)
	switch sortColumn {
	case "planned_payment_date":
		return "rp.planned_payment_date " + order + ", rp.id " + order
	case "planned_invoice_date":
		return "rp.planned_invoice_date " + order + ", rp.id " + order
	case "amount":
		return "rp.amount " + order + ", rp.id " + order
	case "created_at":
		return "rp.created_at " + order + ", rp.id " + order
	default:
		return "rp.updated_at " + order + ", rp.id " + order
	}
}

func altocSortDirection(query url.Values) string {
	if strings.EqualFold(strings.TrimSpace(query.Get("order")), "asc") {
		return "ASC"
	}
	return "DESC"
}

func altocIdentityWhere(alias string, identifier string) (string, []any) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return "1 = 0", nil
	}
	if _, err := strconv.ParseInt(identifier, 10, 64); err == nil {
		return alias + ".id = ?", []any{identifier}
	}
	return alias + ".code = ?", []any{identifier}
}

func altocGetPageParams(query url.Values) altocPageParams {
	page := clampInt(altocPositiveInt(query.Get("page"), 1), 1, 100000)
	pageSize := clampInt(altocPositiveInt(firstNonEmptyText(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20), 1, 100)
	return altocPageParams{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func altocPositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func altocLikeKeyword(keyword string) string {
	keyword = strings.ReplaceAll(keyword, `\`, `\\`)
	keyword = strings.ReplaceAll(keyword, `%`, `\%`)
	keyword = strings.ReplaceAll(keyword, `_`, `\_`)
	return "%" + keyword + "%"
}

func nullableBodyValue(value any) any {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
		return nil
	}
	return value
}
