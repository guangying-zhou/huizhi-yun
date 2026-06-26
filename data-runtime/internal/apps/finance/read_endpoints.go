package finance

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type BalanceChangeRow struct {
	BalanceDate          string `json:"balance_date"`
	PreviousTotalBalance string `json:"previous_total_balance"`
	ChangeAmount         string `json:"change_amount"`
	TotalBalance         string `json:"total_balance"`
	Direction            string `json:"direction"`
}

type BalanceChangeSnapshot struct {
	BankAccountID int64
	SnapshotDate  string
	BalanceAmount string
}

type BalanceChangeSummary struct {
	OpeningBalance string `json:"opening_balance"`
	ClosingBalance string `json:"closing_balance"`
	NetChange      string `json:"net_change"`
}

type BalanceChangeResult struct {
	Data     []BalanceChangeRow   `json:"data"`
	Chart    []BalanceChangeRow   `json:"chartData"`
	Range    string               `json:"range"`
	Summary  BalanceChangeSummary `json:"summary"`
	Total    int                  `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
}

type ProjectFinanceDetail struct {
	ProjectCode   string           `json:"projectCode"`
	Periods       []map[string]any `json:"periods"`
	Totals        ProjectTotals    `json:"totals"`
	Allocations   []map[string]any `json:"allocations"`
	EmployeeCosts []map[string]any `json:"employeeCosts"`
	Contributions []map[string]any `json:"contributions"`
}

type ProjectTotals struct {
	ContractAmount      string `json:"contractAmount"`
	InvoiceAmount       string `json:"invoiceAmount"`
	ReceivedAmount      string `json:"receivedAmount"`
	DirectExpenseAmount string `json:"directExpenseAmount"`
	LaborCostAmount     string `json:"laborCostAmount"`
	AllocatedCostAmount string `json:"allocatedCostAmount"`
	GrossProfitAmount   string `json:"grossProfitAmount"`
}

type MigrationStatus struct {
	SourceSystem string           `json:"sourceSystem"`
	Batches      []MigrationBatch `json:"batches"`
}

type MigrationBatch struct {
	BatchCode        string  `json:"batchCode"`
	SourceTable      string  `json:"sourceTable"`
	TargetTable      string  `json:"targetTable"`
	Count            int64   `json:"count"`
	LatestMigratedAt *string `json:"latestMigratedAt"`
}

func (a *Adapter) ContractSummary(ctx context.Context, contractCode string) (DataResult[ContractSummary], error) {
	return a.ContractSummaryWithQuery(ctx, contractCode, url.Values{})
}

func (a *Adapter) ContractSummaryWithQuery(ctx context.Context, contractCode string, query url.Values) (DataResult[ContractSummary], error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return DataResult[ContractSummary]{}, httperror.New(http.StatusBadRequest, "contract_code_required", "contractCode is required")
	}
	scopedQuery := cloneQueryValues(query)
	scopedQuery.Set("contractCodes", contractCode)
	result, err := a.ContractSummaries(ctx, scopedQuery)
	if err != nil {
		return DataResult[ContractSummary]{}, err
	}
	if len(result.Data) == 0 {
		return DataResult[ContractSummary]{Data: emptyContractSummary(contractCode)}, nil
	}
	return DataResult[ContractSummary]{Data: result.Data[0]}, nil
}

func (a *Adapter) Invoices(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	spec, ok := ListResourceSpecForPath("/v1/finance/invoices")
	if !ok {
		return ListResult[map[string]any]{}, httperror.New(http.StatusInternalServerError, "finance_invoices_spec_missing", "Finance invoices resource is not configured")
	}
	return a.ListResource(ctx, spec, query)
}

func (a *Adapter) Receipts(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	spec, ok := ListResourceSpecForPath("/v1/finance/receipts")
	if !ok {
		return ListResult[map[string]any]{}, httperror.New(http.StatusInternalServerError, "finance_receipts_spec_missing", "Finance receipts resource is not configured")
	}
	return a.ListResource(ctx, spec, query)
}

func (a *Adapter) BankAccountBalances(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	page := getPageParams(query)
	where := []string{"ba.deleted_at IS NULL"}
	args := make([]any, 0)

	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" {
		where = append(where, `(
			ba.code LIKE ? ESCAPE '\\'
			OR ba.account_name LIKE ? ESCAPE '\\'
			OR ba.bank_name LIKE ? ESCAPE '\\'
			OR ba.account_no_masked LIKE ? ESCAPE '\\'
			OR bs.source_type LIKE ? ESCAPE '\\'
			OR bs.created_by LIKE ? ESCAPE '\\'
		)`)
		for i := 0; i < 6; i++ {
			args = append(args, likeKeyword(keyword))
		}
	}

	if accountCode := strings.TrimSpace(query.Get("account_code")); accountCode != "" {
		where = append(where, "ba.code = ?")
		args = append(args, accountCode)
	}
	if dateFrom := strings.TrimSpace(query.Get("dateFrom")); dateFrom != "" {
		where = append(where, "bs.snapshot_date >= ?")
		args = append(args, dateFrom)
	}
	if dateTo := strings.TrimSpace(query.Get("dateTo")); dateTo != "" {
		where = append(where, "bs.snapshot_date <= ?")
		args = append(args, dateTo)
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM finance_account_balance_snapshot bs
		JOIN finance_bank_account ba ON ba.id = bs.bank_account_id
		`+whereSQL, args...).Scan(&total); err != nil {
		return ListResult[map[string]any]{}, err
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT
		  bs.id,
		  ba.code AS account_code,
		  ba.account_name,
		  ba.bank_name,
		  ba.account_no_masked,
		  bs.snapshot_date,
		  bs.balance_amount,
		  bs.currency_code,
		  bs.source_type,
		  bs.created_by,
		  bs.created_at
		FROM finance_account_balance_snapshot bs
		JOIN finance_bank_account ba ON ba.id = bs.bank_account_id
		`+whereSQL+`
		ORDER BY bs.snapshot_date DESC, bs.id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}

	return ListResult[map[string]any]{
		Data:     rows,
		Total:    total,
		Page:     page.page,
		PageSize: int64(page.pageSize),
	}, nil
}

func (a *Adapter) BankAccountBalanceSnapshots(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, httperror.New(http.StatusBadRequest, "code_required", "code is required")
	}

	page := getPageParams(query)
	balanceRange := normalizeBalanceSnapshotRange(query.Get("range"))

	var accountID int64
	if err := a.db.QueryRowContext(ctx, "SELECT id FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL", code).Scan(&accountID); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "bank_account_not_found", "bank account not found")
		}
		return nil, err
	}

	whereSQL, args := balanceSnapshotRangeWhere(balanceRange)

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM finance_account_balance_snapshot WHERE bank_account_id = ?"+whereSQL, append([]any{accountID}, args...)...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT id, snapshot_date, balance_amount, currency_code, source_type, created_by, created_at
		FROM finance_account_balance_snapshot
		WHERE bank_account_id = ?`+whereSQL+`
		ORDER BY snapshot_date DESC, id DESC
		LIMIT ? OFFSET ?
	`, append(append([]any{accountID}, args...), page.pageSize, page.offset)...)
	if err != nil {
		return nil, err
	}

	chartData, err := queryMaps(ctx, a.db, `
		SELECT id, snapshot_date, balance_amount, currency_code, source_type, created_by, created_at
		FROM finance_account_balance_snapshot
		WHERE bank_account_id = ?`+whereSQL+`
		ORDER BY snapshot_date ASC, id ASC
		LIMIT 500
	`, append([]any{accountID}, args...)...)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"data":      rows,
		"chartData": chartData,
		"range":     balanceRange,
		"total":     total,
		"page":      page.page,
		"pageSize":  page.pageSize,
	}, nil
}

func (a *Adapter) BankAccountBalanceChanges(ctx context.Context, query url.Values) (BalanceChangeResult, error) {
	balanceRange := normalizeBalanceChangeRange(query.Get("range"))
	startDate, endDate := balanceChangeWindow(balanceRange)

	rows, err := a.db.QueryContext(ctx, `
		SELECT
		  ba.id AS bank_account_id,
		  bs.snapshot_date,
		  bs.balance_amount
		FROM finance_bank_account ba
		JOIN finance_account_balance_snapshot bs ON bs.bank_account_id = ba.id
		WHERE ba.deleted_at IS NULL
		  AND bs.snapshot_date <= ?
		ORDER BY bs.snapshot_date ASC, bs.id ASC
	`, endDate)
	if err != nil {
		return BalanceChangeResult{}, err
	}
	defer rows.Close()

	snapshots := make([]BalanceChangeSnapshot, 0)
	for rows.Next() {
		var item BalanceChangeSnapshot
		if err := rows.Scan(&item.BankAccountID, &item.SnapshotDate, &item.BalanceAmount); err != nil {
			return BalanceChangeResult{}, err
		}
		snapshots = append(snapshots, item)
	}
	if err := rows.Err(); err != nil {
		return BalanceChangeResult{}, err
	}

	data := buildBalanceChanges(snapshots, startDate, endDate)
	openingBalance := calculateOpeningBalance(snapshots, startDate)
	if len(data) > 0 {
		openingBalance = data[0].PreviousTotalBalance
	}
	closingBalance := openingBalance
	if len(data) > 0 {
		closingBalance = data[len(data)-1].TotalBalance
	}
	netChange := formatAmount(parseAmount(closingBalance) - parseAmount(openingBalance))

	return BalanceChangeResult{
		Data:  data,
		Chart: data,
		Range: balanceRange,
		Summary: BalanceChangeSummary{
			OpeningBalance: openingBalance,
			ClosingBalance: closingBalance,
			NetChange:      netChange,
		},
		Total:    len(data),
		Page:     1,
		PageSize: len(data),
	}, nil
}

func (a *Adapter) MonthlyFinanceReport(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	year := normalizeYear(query.Get("year"))
	periodMonth := strings.TrimSpace(query.Get("period_month"))
	hasPeriod := periodMonth != ""
	arg := any(year)
	if hasPeriod {
		arg = periodMonth
	}
	projectCodes, projectScoped := projectFinanceReportProjectCodesFromQuery(query)
	if projectScoped && len(projectCodes) == 0 {
		return ListResult[map[string]any]{
			Data:     []map[string]any{},
			Total:    0,
			Page:     1,
			PageSize: 20,
		}, nil
	}
	args := make([]any, 0, len(projectCodes)*5+1)
	for i := 0; i < 5; i++ {
		for _, code := range projectCodes {
			args = append(args, code)
		}
	}
	args = append(args, arg)

	rows, err := queryMaps(ctx, a.db, monthlyReportSQL(hasPeriod, len(projectCodes)), args...)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}
	return ListResult[map[string]any]{
		Data:     rows,
		Total:    int64(len(rows)),
		Page:     1,
		PageSize: int64(maxInt(len(rows), 20)),
	}, nil
}

func (a *Adapter) ProjectFinanceDetail(ctx context.Context, projectCode string, query url.Values) (DataResult[ProjectFinanceDetail], error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return DataResult[ProjectFinanceDetail]{}, httperror.New(http.StatusBadRequest, "project_code_required", "projectCode is required")
	}
	if err := requireProjectFinanceQueryAccess(query, projectCode); err != nil {
		return DataResult[ProjectFinanceDetail]{}, err
	}

	periods, err := queryMaps(ctx, a.db, `
		SELECT *
		FROM project_finance_summary
		WHERE project_code = ?
		ORDER BY period_month DESC
	`, projectCode)
	if err != nil {
		return DataResult[ProjectFinanceDetail]{}, err
	}

	allocations, err := queryMaps(ctx, a.db, `
		SELECT *
		FROM project_cost_allocation
		WHERE project_code = ? AND status = 'active'
		ORDER BY period_month DESC, id DESC
		LIMIT 100
	`, projectCode)
	if err != nil {
		return DataResult[ProjectFinanceDetail]{}, err
	}

	employeeCosts, err := queryMaps(ctx, a.db, `
		SELECT cost.*
		FROM employee_cost_snapshot cost
		INNER JOIN project_cost_allocation allocation
		  ON allocation.employee_uid = cost.employee_uid
		 AND allocation.period_month = cost.period_month
		 AND allocation.status = 'active'
		WHERE allocation.project_code = ?
		ORDER BY cost.period_month DESC, cost.employee_uid ASC
		LIMIT 100
	`, projectCode)
	if err != nil {
		return DataResult[ProjectFinanceDetail]{}, err
	}

	contributions, err := queryMaps(ctx, a.db, `
		SELECT *
		FROM employee_finance_contribution
		WHERE project_code = ? AND status = 'active'
		ORDER BY period_month DESC, employee_uid ASC
		LIMIT 100
	`, projectCode)
	if err != nil {
		return DataResult[ProjectFinanceDetail]{}, err
	}

	return DataResult[ProjectFinanceDetail]{
		Data: ProjectFinanceDetail{
			ProjectCode:   projectCode,
			Periods:       periods,
			Totals:        sumProjectPeriods(periods),
			Allocations:   allocations,
			EmployeeCosts: employeeCosts,
			Contributions: contributions,
		},
	}, nil
}

func (a *Adapter) ProjectFinanceResolve(ctx context.Context, query url.Values) (DataResult[map[string]any], error) {
	periodMonth := strings.TrimSpace(firstNonEmpty(query.Get("periodMonth"), query.Get("period_month")))
	if periodMonth != "" {
		normalized, err := periodMonthValue(periodMonth)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		periodMonth = normalized
	}
	projectCodes := parseProjectFinanceResolveCodes(firstNonEmpty(
		query.Get("projectCodes"),
		query.Get("project_codes"),
		query.Get("projectCode"),
		query.Get("project_code"),
	))

	summaryWhere := make([]string, 0)
	summaryArgs := make([]any, 0)
	if periodMonth != "" {
		summaryWhere = append(summaryWhere, "period_month = ?")
		summaryArgs = append(summaryArgs, periodMonth)
	}
	if len(projectCodes) > 0 {
		summaryWhere = append(summaryWhere, "project_code IN ("+placeholders(len(projectCodes))+")")
		for _, code := range projectCodes {
			summaryArgs = append(summaryArgs, code)
		}
	}
	applyProjectFinanceProjectCodeAccess(&summaryWhere, &summaryArgs, query, "project_code")
	summaryWhereSQL := ""
	if len(summaryWhere) > 0 {
		summaryWhereSQL = "WHERE " + strings.Join(summaryWhere, " AND ")
	}
	summaries, err := queryMaps(ctx, a.db, `
		SELECT *
		FROM project_finance_summary
		`+summaryWhereSQL+`
		ORDER BY period_month DESC, project_code ASC
	`, summaryArgs...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	allocationWhere := []string{"COALESCE(status, 'active') = 'active'", "allocation_type = 'labor'"}
	allocationArgs := make([]any, 0)
	if periodMonth != "" {
		allocationWhere = append(allocationWhere, "period_month = ?")
		allocationArgs = append(allocationArgs, periodMonth)
	}
	if len(projectCodes) > 0 {
		allocationWhere = append(allocationWhere, "project_code IN ("+placeholders(len(projectCodes))+")")
		for _, code := range projectCodes {
			allocationArgs = append(allocationArgs, code)
		}
	}
	applyProjectFinanceProjectCodeAccess(&allocationWhere, &allocationArgs, query, "project_code")
	laborAllocations, err := queryMaps(ctx, a.db, `
		SELECT
		  project_code,
		  period_month,
		  allocation_type,
		  SUM(amount) AS amount,
		  COUNT(*) AS allocation_rows,
		  MAX(created_at) AS latest_created_at
		FROM project_cost_allocation
		WHERE `+strings.Join(allocationWhere, " AND ")+`
		GROUP BY project_code, period_month, allocation_type
		ORDER BY period_month DESC, project_code ASC
	`, allocationArgs...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	return DataResult[map[string]any]{Data: map[string]any{
		"periodMonth":      periodMonth,
		"projectCodes":     projectCodes,
		"summaries":        summaries,
		"laborAllocations": laborAllocations,
	}}, nil
}

func parseProjectFinanceResolveCodes(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		code := strings.TrimSpace(part)
		if code == "" || seen[code] {
			continue
		}
		seen[code] = true
		result = append(result, code)
		if len(result) >= 500 {
			break
		}
	}
	return result
}

func (a *Adapter) PerformanceAmounts(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	page := getPageParams(query)
	where := []string{"p.status <> 'canceled'"}
	args := make([]any, 0)

	if employeeUID := strings.TrimSpace(query.Get("employee_uid")); employeeUID != "" {
		where = append(where, "p.employee_uid = ?")
		args = append(args, employeeUID)
	}
	if periodMonth := strings.TrimSpace(query.Get("period_month")); periodMonth != "" {
		where = append(where, "p.period_month = ?")
		args = append(args, periodMonth)
	} else {
		if periodStart := periodMonthFromDate(query.Get("period_start")); periodStart != "" {
			where = append(where, "p.period_month >= ?")
			args = append(args, periodStart)
		}
		if periodEnd := periodMonthFromDate(query.Get("period_end")); periodEnd != "" {
			where = append(where, "p.period_month <= ?")
			args = append(args, periodEnd)
		}
	}
	if projectCode := strings.TrimSpace(query.Get("project_code")); projectCode != "" {
		where = append(where, `EXISTS (
			SELECT 1
			FROM employee_finance_contribution fc
			WHERE fc.employee_uid = p.employee_uid
			  AND fc.period_month = p.period_month
			  AND fc.project_code = ?
			  AND fc.status = 'active'
		)`)
		args = append(args, projectCode)
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM employee_finance_performance p
		`+whereSQL, args...).Scan(&total); err != nil {
		return ListResult[map[string]any]{}, err
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT
		  p.id,
		  p.code,
		  p.employee_uid,
		  p.employee_name,
		  p.dept_code,
		  p.period_month,
		  p.performance_type,
		  p.base_amount,
		  p.performance_amount,
		  p.performance_score,
		  p.status,
		  p.calculated_at,
		  p.created_at,
		  related.project_codes,
		  related.contribution_base_amount
		FROM employee_finance_performance p
		LEFT JOIN (
		  SELECT
		    employee_uid,
		    period_month,
		    GROUP_CONCAT(DISTINCT project_code ORDER BY project_code SEPARATOR ',') AS project_codes,
		    SUM(COALESCE(contribution_amount, 0) * COALESCE(contribution_ratio, 1)) AS contribution_base_amount
		  FROM employee_finance_contribution
		  WHERE status = 'active'
		  GROUP BY employee_uid, period_month
		) related ON related.employee_uid = p.employee_uid AND related.period_month = p.period_month
		`+whereSQL+`
		ORDER BY p.period_month DESC, p.employee_uid ASC, p.id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}

	cycleCode := strings.TrimSpace(query.Get("cycle_code"))
	projectCode := strings.TrimSpace(query.Get("project_code"))
	for _, row := range rows {
		if cycleCode != "" {
			row["cycle_code"] = cycleCode
		}
		if projectCode != "" {
			row["project_code_filter"] = projectCode
		}
	}

	return ListResult[map[string]any]{
		Data:     rows,
		Total:    total,
		Page:     page.page,
		PageSize: int64(page.pageSize),
	}, nil
}

func (a *Adapter) MigrationStatus(ctx context.Context) (DataResult[MigrationStatus], error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT
		  batch_code,
		  source_table,
		  target_table,
		  COUNT(*) AS count,
		  MAX(migrated_at) AS latest_migrated_at
		FROM finance_migration_map
		WHERE source_system = 'wizbizdb'
		GROUP BY batch_code, source_table, target_table
		ORDER BY latest_migrated_at DESC, batch_code DESC
	`)
	if err != nil {
		return DataResult[MigrationStatus]{}, err
	}
	defer rows.Close()

	batches := make([]MigrationBatch, 0)
	for rows.Next() {
		var item MigrationBatch
		var latest sql.NullString
		if err := rows.Scan(&item.BatchCode, &item.SourceTable, &item.TargetTable, &item.Count, &latest); err != nil {
			return DataResult[MigrationStatus]{}, err
		}
		item.LatestMigratedAt = nullableString(latest)
		batches = append(batches, item)
	}
	if err := rows.Err(); err != nil {
		return DataResult[MigrationStatus]{}, err
	}

	return DataResult[MigrationStatus]{
		Data: MigrationStatus{
			SourceSystem: "wizbizdb",
			Batches:      batches,
		},
	}, nil
}

func periodMonthFromDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 7 {
		return value[:7]
	}
	return ""
}

func emptyContractSummary(contractCode string) ContractSummary {
	return ContractSummary{
		ContractCode:     contractCode,
		InvoiceAmount:    "0.00",
		ReceivedAmount:   "0.00",
		ReconciledAmount: "0.00",
		InvoiceCount:     0,
		ReceiptCount:     0,
		RiskStatus:       "normal",
	}
}

func normalizeBalanceSnapshotRange(value string) string {
	switch strings.TrimSpace(value) {
	case "last_30_days", "current_year", "last_1_year", "all":
		return strings.TrimSpace(value)
	default:
		return "current_month"
	}
}

func balanceSnapshotRangeWhere(balanceRange string) (string, []any) {
	if balanceRange == "all" {
		return "", nil
	}

	now := time.Now().UTC()
	start := now
	switch balanceRange {
	case "current_month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "last_30_days":
		start = now.AddDate(0, 0, -29)
	case "current_year":
		start = time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	default:
		start = now.AddDate(-1, 0, 1)
	}

	return " AND snapshot_date >= ? AND snapshot_date <= ?", []any{dateOnly(start), dateOnly(now)}
}

func normalizeBalanceChangeRange(value string) string {
	switch strings.TrimSpace(value) {
	case "current_year", "current_month", "last_1_month", "last_3_months", "last_6_months":
		return strings.TrimSpace(value)
	default:
		return "current_year"
	}
}

func balanceChangeWindow(balanceRange string) (string, string) {
	now := time.Now().UTC()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	start := end
	switch balanceRange {
	case "current_year":
		start = time.Date(end.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	case "current_month":
		start = time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "last_1_month":
		start = end.AddDate(0, -1, 0)
	case "last_3_months":
		start = end.AddDate(0, -3, 0)
	case "last_6_months":
		start = end.AddDate(0, -6, 0)
	}
	return dateOnly(start), dateOnly(end)
}

func buildBalanceChanges(snapshots []BalanceChangeSnapshot, startDate string, endDate string) []BalanceChangeRow {
	balances := map[int64]float64{}
	inRangeSnapshots := map[string]map[int64]float64{}

	for _, snapshot := range snapshots {
		date := snapshotDate(snapshot.SnapshotDate)
		amount := parseAmount(snapshot.BalanceAmount)
		if date < startDate {
			balances[snapshot.BankAccountID] = amount
			continue
		}
		if date > endDate {
			continue
		}
		daily := inRangeSnapshots[date]
		if daily == nil {
			daily = map[int64]float64{}
			inRangeSnapshots[date] = daily
		}
		daily[snapshot.BankAccountID] = amount
	}

	dates := make([]string, 0, len(inRangeSnapshots))
	for date := range inRangeSnapshots {
		dates = append(dates, date)
	}
	sortStrings(dates)

	result := make([]BalanceChangeRow, 0, len(dates))
	for _, date := range dates {
		previousTotal := sumBalances(balances)
		for accountID, amount := range inRangeSnapshots[date] {
			balances[accountID] = amount
		}
		totalBalance := sumBalances(balances)
		changeAmount := totalBalance - previousTotal
		direction := "flat"
		if changeAmount > 0 {
			direction = "increase"
		} else if changeAmount < 0 {
			direction = "decrease"
		}
		result = append(result, BalanceChangeRow{
			BalanceDate:          date,
			PreviousTotalBalance: formatAmount(previousTotal),
			ChangeAmount:         formatAmount(changeAmount),
			TotalBalance:         formatAmount(totalBalance),
			Direction:            direction,
		})
	}
	return result
}

func calculateOpeningBalance(snapshots []BalanceChangeSnapshot, startDate string) string {
	balances := map[int64]float64{}
	for _, snapshot := range snapshots {
		date := snapshotDate(snapshot.SnapshotDate)
		if date >= startDate {
			continue
		}
		balances[snapshot.BankAccountID] = parseAmount(snapshot.BalanceAmount)
	}
	return formatAmount(sumBalances(balances))
}

func sumBalances(balances map[int64]float64) float64 {
	total := 0.0
	for _, amount := range balances {
		total += amount
	}
	return total
}

func sumProjectPeriods(rows []map[string]any) ProjectTotals {
	return ProjectTotals{
		ContractAmount:      formatAmount(sumAmount(rows, "contract_amount")),
		InvoiceAmount:       formatAmount(sumAmount(rows, "invoice_amount")),
		ReceivedAmount:      formatAmount(sumAmount(rows, "received_amount")),
		DirectExpenseAmount: formatAmount(sumAmount(rows, "direct_expense_amount")),
		LaborCostAmount:     formatAmount(sumAmount(rows, "labor_cost_amount")),
		AllocatedCostAmount: formatAmount(sumAmount(rows, "allocated_cost_amount")),
		GrossProfitAmount:   formatAmount(sumAmount(rows, "gross_profit_amount")),
	}
}

func sumAmount(rows []map[string]any, key string) float64 {
	total := 0.0
	for _, row := range rows {
		total += amountFromMap(row, key)
	}
	return total
}

func normalizeYear(value string) string {
	year := strings.TrimSpace(value)
	if len(year) == 4 && isDigits(year) {
		return year
	}
	return fmt.Sprintf("%04d", time.Now().UTC().Year())
}

func monthlyReportSQL(hasPeriodFilter bool, projectCodeCount int) string {
	filter := "monthly.period_month LIKE CONCAT(?, '-%')"
	if hasPeriodFilter {
		filter = "monthly.period_month = ?"
	}
	projectFilter := ""
	performanceProjectFilter := ""
	if projectCodeCount > 0 {
		projectFilter = " AND project_code IN (" + placeholders(projectCodeCount) + ")"
		performanceProjectFilter = ` AND EXISTS (
		    SELECT 1
		    FROM employee_finance_contribution fc
		    WHERE fc.employee_uid = employee_finance_performance.employee_uid
		      AND fc.period_month = employee_finance_performance.period_month
		      AND fc.status = 'active'
		      AND fc.project_code IN (` + placeholders(projectCodeCount) + `)
		  )`
	}

	return `
		SELECT
		  monthly.period_month,
		  SUM(monthly.invoice_amount) AS invoice_amount,
		  SUM(monthly.receipt_amount) AS receipt_amount,
		  SUM(monthly.expense_amount) AS expense_amount,
		  SUM(monthly.unreconciled_amount) AS unreconciled_amount,
		  SUM(monthly.project_gross_profit_amount) AS project_gross_profit_amount,
		  SUM(monthly.performance_amount) AS performance_amount,
		  SUM(monthly.receipt_amount) - SUM(monthly.expense_amount) AS net_cash_amount
		FROM (
		  SELECT DATE_FORMAT(invoice_date, '%Y-%m') AS period_month,
		         SUM(invoice_amount) AS invoice_amount,
		         0 AS receipt_amount,
		         0 AS expense_amount,
		         0 AS unreconciled_amount,
		         0 AS project_gross_profit_amount,
		         0 AS performance_amount
		  FROM finance_invoice
		  WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed')` + projectFilter + `
		  GROUP BY DATE_FORMAT(invoice_date, '%Y-%m')
		  UNION ALL
		  SELECT DATE_FORMAT(received_at, '%Y-%m') AS period_month,
		         0,
		         SUM(received_amount),
		         0,
		         SUM(COALESCE(unreconciled_amount, 0)),
		         0,
		         0
		  FROM finance_receipt
		  WHERE deleted_at IS NULL AND status <> 'canceled'` + projectFilter + `
		  GROUP BY DATE_FORMAT(received_at, '%Y-%m')
		  UNION ALL
		  SELECT DATE_FORMAT(expense_date, '%Y-%m') AS period_month,
		         0,
		         0,
		         SUM(expense_amount),
		         0,
		         0,
		         0
		  FROM finance_expense
		  WHERE deleted_at IS NULL AND status <> 'canceled'` + projectFilter + `
		  GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
		  UNION ALL
		  SELECT period_month,
		         0,
		         0,
		         0,
		         0,
		         SUM(gross_profit_amount),
		         0
		  FROM project_finance_summary
		  WHERE 1 = 1` + projectFilter + `
		  GROUP BY period_month
		  UNION ALL
		  SELECT period_month,
		         0,
		         0,
		         0,
		         0,
		         0,
		         SUM(performance_amount)
		  FROM employee_finance_performance
		  WHERE status <> 'canceled'` + performanceProjectFilter + `
		  GROUP BY period_month
		) monthly
		WHERE ` + filter + `
		GROUP BY monthly.period_month
		ORDER BY monthly.period_month DESC
	`
}

func isDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return value != ""
}

func snapshotDate(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func dateOnly(value time.Time) string {
	return value.UTC().Format("2006-01-02")
}

func parseAmount(value string) float64 {
	var parsed float64
	_, _ = fmt.Sscanf(strings.TrimSpace(value), "%f", &parsed)
	return parsed
}

func formatAmount(value float64) string {
	return fmt.Sprintf("%.2f", value)
}

func maxInt(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		current := values[i]
		j := i - 1
		for j >= 0 && values[j] > current {
			values[j+1] = values[j]
			j--
		}
		values[j+1] = current
	}
}
