package finance

import (
	"context"
	"database/sql"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
)

type Adapter struct {
	db     *sql.DB
	dbName string
}

type SchemaStatus struct {
	App           string   `json:"app"`
	Database      string   `json:"database"`
	Status        string   `json:"status"`
	CheckedTables []string `json:"checkedTables"`
	MissingTables []string `json:"missingTables"`
}

type DataResult[T any] struct {
	Data T `json:"data"`
}

type ListResult[T any] struct {
	Data     []T            `json:"data"`
	Summary  map[string]any `json:"summary,omitempty"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int64          `json:"pageSize"`
}

type DashboardSummary struct {
	MonthInvoiceAmount        string `json:"monthInvoiceAmount"`
	MonthReceiptAmount        string `json:"monthReceiptAmount"`
	PendingExpenseCount       int64  `json:"pendingExpenseCount"`
	ProjectGrossProfitAmount  string `json:"projectGrossProfitAmount"`
	UnreconciledReceiptAmount string `json:"unreconciledReceiptAmount"`
	BankAccountCount          int64  `json:"bankAccountCount"`
}

type ContractSummary struct {
	ContractCode       string  `json:"contractCode"`
	CustomerCode       *string `json:"customerCode"`
	ProjectCode        *string `json:"projectCode"`
	ContractAmount     *string `json:"contractAmount"`
	InvoiceAmount      string  `json:"invoiceAmount"`
	ReceivedAmount     string  `json:"receivedAmount"`
	ReconciledAmount   string  `json:"reconciledAmount"`
	UnreceivedAmount   *string `json:"unreceivedAmount"`
	UnreconciledAmount *string `json:"unreconciledAmount"`
	InvoiceCount       int64   `json:"invoiceCount"`
	ReceiptCount       int64   `json:"receiptCount"`
	LatestInvoiceDate  *string `json:"latestInvoiceDate"`
	LatestReceivedAt   *string `json:"latestReceivedAt"`
	RiskStatus         string  `json:"riskStatus"`
	CalculatedAt       *string `json:"calculatedAt"`
}

var requiredTables = []string{
	"finance_bank_account",
	"finance_account_balance_snapshot",
	"finance_people_cost_parameter",
	"finance_invoice",
	"finance_receipt",
	"finance_reconciliation",
	"finance_contract_summary",
	"expense_claim",
	"project_expense_request",
	"payment_request",
	"project_finance_summary",
}

func New(cfg config.FinanceConfig) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	return &Adapter{db: conn, dbName: cfg.DB.Database}, nil
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) SchemaStatus(ctx context.Context) (SchemaStatus, error) {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(requiredTables)), ",")
	args := make([]any, 0, len(requiredTables))
	for _, table := range requiredTables {
		args = append(args, table)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return SchemaStatus{}, err
	}
	defer rows.Close()

	existing := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return SchemaStatus{}, err
		}
		existing[table] = true
	}
	if err := rows.Err(); err != nil {
		return SchemaStatus{}, err
	}

	missing := make([]string, 0)
	for _, table := range requiredTables {
		if !existing[table] {
			missing = append(missing, table)
		}
	}

	status := "ok"
	if len(missing) > 0 {
		status = "schema_mismatch"
	}
	return SchemaStatus{
		App:           "finance",
		Database:      a.dbName,
		Status:        status,
		CheckedTables: requiredTables,
		MissingTables: missing,
	}, nil
}

func (a *Adapter) DashboardSummary(ctx context.Context, query url.Values) (DataResult[DashboardSummary], error) {
	projectCodes, projectScoped := projectFinanceReportProjectCodesFromQuery(query)
	if projectScoped && len(projectCodes) == 0 {
		return DataResult[DashboardSummary]{Data: DashboardSummary{
			MonthInvoiceAmount:        "0.00",
			MonthReceiptAmount:        "0.00",
			PendingExpenseCount:       0,
			ProjectGrossProfitAmount:  "0.00",
			UnreconciledReceiptAmount: "0.00",
			BankAccountCount:          0,
		}}, nil
	}

	var row struct {
		MonthInvoiceAmount        string
		MonthReceiptAmount        string
		PendingExpenseCount       int64
		ProjectGrossProfitAmount  string
		UnreconciledReceiptAmount string
		BankAccountCount          int64
	}
	err := a.db.QueryRowContext(ctx, dashboardSummarySQL(len(projectCodes), projectScoped), dashboardSummaryArgs(projectCodes)...).Scan(
		&row.MonthInvoiceAmount,
		&row.MonthReceiptAmount,
		&row.PendingExpenseCount,
		&row.ProjectGrossProfitAmount,
		&row.UnreconciledReceiptAmount,
		&row.BankAccountCount,
	)
	if err != nil {
		return DataResult[DashboardSummary]{}, err
	}
	return DataResult[DashboardSummary]{
		Data: DashboardSummary{
			MonthInvoiceAmount:        row.MonthInvoiceAmount,
			MonthReceiptAmount:        row.MonthReceiptAmount,
			PendingExpenseCount:       row.PendingExpenseCount,
			ProjectGrossProfitAmount:  row.ProjectGrossProfitAmount,
			UnreconciledReceiptAmount: row.UnreconciledReceiptAmount,
			BankAccountCount:          row.BankAccountCount,
		},
	}, nil
}

func dashboardSummaryArgs(projectCodes []string) []any {
	args := make([]any, 0, len(projectCodes)*7)
	for i := 0; i < 7; i++ {
		for _, code := range projectCodes {
			args = append(args, code)
		}
	}
	return args
}

func dashboardSummarySQL(projectCodeCount int, projectScoped bool) string {
	projectFilter := ""
	if projectCodeCount > 0 {
		projectFilter = " AND project_code IN (" + placeholders(projectCodeCount) + ")"
	}
	bankAccountCountSQL := "COALESCE((SELECT COUNT(*) FROM finance_bank_account WHERE deleted_at IS NULL AND status = 'active'), 0)"
	if projectScoped {
		bankAccountCountSQL = "0"
	}
	return `
		SELECT
		  COALESCE((SELECT SUM(invoice_amount) FROM finance_invoice WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')` + projectFilter + `), 0) AS monthInvoiceAmount,
		  COALESCE((SELECT SUM(received_amount) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND DATE_FORMAT(received_at, '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')` + projectFilter + `), 0) AS monthReceiptAmount,
		  COALESCE((SELECT COUNT(*) FROM expense_claim WHERE deleted_at IS NULL AND status = 'pending_approval'` + projectFilter + `), 0)
		    + COALESCE((SELECT COUNT(*) FROM project_expense_request WHERE deleted_at IS NULL AND status = 'pending_approval'` + projectFilter + `), 0)
		    + COALESCE((SELECT COUNT(*) FROM payment_request WHERE deleted_at IS NULL AND status = 'pending_approval'` + projectFilter + `), 0) AS pendingExpenseCount,
		  COALESCE((SELECT SUM(gross_profit_amount) FROM project_finance_summary WHERE period_month = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')` + projectFilter + `), 0) AS projectGrossProfitAmount,
		  COALESCE((SELECT SUM(COALESCE(unreconciled_amount, received_amount - reconciled_amount)) FROM finance_receipt WHERE deleted_at IS NULL AND status IN ('confirmed', 'partially_reconciled')` + projectFilter + `), 0) AS unreconciledReceiptAmount,
		  ` + bankAccountCountSQL + ` AS bankAccountCount
	`
}

func (a *Adapter) ContractSummaries(ctx context.Context, query url.Values) (DataResult[[]ContractSummary], error) {
	codes := parseCodes(firstNonEmpty(query.Get("contractCodes"), query.Get("contract_codes")))
	if len(codes) == 0 {
		return DataResult[[]ContractSummary]{Data: []ContractSummary{}}, nil
	}
	projectCodes, projectScoped := projectFinanceReportProjectCodesFromQuery(query)
	if projectScoped && len(projectCodes) == 0 {
		return DataResult[[]ContractSummary]{Data: []ContractSummary{}}, nil
	}

	rows, err := a.db.QueryContext(ctx, contractSummariesSQL(len(codes), len(projectCodes)), contractSummariesArgs(codes, projectCodes)...)
	if err != nil {
		return DataResult[[]ContractSummary]{}, err
	}
	defer rows.Close()

	items := make([]ContractSummary, 0)
	for rows.Next() {
		var item ContractSummary
		var customerCode, projectCode, contractAmount, unreceivedAmount, unreconciledAmount, latestInvoiceDate, latestReceivedAt, riskStatus, calculatedAt sql.NullString
		if err := rows.Scan(
			&item.ContractCode,
			&customerCode,
			&projectCode,
			&contractAmount,
			&item.InvoiceAmount,
			&item.ReceivedAmount,
			&item.ReconciledAmount,
			&unreceivedAmount,
			&unreconciledAmount,
			&item.InvoiceCount,
			&item.ReceiptCount,
			&latestInvoiceDate,
			&latestReceivedAt,
			&riskStatus,
			&calculatedAt,
		); err != nil {
			return DataResult[[]ContractSummary]{}, err
		}
		item.CustomerCode = nullableString(customerCode)
		item.ProjectCode = nullableString(projectCode)
		item.ContractAmount = nullableString(contractAmount)
		item.UnreceivedAmount = nullableString(unreceivedAmount)
		item.UnreconciledAmount = nullableString(unreconciledAmount)
		item.LatestInvoiceDate = nullableString(latestInvoiceDate)
		item.LatestReceivedAt = nullableString(latestReceivedAt)
		item.CalculatedAt = nullableString(calculatedAt)
		item.RiskStatus = firstNonEmpty(nullString(riskStatus), "normal")
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return DataResult[[]ContractSummary]{}, err
	}
	return DataResult[[]ContractSummary]{Data: items}, nil
}

func contractSummariesArgs(codes []string, projectCodes []string) []any {
	args := make([]any, 0, len(codes)*4+len(projectCodes)*4)
	for _, code := range codes {
		args = append(args, code)
	}
	appendProjectCodes := func() {
		for _, code := range projectCodes {
			args = append(args, code)
		}
	}
	if len(projectCodes) > 0 {
		appendProjectCodes()
	}
	for i := 0; i < 3; i++ {
		for _, code := range codes {
			args = append(args, code)
		}
		if len(projectCodes) > 0 {
			appendProjectCodes()
		}
	}
	return args
}

func contractSummariesSQL(codeCount int, projectCodeCount int) string {
	seedParts := make([]string, codeCount)
	for i := range seedParts {
		seedParts[i] = "SELECT ? AS contract_code"
	}
	inParts := placeholders(codeCount)
	summaryProjectFilter := projectCodeSQLFilter(projectCodeCount, "summary.project_code")
	invoiceProjectFilter := projectCodeSQLFilter(projectCodeCount, "project_code")
	receiptProjectFilter := projectCodeSQLFilter(projectCodeCount, "project_code")
	reconciliationProjectFilter := projectCodeSQLFilter(projectCodeCount, "project_code")
	resultFilter := ""
	if projectCodeCount > 0 {
		resultFilter = `
		WHERE summary.contract_code IS NOT NULL
		   OR invoice.contract_code IS NOT NULL
		   OR receipt.contract_code IS NOT NULL
		   OR reconciliation.contract_code IS NOT NULL`
	}
	return `
		SELECT
		  seed.contract_code,
		  COALESCE(invoice.customer_code, receipt.customer_code, summary.customer_code) AS customer_code,
		  COALESCE(invoice.project_code, receipt.project_code, summary.project_code) AS project_code,
		  summary.contract_amount,
		  COALESCE(invoice.invoice_amount, summary.invoice_amount, 0) AS invoice_amount,
		  COALESCE(receipt.received_amount, summary.received_amount, 0) AS received_amount,
		  COALESCE(summary.reconciled_amount, reconciliation.reconciled_amount, 0) AS reconciled_amount,
		  summary.unreceived_amount,
		  COALESCE(summary.unreconciled_amount, COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0)) AS unreconciled_amount,
		  COALESCE(invoice.invoice_count, summary.invoice_count, 0) AS invoice_count,
		  COALESCE(receipt.receipt_count, summary.receipt_count, 0) AS receipt_count,
		  COALESCE(invoice.latest_invoice_date, summary.latest_invoice_date) AS latest_invoice_date,
		  COALESCE(receipt.latest_received_at, summary.latest_received_at) AS latest_received_at,
		  COALESCE(summary.risk_status, 'normal') AS risk_status,
		  COALESCE(summary.calculated_at, NOW()) AS calculated_at
		FROM (` + strings.Join(seedParts, " UNION ALL ") + `) seed
		LEFT JOIN finance_contract_summary summary ON summary.contract_code = seed.contract_code` + summaryProjectFilter + `
		LEFT JOIN (
		  SELECT contract_code, MAX(customer_code) AS customer_code, MAX(project_code) AS project_code, SUM(invoice_amount) AS invoice_amount, COUNT(*) AS invoice_count, MAX(invoice_date) AS latest_invoice_date
		  FROM finance_invoice
		  WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND contract_code IN (` + inParts + `)` + invoiceProjectFilter + `
		  GROUP BY contract_code
		) invoice ON invoice.contract_code = seed.contract_code
		LEFT JOIN (
		  SELECT contract_code, MAX(customer_code) AS customer_code, MAX(project_code) AS project_code, SUM(received_amount) AS received_amount, COUNT(*) AS receipt_count, MAX(received_at) AS latest_received_at
		  FROM finance_receipt
		  WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code IN (` + inParts + `)` + receiptProjectFilter + `
		  GROUP BY contract_code
		) receipt ON receipt.contract_code = seed.contract_code
		LEFT JOIN (
		  SELECT contract_code, SUM(reconciled_amount) AS reconciled_amount
		  FROM finance_reconciliation
		  WHERE status = 'active' AND contract_code IN (` + inParts + `)` + reconciliationProjectFilter + `
		  GROUP BY contract_code
		) reconciliation ON reconciliation.contract_code = seed.contract_code` + resultFilter + `
	`
}

func projectCodeSQLFilter(projectCodeCount int, column string) string {
	if projectCodeCount <= 0 {
		return ""
	}
	return " AND " + column + " IN (" + placeholders(projectCodeCount) + ")"
}

func cloneQueryValues(query url.Values) url.Values {
	cloned := url.Values{}
	for key, values := range query {
		cloned[key] = append([]string{}, values...)
	}
	return cloned
}

func (a *Adapter) BankAccounts(ctx context.Context, query url.Values) (ListResult[map[string]any], error) {
	where := []string{"ba.deleted_at IS NULL"}
	args := make([]any, 0)
	showAll := isTruthy(query.Get("showAll"))
	if !showAll {
		where = append(where, "ba.status = ?")
		args = append(args, "active")
		where = append(where, "COALESCE(latest.balance_amount, 0) <> 0")
	}
	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" {
		where = append(where, "(ba.code LIKE ? ESCAPE '\\\\' OR ba.account_name LIKE ? ESCAPE '\\\\' OR ba.bank_name LIKE ? ESCAPE '\\\\' OR ba.account_no_masked LIKE ? ESCAPE '\\\\' OR ba.owner_dept_code LIKE ? ESCAPE '\\\\')")
		for i := 0; i < 5; i++ {
			args = append(args, likeKeyword(keyword))
		}
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "ba.status = ?")
		args = append(args, status)
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")
	fromSQL := `
		FROM finance_bank_account ba
		LEFT JOIN finance_account_balance_snapshot latest
		  ON latest.id = (
		    SELECT bs.id
		    FROM finance_account_balance_snapshot bs
		    WHERE bs.bank_account_id = ba.id
		    ORDER BY bs.snapshot_date DESC, bs.id DESC
		    LIMIT 1
		  )
	`

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total "+fromSQL+" "+whereSQL, args...).Scan(&total); err != nil {
		return ListResult[map[string]any]{}, err
	}

	summary := map[string]any{
		"account_count":      int64(0),
		"cash_balance":       "0.00",
		"loan_balance":       "0.00",
		"stock_fund_balance": "0.00",
	}
	var accountCount int64
	var cashBalance, loanBalance, stockFundBalance string
	if err := a.db.QueryRowContext(ctx, `
		SELECT
		  COUNT(*) AS account_count,
		  COALESCE(SUM(CASE WHEN latest.balance_amount > 0 THEN latest.balance_amount ELSE 0 END), 0) AS cash_balance,
		  COALESCE(SUM(CASE WHEN latest.balance_amount < 0 THEN latest.balance_amount ELSE 0 END), 0) AS loan_balance,
		  COALESCE(SUM(CASE WHEN latest.balance_amount <> 0 THEN latest.balance_amount ELSE 0 END), 0) AS stock_fund_balance
		`+fromSQL+" "+whereSQL, args...).Scan(&accountCount, &cashBalance, &loanBalance, &stockFundBalance); err != nil {
		return ListResult[map[string]any]{}, err
	}
	summary["account_count"] = accountCount
	summary["cash_balance"] = cashBalance
	summary["loan_balance"] = loanBalance
	summary["stock_fund_balance"] = stockFundBalance

	rows, err := a.db.QueryContext(ctx, `
		SELECT
		  ba.id,
		  ba.code,
		  ba.account_name,
		  ba.bank_name,
		  ba.account_no_masked,
		  ba.account_type,
		  ba.currency_code,
		  ba.owner_dept_code,
		  ba.status,
		  ba.opened_at,
		  ba.created_at,
		  ba.deleted_at,
		  latest.balance_amount AS latest_balance_amount,
		  latest.snapshot_date AS latest_balance_date
		`+fromSQL+" "+whereSQL+`
		ORDER BY latest.snapshot_date DESC, ba.created_at DESC, ba.id DESC
	`, args...)
	if err != nil {
		return ListResult[map[string]any]{}, err
	}
	defer rows.Close()

	data := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var code, accountName string
		var bankName, accountNoMasked, accountType, currencyCode, ownerDeptCode, status sql.NullString
		var openedAt, createdAt, deletedAt, latestBalanceAmount, latestBalanceDate sql.NullString
		if err := rows.Scan(&id, &code, &accountName, &bankName, &accountNoMasked, &accountType, &currencyCode, &ownerDeptCode, &status, &openedAt, &createdAt, &deletedAt, &latestBalanceAmount, &latestBalanceDate); err != nil {
			return ListResult[map[string]any]{}, err
		}
		data = append(data, map[string]any{
			"id":                    id,
			"code":                  code,
			"account_name":          accountName,
			"bank_name":             nullableAny(bankName),
			"account_no_masked":     nullableAny(accountNoMasked),
			"account_type":          nullableAny(accountType),
			"currency_code":         nullableAny(currencyCode),
			"owner_dept_code":       nullableAny(ownerDeptCode),
			"status":                nullableAny(status),
			"opened_at":             nullableAny(openedAt),
			"created_at":            nullableAny(createdAt),
			"deleted_at":            nullableAny(deletedAt),
			"latest_balance_amount": nullableAny(latestBalanceAmount),
			"latest_balance_date":   nullableAny(latestBalanceDate),
		})
	}
	if err := rows.Err(); err != nil {
		return ListResult[map[string]any]{}, err
	}
	return ListResult[map[string]any]{Data: data, Summary: summary, Total: total, Page: 1, PageSize: total}, nil
}

func parseCodes(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if text := strings.TrimSpace(part); text != "" {
			result = append(result, text)
		}
		if len(result) >= 100 {
			break
		}
	}
	return result
}

func likeKeyword(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + replacer.Replace(value) + "%"
}

func isTruthy(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "1" || value == "true" || value == "yes"
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := value.String
	return &text
}

func nullableAny(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullString(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
