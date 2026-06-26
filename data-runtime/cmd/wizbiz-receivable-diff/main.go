package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiz"
	"github.com/joho/godotenv"
)

type sourceContract struct {
	LegacyID        string
	SourceCode      string
	TargetCode      string
	Name            string
	Status          string
	TotalAmount     float64
	InvoiceAmount   float64
	ReceivedAmount  float64
	Unreceived      float64
	InvoiceBalance  float64
	ReceivableField string
}

type targetContract struct {
	ID                    int64
	Code                  string
	LegacyID              string
	Name                  string
	Status                string
	LegacySource          string
	TotalAmount           float64
	InvoiceAmount         float64
	FinanceReceivedAmount float64
	ExecutedAmount        float64
	Unreceived            float64
	ReceivableUncollected float64
	InvoiceBalance        float64
	PlanCount             int
	PlanTotal             float64
}

type summary struct {
	Count                 int
	ContractAmount        float64
	Unreceived            float64
	InvoiceBalance        float64
	ReceivableUncollected float64
}

type moneyAgg struct {
	Count  int
	Amount float64
}

func main() {
	var envPath string
	var sampleLimit int
	var inspectIDs string
	flags := flag.NewFlagSet("wizbiz-receivable-diff", flag.ExitOnError)
	flags.StringVar(&envPath, "env", ".env", "environment file path")
	flags.IntVar(&sampleLimit, "samples", 20, "number of rows to print for each diff section")
	flags.StringVar(&inspectIDs, "inspect-ids", "", "comma-separated legacy ids to print with raw source fields")
	flags.Parse(os.Args[1:])

	if envPath != "" {
		_ = godotenv.Load(envPath)
	}

	cfg := wizbiz.LoadConfigFromEnv()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	sourceDB, err := openDB(cfg.Source)
	must("open source", err)
	defer sourceDB.Close()
	altocDB, err := openDB(cfg.Altoc)
	must("open altoc", err)
	defer altocDB.Close()

	must("ping source", sourceDB.PingContext(ctx))
	must("ping altoc", altocDB.PingContext(ctx))

	sourceRows, err := loadSourceContracts(ctx, sourceDB)
	must("load source contracts", err)
	targetRows, err := loadTargetContracts(ctx, altocDB, cfg.Finance.Database)
	must("load target contracts", err)
	if strings.TrimSpace(inspectIDs) != "" {
		must("inspect ids", inspectContracts(ctx, sourceDB, altocDB, cfg.Finance.Database, parseCSV(inspectIDs)))
		return
	}

	printSourceFieldDetection(sourceRows)
	fmt.Println()
	printSourceStatusBreakdown(sourceRows)
	fmt.Println()
	printTargetStatusBreakdown(targetRows)
	fmt.Println()

	sourcePositive := filterSource(sourceRows, func(row sourceContract) bool {
		return moneyPositive(row.Unreceived)
	})
	sourceStoredPositive := filterSource(sourceRows, func(row sourceContract) bool {
		return row.ReceivableField != "" && moneyPositive(row.Unreceived)
	})
	sourceStoredStatus0Positive := filterSource(sourceRows, func(row sourceContract) bool {
		return row.ReceivableField != "" && strings.TrimSpace(row.Status) == "0" && moneyPositive(row.Unreceived)
	})
	sourceActivePositive := filterSource(sourceRows, func(row sourceContract) bool {
		return sourceStatusEffective(row.Status) && moneyPositive(row.Unreceived)
	})
	targetUnreceivedPositive := filterTarget(targetRows, func(row targetContract) bool {
		return moneyPositive(row.Unreceived)
	})
	targetLegacyUnreceivedPositive := filterTarget(targetRows, func(row targetContract) bool {
		return row.LegacySource == "wizbizdb" && moneyPositive(row.Unreceived)
	})
	targetEffectiveUnreceivedPositive := filterTarget(targetRows, func(row targetContract) bool {
		return targetStatusEffective(row.Status) && moneyPositive(row.Unreceived)
	})
	targetEffectiveReceivablePositive := filterTarget(targetRows, func(row targetContract) bool {
		return targetStatusEffective(row.Status) && moneyPositive(row.ReceivableUncollected)
	})

	fmt.Println("=== Summary Candidates ===")
	printSummary("source positive unreceived", summarizeSource(sourcePositive))
	printSummary("source stored-field positive unreceived", summarizeSource(sourceStoredPositive))
	printSummary("source stored-field status=0 positive unreceived", summarizeSource(sourceStoredStatus0Positive))
	printSummary("source effective positive unreceived", summarizeSource(sourceActivePositive))
	printSummary("target all positive unreceived", summarizeTarget(targetUnreceivedPositive))
	printSummary("target legacy positive unreceived", summarizeTarget(targetLegacyUnreceivedPositive))
	printSummary("target effective positive unreceived", summarizeTarget(targetEffectiveUnreceivedPositive))
	printSummary("target effective positive receivable_uncollected", summarizeTarget(targetEffectiveReceivablePositive))
	fmt.Println()

	extraTargets := extraTargetsByLegacyID(sourceStoredStatus0Positive, targetEffectiveUnreceivedPositive)
	must("print finance migration check", printFinanceMigrationCheck(ctx, sourceDB, altocDB, cfg.Finance.Database, extraTargets, sampleLimit))
	fmt.Println()

	compareByLegacyID(sourceStoredStatus0Positive, targetEffectiveUnreceivedPositive, sourceRows, targetRows, sampleLimit)
}

func openDB(cfg wizbiz.DBConfig) (*sql.DB, error) {
	mysqlCfg := mysql.NewConfig()
	mysqlCfg.Net = "tcp"
	port := cfg.Port
	if port <= 0 {
		port = 3306
	}
	mysqlCfg.Addr = fmt.Sprintf("%s:%d", cfg.Host, port)
	mysqlCfg.User = cfg.User
	mysqlCfg.Passwd = cfg.Password
	mysqlCfg.DBName = cfg.Database
	mysqlCfg.ParseTime = false
	mysqlCfg.Params = map[string]string{
		"charset":   "utf8mb4",
		"collation": "utf8mb4_unicode_ci",
	}
	mysqlCfg.Loc = time.UTC
	conn, err := sql.Open("mysql", mysqlCfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(3)
	conn.SetMaxIdleConns(3)
	conn.SetConnMaxLifetime(5 * time.Minute)
	return conn, nil
}

func loadSourceContracts(ctx context.Context, db *sql.DB) ([]sourceContract, error) {
	rows, err := queryMaps(ctx, db, "SELECT * FROM wb_contract")
	if err != nil {
		return nil, err
	}
	result := make([]sourceContract, 0, len(rows))
	for _, row := range rows {
		legacyID := firstText(row, "contract_id", "id")
		if strings.TrimSpace(legacyID) == "" {
			continue
		}
		total := firstNumber(row, "total_amount", "amount", "contract_amount")
		invoiceAmount := firstNumber(row, "invoiced_amount", "issued_invoice_amount")
		invoiceBalance, invoiceBalanceField := firstNumberWithKey(row, "invoice_balance", "uninvoiced_amount", "invoice_amount")
		if invoiceBalanceField == "" {
			invoiceBalance = math.Max(total-invoiceAmount, 0)
		}
		receivableAmount, receivableField := firstNumberWithKey(row, "receivable_amount", "unreceived_amount", "ar_amount", "exec_amount")
		receivedAmount := firstNumber(row, "received_amount", "paid_amount", "payment_amount")
		if !moneyPositive(receivedAmount) && moneyPositive(total) && moneyPositive(receivableAmount) {
			receivedAmount = math.Max(total-receivableAmount, 0)
		}
		unreceived := receivableAmount
		if receivableField == "" {
			unreceived = math.Max(total-receivedAmount, 0)
		}
		result = append(result, sourceContract{
			LegacyID:        legacyID,
			SourceCode:      firstText(row, "contract_code", "contract_no"),
			TargetCode:      "CTMIG" + legacyID,
			Name:            firstText(row, "contract_name", "name"),
			Status:          firstText(row, "contract_status", "status"),
			TotalAmount:     total,
			InvoiceAmount:   invoiceAmount,
			ReceivedAmount:  receivedAmount,
			Unreceived:      unreceived,
			InvoiceBalance:  invoiceBalance,
			ReceivableField: receivableField,
		})
	}
	return result, nil
}

func inspectContracts(ctx context.Context, sourceDB *sql.DB, altocDB *sql.DB, financeDBName string, ids []string) error {
	allTargets, err := loadTargetContracts(ctx, altocDB, financeDBName)
	if err != nil {
		return err
	}
	targetByID := make(map[string]targetContract, len(allTargets))
	for _, target := range allTargets {
		targetByID[targetLegacyID(target)] = target
	}
	for _, id := range ids {
		fmt.Printf("=== Inspect legacy id %s ===\n", id)
		sourceRows, err := queryMaps(ctx, sourceDB, "SELECT * FROM wb_contract WHERE contract_id = ? LIMIT 1", id)
		if err != nil {
			return err
		}
		if len(sourceRows) == 0 {
			fmt.Println("source: <not found>")
		} else {
			printMap("source", sourceRows[0])
		}
		target := targetByID[id]
		if target.Code == "" {
			fmt.Println("target: <not found>")
		} else {
			fmt.Printf("target: code=%s status=%s total=%s received=%s unreceived=%s receivable_uncollected=%s invoice_balance=%s plan_count=%d\n",
				target.Code,
				target.Status,
				money(target.TotalAmount),
				money(target.FinanceReceivedAmount),
				money(target.Unreceived),
				money(target.ReceivableUncollected),
				money(target.InvoiceBalance),
				target.PlanCount,
			)
		}
		fmt.Println()
	}
	return nil
}

func loadTargetContracts(ctx context.Context, db *sql.DB, financeDBName string) ([]targetContract, error) {
	financeDB := quoteIdent(financeDBName)
	contractCols, err := tableColumns(ctx, db, "contract")
	if err != nil {
		return nil, err
	}
	legacyIDSelect := "NULL AS legacy_id"
	if contractCols["legacy_id"] {
		legacyIDSelect = "ct.legacy_id"
	}
	legacySourceSelect := "NULL AS legacy_source"
	if contractCols["legacy_source"] {
		legacySourceSelect = "ct.legacy_source"
	}
	executedAmountSelect := "0 AS executed_amount"
	if contractCols["executed_amount"] {
		executedAmountSelect = "COALESCE(ct.executed_amount, 0) AS executed_amount"
	}
	query := fmt.Sprintf(`
		SELECT
		  ct.id,
		  ct.code,
		  %s,
		  ct.name,
		  ct.status,
		  %s,
		  COALESCE(ct.amount_tax_inclusive, 0) AS total_amount,
		  %s,
		  COALESCE(receipt.received_amount, summary.received_amount, 0) AS finance_received_amount,
		  COALESCE(plans.plan_count, 0) AS plan_count,
		  COALESCE(plans.plan_total, 0) AS plan_total,
		  COALESCE(invoice.invoice_amount, summary.invoice_amount, 0) AS invoice_amount
		FROM contract ct
		LEFT JOIN (
		  SELECT contract_id, COUNT(*) AS plan_count, SUM(COALESCE(amount, 0)) AS plan_total
		  FROM receivable_plan
		  WHERE deleted_at IS NULL
		  GROUP BY contract_id
		) plans ON plans.contract_id = ct.id
		LEFT JOIN %s.finance_contract_summary summary ON summary.contract_code = ct.code
		LEFT JOIN (
		  SELECT contract_code, SUM(COALESCE(invoice_amount, 0)) AS invoice_amount
		  FROM %s.finance_invoice
		  WHERE deleted_at IS NULL
		    AND status NOT IN ('canceled', 'red_reversed')
		    AND contract_code IS NOT NULL
		    AND contract_code <> ''
		  GROUP BY contract_code
		) invoice ON invoice.contract_code = ct.code
		LEFT JOIN (
		  SELECT contract_code, SUM(COALESCE(received_amount, 0)) AS received_amount
		  FROM %s.finance_receipt
		  WHERE deleted_at IS NULL
		    AND status <> 'canceled'
		    AND contract_code IS NOT NULL
		    AND contract_code <> ''
		  GROUP BY contract_code
		) receipt ON receipt.contract_code = ct.code
		WHERE ct.deleted_at IS NULL
	`, legacyIDSelect, legacySourceSelect, executedAmountSelect, financeDB, financeDB, financeDB)
	rows, err := queryMaps(ctx, db, query)
	if err != nil {
		return nil, err
	}
	result := make([]targetContract, 0, len(rows))
	for _, row := range rows {
		total := firstNumber(row, "total_amount")
		received := firstNumber(row, "finance_received_amount")
		planCount := int(firstNumber(row, "plan_count"))
		planTotal := firstNumber(row, "plan_total")
		invoiceAmount := firstNumber(row, "invoice_amount")
		receivableBase := invoiceAmount
		if planCount > 0 {
			receivableBase = planTotal
		}
		result = append(result, targetContract{
			ID:                    int64(firstNumber(row, "id")),
			Code:                  firstText(row, "code"),
			LegacyID:              firstText(row, "legacy_id"),
			Name:                  firstText(row, "name"),
			Status:                firstText(row, "status"),
			LegacySource:          firstText(row, "legacy_source"),
			TotalAmount:           total,
			InvoiceAmount:         invoiceAmount,
			FinanceReceivedAmount: received,
			ExecutedAmount:        firstNumber(row, "executed_amount"),
			Unreceived:            math.Max(total-received, 0),
			InvoiceBalance:        math.Max(total-invoiceAmount, 0),
			ReceivableUncollected: math.Max(receivableBase-received, 0),
			PlanCount:             planCount,
			PlanTotal:             planTotal,
		})
	}
	return result, nil
}

func tableColumns(ctx context.Context, db *sql.DB, table string) (map[string]bool, error) {
	rows, err := queryMaps(ctx, db, `
		SELECT COLUMN_NAME
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
	`, table)
	if err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(rows))
	for _, row := range rows {
		result[firstText(row, "COLUMN_NAME")] = true
	}
	return result, nil
}

func queryMaps(ctx context.Context, db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(cols))
		for i, col := range cols {
			item[col] = normalizeDBValue(values[i])
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func normalizeDBValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case time.Time:
		return typed.Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func printSourceStatusBreakdown(rows []sourceContract) {
	type bucket struct {
		Count      int
		Positive   int
		Unreceived float64
	}
	buckets := map[string]*bucket{}
	for _, row := range rows {
		key := firstNonEmpty(strings.TrimSpace(row.Status), "<empty>")
		if buckets[key] == nil {
			buckets[key] = &bucket{}
		}
		buckets[key].Count++
		if moneyPositive(row.Unreceived) {
			buckets[key].Positive++
			buckets[key].Unreceived += row.Unreceived
		}
	}
	keys := sortedKeys(buckets)
	fmt.Println("=== Source wb_contract status breakdown ===")
	fmt.Println("status\tcount\tpositive_unreceived\tunreceived_sum")
	for _, key := range keys {
		b := buckets[key]
		fmt.Printf("%s\t%d\t%d\t%s\n", key, b.Count, b.Positive, money(b.Unreceived))
	}
}

func printSourceFieldDetection(rows []sourceContract) {
	counts := map[string]int{}
	amounts := map[string]float64{}
	for _, row := range rows {
		field := firstNonEmpty(row.ReceivableField, "<computed>")
		if moneyPositive(row.Unreceived) {
			counts[field]++
			amounts[field] += row.Unreceived
		}
	}
	keys := sortedKeys(counts)
	fmt.Println("=== Source receivable field detection ===")
	fmt.Println("field\tpositive_unreceived\tunreceived_sum")
	for _, key := range keys {
		fmt.Printf("%s\t%d\t%s\n", key, counts[key], money(amounts[key]))
	}
}

func printTargetStatusBreakdown(rows []targetContract) {
	type bucket struct {
		Count      int
		Positive   int
		Unreceived float64
	}
	buckets := map[string]*bucket{}
	for _, row := range rows {
		key := firstNonEmpty(strings.TrimSpace(row.Status), "<empty>")
		if buckets[key] == nil {
			buckets[key] = &bucket{}
		}
		buckets[key].Count++
		if moneyPositive(row.Unreceived) {
			buckets[key].Positive++
			buckets[key].Unreceived += row.Unreceived
		}
	}
	keys := sortedKeys(buckets)
	fmt.Println("=== Target contract status breakdown ===")
	fmt.Println("status\tcount\tpositive_unreceived\tunreceived_sum")
	for _, key := range keys {
		b := buckets[key]
		fmt.Printf("%s\t%d\t%d\t%s\n", key, b.Count, b.Positive, money(b.Unreceived))
	}
}

func compareByLegacyID(sourceRows []sourceContract, targetRows []targetContract, allSourceRows []sourceContract, allTargetRows []targetContract, sampleLimit int) {
	allSourceByID := make(map[string]sourceContract, len(allSourceRows))
	for _, row := range allSourceRows {
		allSourceByID[row.LegacyID] = row
	}
	allTargetByID := make(map[string]targetContract, len(allTargetRows))
	for _, row := range allTargetRows {
		legacyID := targetLegacyID(row)
		if legacyID == "" {
			continue
		}
		allTargetByID[legacyID] = row
	}

	sourceByID := make(map[string]sourceContract, len(sourceRows))
	for _, row := range sourceRows {
		sourceByID[row.LegacyID] = row
	}
	targetByID := make(map[string]targetContract, len(targetRows))
	for _, row := range targetRows {
		legacyID := targetLegacyID(row)
		if legacyID == "" {
			continue
		}
		targetByID[legacyID] = row
	}

	missingInTarget := make([]sourceContract, 0)
	extraInTarget := make([]targetContract, 0)
	differentAmount := make([]struct {
		Source sourceContract
		Target targetContract
		Diff   float64
	}, 0)
	for id, source := range sourceByID {
		target, ok := targetByID[id]
		if !ok {
			missingInTarget = append(missingInTarget, source)
			continue
		}
		diff := target.Unreceived - source.Unreceived
		if math.Abs(diff) > 0.01 {
			differentAmount = append(differentAmount, struct {
				Source sourceContract
				Target targetContract
				Diff   float64
			}{Source: source, Target: target, Diff: diff})
		}
	}
	for id, target := range targetByID {
		if _, ok := sourceByID[id]; !ok {
			extraInTarget = append(extraInTarget, target)
		}
	}

	sort.Slice(missingInTarget, func(i, j int) bool { return missingInTarget[i].Unreceived > missingInTarget[j].Unreceived })
	sort.Slice(extraInTarget, func(i, j int) bool { return extraInTarget[i].Unreceived > extraInTarget[j].Unreceived })
	sort.Slice(differentAmount, func(i, j int) bool { return math.Abs(differentAmount[i].Diff) > math.Abs(differentAmount[j].Diff) })

	fmt.Println("=== Diff by legacy_id: source effective positive vs target effective unreceived positive ===")
	fmt.Printf("missing_in_target_positive=%d amount=%s\n", len(missingInTarget), money(sumSourceUnreceived(missingInTarget)))
	fmt.Printf("extra_in_target_positive=%d amount=%s\n", len(extraInTarget), money(sumTargetUnreceived(extraInTarget)))
	fmt.Printf("amount_changed=%d net_diff=%s\n", len(differentAmount), money(sumDiff(differentAmount)))
	fmt.Println()

	printMissingSources("Missing in target positive sample", missingInTarget, allTargetByID, sampleLimit)
	printExtraTargets("Extra in target positive sample", extraInTarget, allSourceByID, sampleLimit)
	printChanged("Changed amount sample", differentAmount, sampleLimit)
}

func extraTargetsByLegacyID(sourceRows []sourceContract, targetRows []targetContract) []targetContract {
	sourceByID := make(map[string]bool, len(sourceRows))
	for _, row := range sourceRows {
		sourceByID[row.LegacyID] = true
	}
	result := make([]targetContract, 0)
	for _, row := range targetRows {
		if !sourceByID[targetLegacyID(row)] {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Unreceived > result[j].Unreceived })
	return result
}

func printFinanceMigrationCheck(ctx context.Context, sourceDB *sql.DB, altocDB *sql.DB, financeDBName string, targets []targetContract, limit int) error {
	if len(targets) == 0 {
		return nil
	}
	if limit <= 0 || limit > len(targets) {
		limit = len(targets)
	}
	targets = targets[:limit]

	legacyIDs := make([]string, 0, len(targets))
	codes := make([]string, 0, len(targets))
	for _, target := range targets {
		legacyIDs = append(legacyIDs, targetLegacyID(target))
		codes = append(codes, target.Code)
	}

	sourceInvoices, err := sourceAggByContractID(ctx, sourceDB, "wb_invoice", legacyIDs, "amount", "invoice_amount")
	if err != nil {
		return err
	}
	sourceReceipts, err := sourceAggByContractID(ctx, sourceDB, "wb_project_income", legacyIDs, "amount", "received_amount")
	if err != nil {
		return err
	}
	financeInvoices, err := financeAggByContractCode(ctx, altocDB, financeDBName, "finance_invoice", codes, "invoice_amount", "status NOT IN ('canceled', 'red_reversed')")
	if err != nil {
		return err
	}
	financeReceipts, err := financeAggByContractCode(ctx, altocDB, financeDBName, "finance_receipt", codes, "received_amount", "status <> 'canceled'")
	if err != nil {
		return err
	}
	fmt.Println("=== Extra target finance migration check ===")
	fmt.Println("legacy_id\tcode\tnew_unreceived\tsrc_inv_cnt\tsrc_inv_sum\tfin_inv_cnt\tfin_inv_sum\tsrc_rcpt_cnt\tsrc_rcpt_sum\tfin_rcpt_cnt\tfin_rcpt_sum")
	for _, target := range targets {
		legacyID := targetLegacyID(target)
		srcInv := sourceInvoices[legacyID]
		finInv := financeInvoices[target.Code]
		srcReceipt := sourceReceipts[legacyID]
		finReceipt := financeReceipts[target.Code]
		fmt.Printf("%s\t%s\t%s\t%d\t%s\t%d\t%s\t%d\t%s\t%d\t%s\n",
			legacyID,
			target.Code,
			money(target.Unreceived),
			srcInv.Count,
			money(srcInv.Amount),
			finInv.Count,
			money(finInv.Amount),
			srcReceipt.Count,
			money(srcReceipt.Amount),
			finReceipt.Count,
			money(finReceipt.Amount),
		)
	}
	return nil
}

func sourceAggByContractID(ctx context.Context, db *sql.DB, table string, legacyIDs []string, amountKeys ...string) (map[string]moneyAgg, error) {
	result := map[string]moneyAgg{}
	if len(legacyIDs) == 0 {
		return result, nil
	}
	args := make([]any, 0, len(legacyIDs))
	for _, id := range legacyIDs {
		args = append(args, id)
	}
	rows, err := queryMaps(ctx, db, "SELECT * FROM "+quoteIdent(table)+" WHERE contract_id IN ("+questionPlaceholders(len(args))+")", args...)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		id := firstText(row, "contract_id")
		agg := result[id]
		agg.Count++
		agg.Amount += firstNumber(row, amountKeys...)
		result[id] = agg
	}
	return result, nil
}

func financeAggByContractCode(ctx context.Context, db *sql.DB, financeDBName string, table string, codes []string, amountKey string, statusClause string) (map[string]moneyAgg, error) {
	result := map[string]moneyAgg{}
	if len(codes) == 0 {
		return result, nil
	}
	args := make([]any, 0, len(codes))
	for _, code := range codes {
		args = append(args, code)
	}
	query := "SELECT contract_code, " + quoteIdent(amountKey) + " AS amount FROM " + quoteIdent(financeDBName) + "." + quoteIdent(table) +
		" WHERE deleted_at IS NULL AND contract_code IN (" + questionPlaceholders(len(args)) + ")"
	if strings.TrimSpace(statusClause) != "" {
		query += " AND " + statusClause
	}
	rows, err := queryMaps(ctx, db, query, args...)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		code := firstText(row, "contract_code")
		agg := result[code]
		agg.Count++
		agg.Amount += firstNumber(row, "amount")
		result[code] = agg
	}
	return result, nil
}

func targetLegacyID(row targetContract) string {
	legacyID := strings.TrimSpace(row.LegacyID)
	if legacyID == "" && strings.HasPrefix(row.Code, "CTMIG") {
		legacyID = strings.TrimPrefix(row.Code, "CTMIG")
	}
	return legacyID
}

func printSummary(label string, s summary) {
	fmt.Printf("%-45s count=%4d contract=%14s unreceived=%14s invoice_balance=%14s receivable_uncollected=%14s\n",
		label,
		s.Count,
		money(s.ContractAmount),
		money(s.Unreceived),
		money(s.InvoiceBalance),
		money(s.ReceivableUncollected),
	)
}

func printMissingSources(title string, rows []sourceContract, allTargetByID map[string]targetContract, limit int) {
	fmt.Println(title)
	fmt.Println("legacy_id\told_code\told_unreceived\told_total\told_received\told_status\ttarget_status\ttarget_unreceived\ttarget_received\tname")
	for i, row := range rows {
		if i >= limit {
			break
		}
		target := allTargetByID[row.LegacyID]
		fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			row.LegacyID,
			row.SourceCode,
			money(row.Unreceived),
			money(row.TotalAmount),
			money(row.ReceivedAmount),
			row.Status,
			target.Status,
			money(target.Unreceived),
			money(target.FinanceReceivedAmount),
			short(firstNonEmpty(target.Name, row.Name)),
		)
	}
	fmt.Println()
}

func printExtraTargets(title string, rows []targetContract, allSourceByID map[string]sourceContract, limit int) {
	fmt.Println(title)
	fmt.Println("legacy_id\tcode\tnew_unreceived\tnew_total\tnew_received\tstatus\told_status\told_unreceived\told_received\tname")
	for i, row := range rows {
		if i >= limit {
			break
		}
		legacyID := targetLegacyID(row)
		source := allSourceByID[legacyID]
		fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			legacyID,
			row.Code,
			money(row.Unreceived),
			money(row.TotalAmount),
			money(row.FinanceReceivedAmount),
			row.Status,
			source.Status,
			money(source.Unreceived),
			money(source.ReceivedAmount),
			short(firstNonEmpty(row.Name, source.Name)),
		)
	}
	fmt.Println()
}

func printChanged(title string, rows []struct {
	Source sourceContract
	Target targetContract
	Diff   float64
}, limit int) {
	fmt.Println(title)
	fmt.Println("legacy_id\tcode\told_unreceived\tnew_unreceived\tdiff\told_received\tnew_received\tname")
	for i, row := range rows {
		if i >= limit {
			break
		}
		fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			row.Source.LegacyID,
			row.Target.Code,
			money(row.Source.Unreceived),
			money(row.Target.Unreceived),
			money(row.Diff),
			money(row.Source.ReceivedAmount),
			money(row.Target.FinanceReceivedAmount),
			short(firstNonEmpty(row.Target.Name, row.Source.Name)),
		)
	}
	fmt.Println()
}

func summarizeSource(rows []sourceContract) summary {
	var s summary
	s.Count = len(rows)
	for _, row := range rows {
		s.ContractAmount += row.TotalAmount
		s.Unreceived += row.Unreceived
		s.InvoiceBalance += row.InvoiceBalance
	}
	return s
}

func summarizeTarget(rows []targetContract) summary {
	var s summary
	s.Count = len(rows)
	for _, row := range rows {
		s.ContractAmount += row.TotalAmount
		s.Unreceived += row.Unreceived
		s.InvoiceBalance += row.InvoiceBalance
		s.ReceivableUncollected += row.ReceivableUncollected
	}
	return s
}

func filterSource(rows []sourceContract, keep func(sourceContract) bool) []sourceContract {
	result := make([]sourceContract, 0, len(rows))
	for _, row := range rows {
		if keep(row) {
			result = append(result, row)
		}
	}
	return result
}

func filterTarget(rows []targetContract, keep func(targetContract) bool) []targetContract {
	result := make([]targetContract, 0, len(rows))
	for _, row := range rows {
		if keep(row) {
			result = append(result, row)
		}
	}
	return result
}

func sourceStatusEffective(status string) bool {
	status = strings.TrimSpace(status)
	return status != "1" && status != "completed" && status != "done" && status != "2" && status != "terminated" && status != "cancelled" && status != "canceled"
}

func targetStatusEffective(status string) bool {
	switch strings.TrimSpace(status) {
	case "effective", "executing", "delivering", "accepted", "service_ended", "expired":
		return true
	default:
		return false
	}
}

func firstText(row map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(row[key]))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func firstNumber(row map[string]any, keys ...string) float64 {
	value, _ := firstNumberWithKey(row, keys...)
	return value
}

func firstNumberWithKey(row map[string]any, keys ...string) (float64, string) {
	for _, key := range keys {
		value := parseNumber(row[key])
		if value != 0 {
			return value, key
		}
	}
	return 0, ""
}

func parseNumber(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	case float64:
		return typed
	case []byte:
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(string(typed)), ",", ""), 64)
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", ""), 64)
		return parsed
	default:
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(value)), ",", ""), 64)
		return parsed
	}
}

func sortedKeys[T any](m map[string]T) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sumSourceUnreceived(rows []sourceContract) float64 {
	total := 0.0
	for _, row := range rows {
		total += row.Unreceived
	}
	return total
}

func sumTargetUnreceived(rows []targetContract) float64 {
	total := 0.0
	for _, row := range rows {
		total += row.Unreceived
	}
	return total
}

func sumDiff(rows []struct {
	Source sourceContract
	Target targetContract
	Diff   float64
}) float64 {
	total := 0.0
	for _, row := range rows {
		total += row.Diff
	}
	return total
}

func moneyPositive(value float64) bool {
	return value > 0.005
}

func money(value float64) string {
	if math.Abs(value) <= 0.005 {
		value = 0
	}
	return fmt.Sprintf("%.2f", value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func short(value string) string {
	value = strings.ReplaceAll(value, "\t", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	const maxRunes = 32
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "..."
}

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func printMap(label string, row map[string]any) {
	keys := sortedKeys(row)
	fmt.Println(label + ":")
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(row[key]))
		if value == "" || value == "<nil>" || value == "0" || value == "0.00" {
			continue
		}
		fmt.Printf("  %s=%s\n", key, value)
	}
}

func quoteIdent(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}

func questionPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func must(label string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", label, err)
		os.Exit(1)
	}
}
