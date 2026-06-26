package wizbiz

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const (
	sourceSystem             = "wizbizdb"
	migrationBy              = "wizbiz-incremental"
	fallbackContractOwnerUID = "zhouguangying"
)

var manualEmployeeUID = map[string]string{
	"365": "chenzhongzhong",
	"378": "zhouguangying",
	"408": "zhouguangying",
}

type DBConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	ConnectionLimit int
}

type Config struct {
	Source  DBConfig
	Altoc   DBConfig
	Finance DBConfig
}

type Options struct {
	Apply     bool
	BatchCode string
	Since     string
	Limit     int
	Targets   []string
}

type Result struct {
	BatchCode  string         `json:"batchCode"`
	Apply      bool           `json:"apply"`
	StartedAt  time.Time      `json:"startedAt"`
	FinishedAt time.Time      `json:"finishedAt"`
	Targets    []TargetResult `json:"targets"`
	Warnings   []string       `json:"warnings,omitempty"`
}

type TargetResult struct {
	Name        string   `json:"name"`
	SourceTable string   `json:"sourceTable"`
	TargetTable string   `json:"targetTable"`
	Scanned     int      `json:"scanned"`
	Inserted    int      `json:"inserted"`
	Updated     int      `json:"updated"`
	Skipped     int      `json:"skipped"`
	Warnings    []string `json:"warnings,omitempty"`
}

type migrator struct {
	cfg           Config
	opt           Options
	source        *sql.DB
	altoc         *sql.DB
	finance       *sql.DB
	sourceCols    map[string]map[string]bool
	targetCols    map[string]map[string]bool
	employeeUID   map[string]string
	customerRefs  map[string]entityRef
	contactRefs   map[string]entityRef
	contractRefs  map[string]entityRef
	bankRefs      map[string]entityRef
	archiveFiles  map[string]archiveFile
	refsPreloaded bool
}

type entityRef struct {
	ID           int64
	Code         string
	Name         string
	CustomerID   int64
	CustomerCode string
	CustomerName string
}

type archiveFile struct {
	URL      string
	Name     string
	MimeType string
}

type tableSpec struct {
	Name               string
	SourceTable        string
	TargetApp          string
	TargetTable        string
	SourceIDCandidates []string
	SinceCandidates    []string
	NaturalKey         []string
	InsertDefaults     map[string]any
	PreserveOnUpdate   []string
	Where              func(cols map[string]bool) (string, []any)
	Build              func(context.Context, *migrator, row) (map[string]any, string, error)
	After              func(context.Context, *migrator, *TargetResult) error
}

type row map[string]any

func Run(ctx context.Context, cfg Config, opt Options) (Result, error) {
	if opt.BatchCode == "" {
		opt.BatchCode = "MIG_INC_" + time.Now().Format("20060102150405")
	}
	if len(opt.Targets) == 0 {
		opt.Targets = DefaultTargets()
	}
	if err := validateConfig(cfg); err != nil {
		return Result{}, err
	}

	sourceDB, err := openDB(cfg.Source)
	if err != nil {
		return Result{}, fmt.Errorf("open source database: %w", err)
	}
	defer sourceDB.Close()

	altocDB, err := openDB(cfg.Altoc)
	if err != nil {
		return Result{}, fmt.Errorf("open altoc database: %w", err)
	}
	defer altocDB.Close()

	financeDB, err := openDB(cfg.Finance)
	if err != nil {
		return Result{}, fmt.Errorf("open finance database: %w", err)
	}
	defer financeDB.Close()

	for name, conn := range map[string]*sql.DB{
		"source":  sourceDB,
		"altoc":   altocDB,
		"finance": financeDB,
	} {
		if err := conn.PingContext(ctx); err != nil {
			return Result{}, fmt.Errorf("ping %s database: %w", name, err)
		}
	}

	m := &migrator{
		cfg:          cfg,
		opt:          opt,
		source:       sourceDB,
		altoc:        altocDB,
		finance:      financeDB,
		sourceCols:   map[string]map[string]bool{},
		targetCols:   map[string]map[string]bool{},
		employeeUID:  map[string]string{},
		customerRefs: map[string]entityRef{},
		contactRefs:  map[string]entityRef{},
		contractRefs: map[string]entityRef{},
		bankRefs:     map[string]entityRef{},
		archiveFiles: map[string]archiveFile{},
	}
	if err := m.preloadTargetRefs(ctx); err != nil {
		return Result{}, err
	}

	started := time.Now()
	result := Result{
		BatchCode: opt.BatchCode,
		Apply:     opt.Apply,
		StartedAt: started,
	}

	selected := selectedTargets(opt.Targets)
	for _, spec := range specs() {
		if !selected[spec.Name] {
			continue
		}
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=%s start", spec.Name)
		}
		targetResult, err := m.runTable(ctx, spec)
		result.Targets = append(result.Targets, targetResult)
		if err != nil {
			return result, err
		}
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=%s done scanned=%d insert=%d update=%d skip=%d", spec.Name, targetResult.Scanned, targetResult.Inserted, targetResult.Updated, targetResult.Skipped)
		}
	}

	if selected["contract-owners"] {
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=contract-owners start")
		}
		ownerResult, err := m.backfillContractOwners(ctx)
		result.Targets = append(result.Targets, ownerResult)
		if err != nil {
			return result, err
		}
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=contract-owners done scanned=%d update=%d skip=%d", ownerResult.Scanned, ownerResult.Updated, ownerResult.Skipped)
		}
	}

	if selected["finance-summary"] {
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=finance-summary start")
		}
		summaryResult, err := m.refreshFinanceContractSummary(ctx)
		result.Targets = append(result.Targets, summaryResult)
		if err != nil {
			return result, err
		}
		if opt.Apply {
			log.Printf("[wizbiz-incremental] target=finance-summary done scanned=%d update=%d", summaryResult.Scanned, summaryResult.Updated)
		}
	}

	result.FinishedAt = time.Now()
	return result, nil
}

func DefaultTargets() []string {
	return []string{
		"customers",
		"contacts",
		"contracts",
		"contract-owners",
		"bank-accounts",
		"account-balances",
		"invoices",
		"receipts",
		"unclassified-income",
		"expenses",
		"finance-summary",
	}
}

func validateConfig(cfg Config) error {
	missing := []string{}
	for label, db := range map[string]DBConfig{
		"source":  cfg.Source,
		"altoc":   cfg.Altoc,
		"finance": cfg.Finance,
	} {
		if strings.TrimSpace(db.Host) == "" {
			missing = append(missing, label+".host")
		}
		if strings.TrimSpace(db.User) == "" {
			missing = append(missing, label+".user")
		}
		if strings.TrimSpace(db.Database) == "" {
			missing = append(missing, label+".database")
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing database config: %s", strings.Join(missing, ", "))
	}
	return nil
}

func openDB(cfg DBConfig) (*sql.DB, error) {
	mysqlCfg := mysql.NewConfig()
	mysqlCfg.Net = "tcp"
	mysqlCfg.Addr = fmt.Sprintf("%s:%d", cfg.Host, cfgPort(cfg.Port))
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
	limit := cfg.ConnectionLimit
	if limit <= 0 {
		limit = 5
	}
	conn.SetMaxOpenConns(limit)
	conn.SetMaxIdleConns(limit)
	conn.SetConnMaxLifetime(30 * time.Minute)
	return conn, nil
}

func cfgPort(port int) int {
	if port <= 0 {
		return 3306
	}
	return port
}

func selectedTargets(targets []string) map[string]bool {
	selected := map[string]bool{}
	for _, target := range targets {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		if target == "all" {
			for _, name := range DefaultTargets() {
				selected[name] = true
			}
			return selected
		}
		selected[target] = true
	}
	return selected
}

func specs() []tableSpec {
	return []tableSpec{
		{
			Name:               "customers",
			SourceTable:        "wb_organization",
			TargetApp:          "altoc",
			TargetTable:        "customer",
			SourceIDCandidates: []string{"org_id", "id"},
			SinceCandidates:    []string{"operate_time", "update_time", "create_time", "started_at"},
			Where: func(cols map[string]bool) (string, []any) {
				if cols["org_type"] {
					return "(`org_type` IS NULL OR `org_type` = 1 OR `org_type` = '1')", nil
				}
				return "", nil
			},
			Build: buildCustomer,
			After: backfillCustomerParents,
		},
		{
			Name:               "contacts",
			SourceTable:        "wb_contactman",
			TargetApp:          "altoc",
			TargetTable:        "contact",
			SourceIDCandidates: []string{"contactman_id", "id"},
			SinceCandidates:    []string{"operate_time", "update_time", "create_time"},
			Build:              buildContact,
		},
		{
			Name:               "contracts",
			SourceTable:        "wb_contract",
			TargetApp:          "altoc",
			TargetTable:        "contract",
			SourceIDCandidates: []string{"contract_id", "id"},
			SinceCandidates:    []string{"operate_time", "update_time", "sign_date", "due_date"},
			InsertDefaults: map[string]any{
				"owner_user_id": fallbackContractOwnerUID,
			},
			PreserveOnUpdate: []string{
				"status",
				"legal_status",
				"fulfillment_status",
				"financial_status",
				"activation_status",
				"completed_at",
				"terminated_at",
				"last_status_changed_at",
				"last_status_changed_by",
			},
			Build: buildContract,
		},
		{
			Name:               "bank-accounts",
			SourceTable:        "wb_bank_account",
			TargetApp:          "finance",
			TargetTable:        "finance_bank_account",
			SourceIDCandidates: []string{"ba_id", "bank_account_id", "id"},
			SinceCandidates:    []string{"operate_time", "update_time", "opened_at"},
			Build:              buildBankAccount,
		},
		{
			Name:               "account-balances",
			SourceTable:        "wb_account_balance",
			TargetApp:          "finance",
			TargetTable:        "finance_account_balance_snapshot",
			SourceIDCandidates: []string{"ab_id", "balance_id", "id"},
			SinceCandidates:    []string{"check_date", "balance_date", "snapshot_date", "operate_time", "update_time"},
			NaturalKey:         []string{"bank_account_id", "snapshot_date", "source_type"},
			Build:              buildAccountBalance,
		},
		{
			Name:               "invoices",
			SourceTable:        "wb_invoice",
			TargetApp:          "finance",
			TargetTable:        "finance_invoice",
			SourceIDCandidates: []string{"invoice_id", "id"},
			SinceCandidates:    []string{"invoice_date", "operate_time", "update_time"},
			Build:              buildInvoice,
		},
		{
			Name:               "receipts",
			SourceTable:        "wb_project_income",
			TargetApp:          "finance",
			TargetTable:        "finance_receipt",
			SourceIDCandidates: []string{"pi_id", "income_id", "id"},
			SinceCandidates:    []string{"receipt_date", "income_date", "operate_time", "update_time"},
			Where: func(cols map[string]bool) (string, []any) {
				if cols["contract_id"] {
					return "`contract_id` IS NOT NULL AND `contract_id` <> 0", nil
				}
				return "", nil
			},
			Build: buildReceipt,
		},
		{
			Name:               "unclassified-income",
			SourceTable:        "wb_project_income",
			TargetApp:          "finance",
			TargetTable:        "finance_unclassified_income",
			SourceIDCandidates: []string{"pi_id", "income_id", "id"},
			SinceCandidates:    []string{"receipt_date", "income_date", "operate_time", "update_time"},
			Where: func(cols map[string]bool) (string, []any) {
				if cols["contract_id"] {
					return "(`contract_id` IS NULL OR `contract_id` = 0)", nil
				}
				return "", nil
			},
			Build: buildUnclassifiedIncome,
		},
		{
			Name:               "expenses",
			SourceTable:        "wb_project_payment",
			TargetApp:          "finance",
			TargetTable:        "finance_expense",
			SourceIDCandidates: []string{"pp_id", "payment_id", "id"},
			SinceCandidates:    []string{"payment_date", "expense_date", "operate_time", "update_time"},
			Build:              buildExpense,
		},
	}
}

func (m *migrator) runTable(ctx context.Context, spec tableSpec) (TargetResult, error) {
	result := TargetResult{
		Name:        spec.Name,
		SourceTable: spec.SourceTable,
		TargetTable: spec.TargetTable,
	}
	sourceCols, err := m.columns(ctx, m.source, m.cfg.Source.Database, spec.SourceTable, true)
	if err != nil {
		return result, err
	}
	if len(sourceCols) == 0 {
		result.Warnings = append(result.Warnings, "source table does not exist; skipped")
		return result, nil
	}
	targetDB, err := m.targetDB(spec.TargetApp)
	if err != nil {
		return result, err
	}
	targetDatabase, err := m.targetDatabase(spec.TargetApp)
	if err != nil {
		return result, err
	}
	targetCols, err := m.columns(ctx, targetDB, targetDatabase, spec.TargetTable, false)
	if err != nil {
		return result, err
	}
	if len(targetCols) == 0 {
		return result, fmt.Errorf("%s target table %s does not exist", spec.TargetApp, spec.TargetTable)
	}

	rows, err := m.querySource(ctx, spec, sourceCols)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return result, err
	}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return result, err
		}
		sourceRow := row{}
		for i, col := range cols {
			sourceRow[col] = normalizeDBValue(values[i])
		}
		result.Scanned++
		sourceID := sourceRow.Text(spec.SourceIDCandidates...)
		if sourceID == "" {
			result.Skipped++
			continue
		}

		transformed, skipReason, err := spec.Build(ctx, m, sourceRow)
		if err != nil {
			return result, fmt.Errorf("%s source id %s: %w", spec.Name, sourceID, err)
		}
		if skipReason != "" {
			result.Skipped++
			if len(result.Warnings) < 20 {
				result.Warnings = append(result.Warnings, sourceID+": "+skipReason)
			}
			continue
		}
		transformed["legacy_source"] = sourceSystem
		transformed["legacy_id"] = sourceID
		match := upsertMatch{
			SourceID: sourceID,
			Code:     cleanAny(transformed["code"]),
			Natural:  naturalKeyValues(spec.NaturalKey, transformed),
		}
		transformed = filterColumns(transformed, targetCols)

		action, targetID, err := m.upsert(ctx, targetDB, targetDatabase, spec.TargetTable, targetCols, transformed, match, spec.PreserveOnUpdate, spec.InsertDefaults)
		if err != nil {
			return result, fmt.Errorf("%s source id %s: %w", spec.Name, sourceID, err)
		}
		switch action {
		case "insert":
			result.Inserted++
		case "update":
			result.Updated++
		case "skip":
			result.Skipped++
		}
		if m.opt.Apply && result.Scanned%250 == 0 {
			log.Printf("[wizbiz-incremental] target=%s progress scanned=%d insert=%d update=%d skip=%d", spec.Name, result.Scanned, result.Inserted, result.Updated, result.Skipped)
		}
		if m.opt.Apply && targetID > 0 {
			if err := m.upsertMigrationMap(ctx, targetDB, targetDatabase, spec.TargetApp, spec.SourceTable, sourceID, spec.TargetTable, targetID, sourceRow, transformed); err != nil {
				return result, fmt.Errorf("%s source id %s migration map: %w", spec.Name, sourceID, err)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if spec.After != nil {
		if err := spec.After(ctx, m, &result); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (m *migrator) querySource(ctx context.Context, spec tableSpec, cols map[string]bool) (*sql.Rows, error) {
	where := []string{}
	args := []any{}
	if spec.Where != nil {
		clause, clauseArgs := spec.Where(cols)
		if strings.TrimSpace(clause) != "" {
			where = append(where, clause)
			args = append(args, clauseArgs...)
		}
	}
	if strings.TrimSpace(m.opt.Since) != "" {
		if sinceCol := firstExisting(cols, spec.SinceCandidates...); sinceCol != "" {
			where = append(where, quoteIdent(sinceCol)+" >= ?")
			args = append(args, m.opt.Since)
		}
	}

	query := "SELECT * FROM " + quoteIdent(spec.SourceTable)
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	if idCol := firstExisting(cols, spec.SourceIDCandidates...); idCol != "" {
		query += " ORDER BY " + quoteIdent(idCol)
	}
	if m.opt.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, m.opt.Limit)
	}
	return m.source.QueryContext(ctx, query, args...)
}

func (m *migrator) targetDB(app string) (*sql.DB, error) {
	switch app {
	case "altoc":
		return m.altoc, nil
	case "finance":
		return m.finance, nil
	default:
		return nil, fmt.Errorf("unsupported target app %q", app)
	}
}

func (m *migrator) targetDatabase(app string) (string, error) {
	switch app {
	case "altoc":
		return m.cfg.Altoc.Database, nil
	case "finance":
		return m.cfg.Finance.Database, nil
	default:
		return "", fmt.Errorf("unsupported target app %q", app)
	}
}

func (m *migrator) columns(ctx context.Context, conn *sql.DB, database string, table string, source bool) (map[string]bool, error) {
	cache := m.targetCols
	if source {
		cache = m.sourceCols
	}
	key := database + "." + table
	if cols, ok := cache[key]; ok {
		return cols, nil
	}
	rows, err := conn.QueryContext(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = ?
		  AND table_name = ?
	`, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	cache[key] = cols
	return cols, nil
}

type upsertMatch struct {
	SourceID string
	Code     string
	Natural  map[string]any
}

func (m *migrator) upsert(ctx context.Context, conn *sql.DB, database string, table string, cols map[string]bool, values map[string]any, match upsertMatch, preserveOnUpdate []string, insertDefaults map[string]any) (string, int64, error) {
	if !m.opt.Apply {
		if len(upsertKeyKinds(cols, match)) == 0 {
			return "skip", 0, errors.New("target table has no usable idempotent key: need legacy_source+legacy_id or code")
		}
		return "insert", 0, nil
	}

	existingID, err := existingTargetID(ctx, conn, table, cols, match)
	if err != nil {
		return "skip", 0, err
	}

	if existingID > 0 {
		updateKeys := sortedUpdateKeys(values, preserveOnUpdate)
		filtered := updateKeys[:0]
		for _, key := range updateKeys {
			if cols[key] {
				filtered = append(filtered, key)
			}
		}
		if len(filtered) == 0 {
			return "skip", existingID, nil
		}
		set := make([]string, 0, len(filtered))
		args := make([]any, 0, len(filtered)+1)
		for _, key := range filtered {
			set = append(set, quoteIdent(key)+" = ?")
			args = append(args, values[key])
		}
		args = append(args, existingID)
		query := "UPDATE " + quoteIdent(table) + " SET " + strings.Join(set, ", ") + " WHERE id = ?"
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			return "skip", existingID, err
		}
		return "update", existingID, nil
	}

	insertValues := valuesWithInsertDefaults(values, insertDefaults)
	insertKeys := sortedInsertKeys(insertValues)
	filtered := insertKeys[:0]
	for _, key := range insertKeys {
		if cols[key] {
			filtered = append(filtered, key)
		}
	}
	if len(filtered) == 0 {
		return "skip", 0, errors.New("no insertable target columns")
	}
	placeholders := make([]string, len(filtered))
	args := make([]any, len(filtered))
	for i, key := range filtered {
		placeholders[i] = "?"
		args[i] = insertValues[key]
	}
	query := "INSERT INTO " + quoteIdent(table) + " (" + quoteJoin(filtered) + ") VALUES (" + strings.Join(placeholders, ", ") + ")"
	res, err := conn.ExecContext(ctx, query, args...)
	if err != nil {
		return "skip", 0, err
	}
	id, _ := res.LastInsertId()
	return "insert", id, nil
}

func valuesWithInsertDefaults(values map[string]any, defaults map[string]any) map[string]any {
	if len(defaults) == 0 {
		return values
	}
	out := make(map[string]any, len(values)+len(defaults))
	for key, value := range values {
		out[key] = value
	}
	for key, value := range defaults {
		if cleanAny(out[key]) == "" {
			out[key] = value
		}
	}
	return out
}

func existingTargetID(ctx context.Context, conn *sql.DB, table string, cols map[string]bool, match upsertMatch) (int64, error) {
	for _, key := range upsertKeyKinds(cols, match) {
		var id int64
		var err error
		switch key {
		case "legacy":
			err = conn.QueryRowContext(ctx,
				"SELECT id FROM "+quoteIdent(table)+" WHERE legacy_source = ? AND legacy_id = ? LIMIT 1",
				sourceSystem,
				match.SourceID,
			).Scan(&id)
		case "code":
			err = conn.QueryRowContext(ctx,
				"SELECT id FROM "+quoteIdent(table)+" WHERE code = ? LIMIT 1",
				match.Code,
			).Scan(&id)
		case "natural":
			clause := make([]string, 0, len(match.Natural))
			args := make([]any, 0, len(match.Natural))
			for _, field := range sortedNaturalKeys(match.Natural) {
				clause = append(clause, quoteIdent(field)+" <=> ?")
				args = append(args, match.Natural[field])
			}
			err = conn.QueryRowContext(ctx,
				"SELECT id FROM "+quoteIdent(table)+" WHERE "+strings.Join(clause, " AND ")+" LIMIT 1",
				args...,
			).Scan(&id)
		}
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return 0, err
		}
		return id, nil
	}
	if len(upsertKeyKinds(cols, match)) == 0 {
		return 0, errors.New("target table has no usable idempotent key: need legacy_source+legacy_id or code")
	}
	return 0, nil
}

func upsertKeyKinds(cols map[string]bool, match upsertMatch) []string {
	kinds := []string{}
	if cols["legacy_source"] && cols["legacy_id"] && strings.TrimSpace(match.SourceID) != "" {
		kinds = append(kinds, "legacy")
	}
	if cols["code"] && strings.TrimSpace(match.Code) != "" {
		kinds = append(kinds, "code")
	}
	if naturalKeyUsable(cols, match.Natural) {
		kinds = append(kinds, "natural")
	}
	return kinds
}

func naturalKeyValues(fields []string, values map[string]any) map[string]any {
	if len(fields) == 0 {
		return nil
	}
	natural := make(map[string]any, len(fields))
	for _, field := range fields {
		value, ok := values[field]
		if !ok || cleanAny(value) == "" {
			return nil
		}
		natural[field] = value
	}
	return natural
}

func naturalKeyUsable(cols map[string]bool, natural map[string]any) bool {
	if len(natural) == 0 {
		return false
	}
	for field, value := range natural {
		if !cols[field] || cleanAny(value) == "" {
			return false
		}
	}
	return true
}

func sortedNaturalKeys(natural map[string]any) []string {
	keys := make([]string, 0, len(natural))
	for key := range natural {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (m *migrator) upsertMigrationMap(ctx context.Context, conn *sql.DB, database string, app string, sourceTable string, sourceID string, targetTable string, targetID int64, sourceRow row, transformed map[string]any) error {
	mapTable := "finance_migration_map"
	if app == "altoc" {
		mapTable = "legacy_migration_map"
	}
	cols, err := m.columns(ctx, conn, database, mapTable, false)
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}
	sourceJSON := jsonString(sourceRow)
	transformJSON := jsonString(transformed)
	hash := sha256.Sum256([]byte(sourceJSON))
	values := map[string]any{
		"batch_code":              m.opt.BatchCode,
		"source_system":           sourceSystem,
		"source_table":            sourceTable,
		"source_id":               sourceID,
		"target_table":            targetTable,
		"target_id":               targetID,
		"source_hash":             hex.EncodeToString(hash[:]),
		"source_snapshot_json":    sourceJSON,
		"transform_snapshot_json": transformJSON,
		"migrated_at":             nowDateTime(),
		"note":                    "incremental migration",
	}
	values = filterColumns(values, cols)

	keys := sortedInsertKeys(values)
	placeholders := make([]string, len(keys))
	args := make([]any, len(keys))
	for i, key := range keys {
		placeholders[i] = "?"
		args[i] = values[key]
	}
	updates := []string{
		"batch_code = VALUES(batch_code)",
		"target_table = VALUES(target_table)",
		"target_id = VALUES(target_id)",
		"source_hash = VALUES(source_hash)",
		"migrated_at = VALUES(migrated_at)",
	}
	if cols["source_snapshot_json"] {
		updates = append(updates, "source_snapshot_json = VALUES(source_snapshot_json)")
	}
	if cols["transform_snapshot_json"] {
		updates = append(updates, "transform_snapshot_json = VALUES(transform_snapshot_json)")
	}
	if cols["note"] {
		updates = append(updates, "note = VALUES(note)")
	}
	query := "INSERT INTO " + quoteIdent(mapTable) + " (" + quoteJoin(keys) + ") VALUES (" + strings.Join(placeholders, ", ") + ") ON DUPLICATE KEY UPDATE " + strings.Join(updates, ", ")
	_, err = conn.ExecContext(ctx, query, args...)
	return err
}

func sortedInsertKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedUpdateKeys(values map[string]any, preserveOnUpdate []string) []string {
	blocked := map[string]bool{
		"id":            true,
		"code":          true,
		"legacy_source": true,
		"legacy_id":     true,
		"created_at":    true,
		"created_by":    true,
	}
	for _, key := range preserveOnUpdate {
		blocked[key] = true
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		if !blocked[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func filterColumns(values map[string]any, cols map[string]bool) map[string]any {
	out := map[string]any{}
	for key, value := range values {
		if cols[key] {
			out[key] = value
		}
	}
	return out
}

func buildCustomer(_ context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("org_id", "id")
	name := r.Text("org_name", "organization_name", "name")
	if name == "" {
		return nil, "missing organization name", nil
	}
	status := "active"
	if r.Text("org_status", "status") == "1" {
		status = "archived"
	}
	owner := m.employeeUIDFromRow(r, "employee_id")
	operator := m.employeeUIDFromRow(r, "operator_id")
	if owner == "" {
		owner = "system"
	}
	if operator == "" {
		operator = owner
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = nowDateTime()
	}
	stats := sourceRefs(r, "org_type", "parent_id", "employee_id", "contract_count", "contract_amount", "receivable_amount", "received_amount")
	return map[string]any{
		"code":                       "CUMIG" + id,
		"name":                       name,
		"normalized_name":            normalizeName(name),
		"unified_social_credit_code": nullString(r.Text("unified_social_credit_code", "credit_code", "taxpayer_no")),
		"short_name":                 nullString(r.Text("short_name", "org_short_name")),
		"source_type":                "legacy_oa",
		"status":                     status,
		"owner_user_id":              owner,
		"website":                    nullString(r.Text("web_site", "website")),
		"telephone":                  nullString(r.Text("telephone", "phone")),
		"province":                   nullString(r.Text("province")),
		"city":                       nullString(r.Text("city")),
		"wechat_official_account":    nullString(r.Text("weixin_number", "wechat_official_account")),
		"started_at":                 nullString(r.Date("start_date", "started_at")),
		"address":                    nullString(r.Text("address")),
		"description":                nullString(r.Text("description")),
		"is_partner":                 boolInt(r.Text("org_type") == "2" || r.Text("org_type") == "3"),
		"legacy_stats_json":          jsonString(stats),
		"remark":                     nullString(r.Text("remarks", "remark")),
		"created_by":                 operator,
		"updated_by":                 operator,
		"created_at":                 createdAt,
		"updated_at":                 createdAt,
		"deleted_at":                 nil,
	}, "", nil
}

func (m *migrator) preloadTargetRefs(ctx context.Context) error {
	if err := m.preloadCustomers(ctx); err != nil {
		return err
	}
	if err := m.preloadContacts(ctx); err != nil {
		return err
	}
	if err := m.preloadContracts(ctx); err != nil {
		return err
	}
	if err := m.preloadBankAccounts(ctx); err != nil {
		return err
	}
	m.refsPreloaded = true
	return nil
}

func (m *migrator) preloadCustomers(ctx context.Context) error {
	cols, err := m.columns(ctx, m.altoc, m.cfg.Altoc.Database, "customer", false)
	if err != nil || len(cols) == 0 {
		return err
	}
	legacyExpr := "NULL"
	if cols["legacy_id"] {
		legacyExpr = "legacy_id"
	}
	query := "SELECT id, code, name, " + legacyExpr + " FROM customer"
	if cols["deleted_at"] {
		query += " WHERE deleted_at IS NULL"
	}
	rows, err := m.altoc.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ref entityRef
		var legacy sql.NullString
		if err := rows.Scan(&ref.ID, &ref.Code, &ref.Name, &legacy); err != nil {
			return err
		}
		if legacy.String != "" {
			m.customerRefs[strings.TrimSpace(legacy.String)] = ref
		}
		if sourceID := suffixAfterPrefix(ref.Code, "CUMIG"); sourceID != "" {
			m.customerRefs[sourceID] = ref
		}
	}
	return rows.Err()
}

func (m *migrator) preloadContacts(ctx context.Context) error {
	cols, err := m.columns(ctx, m.altoc, m.cfg.Altoc.Database, "contact", false)
	if err != nil || len(cols) == 0 || !cols["legacy_id"] {
		return err
	}
	query := "SELECT id, customer_id, name, legacy_id FROM contact"
	if cols["deleted_at"] {
		query += " WHERE deleted_at IS NULL"
	}
	rows, err := m.altoc.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ref entityRef
		var legacy sql.NullString
		if err := rows.Scan(&ref.ID, &ref.CustomerID, &ref.Name, &legacy); err != nil {
			return err
		}
		if legacy.String != "" {
			m.contactRefs[strings.TrimSpace(legacy.String)] = ref
		}
	}
	return rows.Err()
}

func (m *migrator) preloadContracts(ctx context.Context) error {
	cols, err := m.columns(ctx, m.altoc, m.cfg.Altoc.Database, "contract", false)
	if err != nil || len(cols) == 0 {
		return err
	}
	legacyExpr := "NULL"
	if cols["legacy_id"] {
		legacyExpr = "ct.legacy_id"
	}
	query := `
		SELECT ct.id, ct.code, ct.name, ` + legacyExpr + `, cu.id, cu.code, cu.name
		FROM contract ct
		INNER JOIN customer cu ON cu.id = ct.customer_id`
	if cols["deleted_at"] {
		query += " WHERE ct.deleted_at IS NULL"
	}
	rows, err := m.altoc.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ref entityRef
		var legacy sql.NullString
		if err := rows.Scan(&ref.ID, &ref.Code, &ref.Name, &legacy, &ref.CustomerID, &ref.CustomerCode, &ref.CustomerName); err != nil {
			return err
		}
		if legacy.String != "" {
			m.contractRefs[strings.TrimSpace(legacy.String)] = ref
		}
		if sourceID := suffixAfterPrefix(ref.Code, "CTMIG"); sourceID != "" {
			m.contractRefs[sourceID] = ref
		}
	}
	return rows.Err()
}

func (m *migrator) preloadBankAccounts(ctx context.Context) error {
	cols, err := m.columns(ctx, m.finance, m.cfg.Finance.Database, "finance_bank_account", false)
	if err != nil || len(cols) == 0 {
		return err
	}
	legacyExpr := "NULL"
	if cols["legacy_id"] {
		legacyExpr = "legacy_id"
	}
	query := "SELECT id, code, account_name, " + legacyExpr + " FROM finance_bank_account"
	if cols["deleted_at"] {
		query += " WHERE deleted_at IS NULL"
	}
	rows, err := m.finance.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ref entityRef
		var legacy sql.NullString
		if err := rows.Scan(&ref.ID, &ref.Code, &ref.Name, &legacy); err != nil {
			return err
		}
		if legacy.String != "" {
			m.bankRefs[strings.TrimSpace(legacy.String)] = ref
		}
		if sourceID := suffixAfterPrefix(ref.Code, "BA-WB-"); sourceID != "" {
			m.bankRefs[sourceID] = ref
		}
	}
	return rows.Err()
}

func buildContact(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	customerSourceID := r.Text("org_id", "customer_id")
	customer, ok, err := m.lookupCustomer(ctx, customerSourceID)
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "unmapped customer " + customerSourceID, nil
	}
	name := r.Text("cm_name", "contact_name", "name")
	if name == "" {
		return nil, "missing contact name", nil
	}
	owner := m.employeeUIDFromRow(r, "employee_id")
	operator := m.employeeUIDFromRow(r, "operator_id")
	if owner == "" {
		owner = "system"
	}
	if operator == "" {
		operator = owner
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = nowDateTime()
	}
	return map[string]any{
		"customer_id":       customer.ID,
		"name":              name,
		"gender":            0,
		"dept_name":         nullString(r.Text("department", "dept_name")),
		"job_title":         nullString(r.Text("post", "job_title")),
		"mobile":            nullString(r.Text("mobile")),
		"normalized_mobile": nullString(normalizePhone(r.Text("mobile"))),
		"alternate_mobile":  nullString(r.Text("mobile2", "alternate_mobile")),
		"phone":             nullString(r.Text("phone")),
		"email":             nullString(strings.ToLower(r.Text("email"))),
		"normalized_email":  nullString(strings.ToLower(r.Text("email"))),
		"wechat":            nullString(r.Text("weixin_number", "wechat")),
		"mailing_address":   nullString(r.Text("address", "mailing_address")),
		"star_level":        r.NullableInt("stars", "star_level"),
		"is_key_contact":    0,
		"status":            "active",
		"owner_user_id":     nullString(owner),
		"remark":            nullString(r.Text("remarks", "remark")),
		"created_by":        operator,
		"updated_by":        operator,
		"created_at":        createdAt,
		"updated_at":        createdAt,
		"deleted_at":        nil,
	}, "", nil
}

func buildContract(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("contract_id", "id")
	customerSourceID := r.Text("customer_id", "org_id")
	customer, ok, err := m.lookupCustomer(ctx, customerSourceID)
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "unmapped customer " + customerSourceID, nil
	}

	var contactID any
	if contactSourceID := r.Text("contactman_id", "contact_id"); contactSourceID != "" {
		if contact, ok, err := m.lookupContact(ctx, contactSourceID); err != nil {
			return nil, "", err
		} else if ok {
			contactID = contact.ID
		}
	}
	var thirdPartyID any
	if thirdPartySourceID := r.Text("third_party_id"); thirdPartySourceID != "" {
		if thirdParty, ok, err := m.lookupCustomer(ctx, thirdPartySourceID); err != nil {
			return nil, "", err
		} else if ok {
			thirdPartyID = thirdParty.ID
		}
	}

	name := r.Text("contract_name", "name")
	if name == "" {
		name = "OA合同" + id
	}
	status, legalStatus, fulfillmentStatus, activationStatus := contractStatuses(r.Text("contract_status", "status"))
	owner := m.contractOwnerUIDFromRow(r)
	operator := m.employeeUIDFromRow(r, "operator_id")
	if operator == "" {
		operator = firstNonEmpty(owner, migrationBy)
	}
	signDate := r.Date("sign_date", "signed_at")
	endDate := r.Date("due_date", "end_date")
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = nowDateTime()
	}
	refs := sourceRefs(r, "project_id", "impl_project_id", "company_id", "ba_id", "system_id", "old_id", "contract_code", "third_party_id")
	values := map[string]any{
		"code":                    "CTMIG" + id,
		"contract_no":             nullString(r.Text("contract_code", "contract_no")),
		"name":                    name,
		"customer_id":             customer.ID,
		"contact_id":              contactID,
		"status":                  status,
		"legal_status":            legalStatus,
		"fulfillment_status":      fulfillmentStatus,
		"financial_status":        contractFinancialStatus(r),
		"activation_status":       activationStatus,
		"direction":               "sales",
		"primary_type":            "legacy_contract",
		"agreement_form":          "standard_contract",
		"source_type":             "legacy_oa",
		"source_code":             nullString(r.Text("contract_code")),
		"sign_date":               nullString(signDate),
		"effective_date":          nullString(signDate),
		"end_date":                nullString(endDate),
		"amount_tax_inclusive":    r.NullableDecimal("total_amount", "amount", "contract_amount"),
		"prime_amount":            r.NullableDecimal("prime_amount"),
		"invoiced_amount":         r.NullableDecimal("invoice_amount", "invoiced_amount"),
		"executed_amount":         r.NullableDecimal("exec_amount", "executed_amount", "received_amount"),
		"currency_code":           "CNY",
		"payment_term_summary":    nullString(r.Text("payment", "payment_term", "payment_terms")),
		"source_contract_type":    nullString(r.Text("contract_type", "source_contract_type")),
		"is_third_party":          boolInt(r.Text("is_third_party") == "1" || thirdPartyID != nil),
		"third_party_customer_id": thirdPartyID,
		"content_summary":         nullString(r.Text("description")),
		"service_terms":           nullString(r.Text("tos", "service_terms")),
		"legacy_refs_json":        jsonString(refs),
		"last_status_changed_at":  createdAt,
		"last_status_changed_by":  operator,
		"remark":                  nullString(r.Text("remarks", "remark")),
		"created_by":              operator,
		"updated_by":              operator,
		"created_at":              createdAt,
		"updated_at":              createdAt,
		"deleted_at":              nil,
	}
	values["owner_user_id"] = owner
	if status == "completed" {
		values["completed_at"] = nullString(dateToDateTime(endDate, createdAt))
	}
	if status == "terminated" {
		values["terminated_at"] = nullString(dateToDateTime(endDate, createdAt))
	}
	return values, "", nil
}

func buildBankAccount(_ context.Context, _ *migrator, r row) (map[string]any, string, error) {
	id := r.Text("ba_id", "bank_account_id", "id")
	name := r.Text("ba_name", "account_name", "account_title", "name")
	bank := r.Text("bank_name", "bank")
	accountNo := r.Text("account_no", "ba_account", "account_number", "bank_account")
	if name == "" {
		name = bank
	}
	if name == "" {
		name = "OA银行账户" + id
	}
	status := "active"
	if r.Text("ba_status", "status") == "1" {
		status = "inactive"
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = nowDateTime()
	}
	return map[string]any{
		"code":              "BA-WB-" + id,
		"account_name":      name,
		"bank_name":         nullString(bank),
		"account_no_masked": nullString(maskAccountNo(accountNo)),
		"account_type":      "bank",
		"currency_code":     "CNY",
		"status":            status,
		"remark":            nullString(r.Text("remarks", "remark")),
		"created_by":        migrationBy,
		"updated_by":        migrationBy,
		"created_at":        createdAt,
		"updated_at":        createdAt,
		"deleted_at":        nil,
	}, "", nil
}

func buildAccountBalance(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	bankSourceID := r.Text("ba_id", "bank_account_id")
	bank, ok, err := m.lookupBankAccount(ctx, bankSourceID)
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "unmapped bank account " + bankSourceID, nil
	}
	snapshotDate := accountBalanceSnapshotDate(r)
	if snapshotDate == "" {
		return nil, "missing snapshot date", nil
	}
	amount := r.NullableDecimal("balance_amount", "balance", "amount")
	if amount == nil {
		return nil, "missing balance amount", nil
	}
	return map[string]any{
		"bank_account_id": bank.ID,
		"snapshot_date":   snapshotDate,
		"balance_amount":  amount,
		"currency_code":   "CNY",
		"source_type":     "migration",
		"created_by":      migrationBy,
		"created_at":      nullString(r.DateTime("operate_time", "create_time", "created_at")),
	}, "", nil
}

func accountBalanceSnapshotDate(r row) string {
	return firstNonEmpty(r.Date("check_date", "balance_date", "snapshot_date"), r.Date("operate_time"))
}

func buildInvoice(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("invoice_id", "id")
	amount := r.NullableDecimal("amount", "invoice_amount")
	if amount == nil {
		return nil, "missing invoice amount", nil
	}
	contract, _ := m.optionalContract(ctx, r.Text("contract_id"))
	customerCode := contract.CustomerCode
	customerName := contract.CustomerName
	if customerCode == "" {
		customerCode = nullStringValue(r.Text("customer_code"))
		customerName = nullStringValue(r.Text("customer_name", "receiver"))
	}
	file := archiveFile{}
	if apID := r.Text("ap_id"); apID != "" {
		file, _ = m.lookupArchiveFile(ctx, apID)
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = nowDateTime()
	}
	refs := sourceRefs(r, "project_id", "company_id", "contract_id", "ap_id", "oldcontract_id", "oldinvoice_id")
	if file.URL != "" {
		refs["file_url"] = file.URL
	}
	return map[string]any{
		"code":                   "INVMIG" + id,
		"invoice_no":             nullString(r.Text("invoice_code", "invoice_no", "code")),
		"customer_code":          nullString(customerCode),
		"customer_name":          nullString(customerName),
		"contract_code":          nullString(contract.Code),
		"project_code":           nil,
		"invoice_type":           nullString(normalizeInvoiceType(r.Text("invoice_type", "type"))),
		"invoice_medium":         "electronic",
		"invoice_item":           nullString(r.Text("item", "invoice_item", "content")),
		"invoice_amount":         amount,
		"invoice_date":           nullString(r.Date("invoice_date", "operate_time")),
		"status":                 "issued",
		"taxpayer_name":          nullString(r.Text("taxpayer_name", "receiver")),
		"taxpayer_no":            nullString(r.Text("taxpayer_no")),
		"receiver_name":          nullString(r.Text("receiver", "receiver_name")),
		"invoice_file_url":       nullString(file.URL),
		"invoice_file_name":      nullString(file.Name),
		"invoice_file_mime_type": nullString(file.MimeType),
		"invoice_file_size":      nil,
		"source_refs_json":       jsonString(refs),
		"remark":                 nullString(r.Text("remarks", "remark")),
		"created_by":             migrationBy,
		"updated_by":             migrationBy,
		"created_at":             createdAt,
		"updated_at":             createdAt,
		"deleted_at":             nil,
	}, "", nil
}

func buildReceipt(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("pi_id", "income_id", "id")
	contract, ok, err := m.lookupContract(ctx, r.Text("contract_id"))
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "unmapped contract " + r.Text("contract_id"), nil
	}
	amount := r.NullableDecimal("amount", "received_amount")
	if amount == nil {
		return nil, "missing received amount", nil
	}
	bankID := any(nil)
	if bank, ok, err := m.lookupBankAccount(ctx, r.Text("ba_id", "bank_account_id")); err != nil {
		return nil, "", err
	} else if ok {
		bankID = bank.ID
	}
	receivedAt := firstNonEmpty(r.Date("receipt_date", "income_date", "received_at"), r.Date("operate_time"))
	if receivedAt == "" {
		receivedAt = time.Now().Format("2006-01-02")
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = receivedAt + " 00:00:00"
	}
	refs := sourceRefs(r, "project_id", "contract_id", "ba_id", "income_type", "pp_id", "operator_id", "oldpayment_id")
	return map[string]any{
		"code":                   "RECMIG" + id,
		"receipt_no":             nullString(r.Text("pi_code", "receipt_no", "code")),
		"customer_code":          nullString(contract.CustomerCode),
		"customer_name":          nullString(contract.CustomerName),
		"contract_code":          contract.Code,
		"project_code":           nil,
		"receipt_source_type":    "contract",
		"accounting_object_type": "contract",
		"accounting_object_code": contract.Code,
		"bank_account_id":        bankID,
		"received_amount":        amount,
		"reconciled_amount":      "0.00",
		"unreconciled_amount":    amount,
		"received_at":            receivedAt,
		"channel":                nullString(normalizeChannel(r.Text("channel"))),
		"payer_name":             nullString(r.Text("payer", "payer_name")),
		"handler_user_id":        nullString(m.employeeUIDFromRow(r, "employee_id")),
		"status":                 "confirmed",
		"source_refs_json":       jsonString(refs),
		"note":                   nullString(r.Text("matter", "description", "remarks", "remark")),
		"confirmed_by":           migrationBy,
		"confirmed_at":           createdAt,
		"created_by":             migrationBy,
		"updated_by":             migrationBy,
		"created_at":             createdAt,
		"updated_at":             createdAt,
		"deleted_at":             nil,
	}, "", nil
}

func buildUnclassifiedIncome(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("pi_id", "income_id", "id")
	amount := r.NullableDecimal("amount", "received_amount")
	if amount == nil {
		return nil, "missing income amount", nil
	}
	bankID := any(nil)
	if bank, ok, err := m.lookupBankAccount(ctx, r.Text("ba_id", "bank_account_id")); err != nil {
		return nil, "", err
	} else if ok {
		bankID = bank.ID
	}
	receivedAt := firstNonEmpty(r.Date("receipt_date", "income_date", "received_at"), r.Date("operate_time"))
	if receivedAt == "" {
		receivedAt = time.Now().Format("2006-01-02")
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = receivedAt + " 00:00:00"
	}
	refs := sourceRefs(r, "project_id", "company_id", "ba_id", "income_type", "pp_id", "operator_id", "oldpayment_id")
	return map[string]any{
		"code":                   "UCI-WB-" + id,
		"income_order_code":      nullString(r.Text("pi_code", "income_order_code", "code")),
		"project_legacy_id":      r.NullableInt("project_id"),
		"receipt_source_type":    "no_contract",
		"accounting_object_type": "legacy_project",
		"accounting_object_code": nullString(r.Text("project_id")),
		"bank_account_id":        bankID,
		"received_at":            receivedAt,
		"amount":                 amount,
		"channel":                nullString(normalizeChannel(r.Text("channel"))),
		"payer_name":             nullString(r.Text("payer", "payer_name")),
		"handler_user_id":        nullString(m.employeeUIDFromRow(r, "employee_id")),
		"description":            nullString(r.Text("matter", "description", "remarks", "remark")),
		"resolution_status":      "pending",
		"source_refs_json":       jsonString(refs),
		"created_by":             migrationBy,
		"updated_by":             migrationBy,
		"created_at":             createdAt,
		"updated_at":             createdAt,
	}, "", nil
}

func buildExpense(ctx context.Context, m *migrator, r row) (map[string]any, string, error) {
	id := r.Text("pp_id", "payment_id", "id")
	amount := r.NullableDecimal("amount", "payment_amount", "expense_amount")
	if amount == nil {
		return nil, "missing expense amount", nil
	}
	contract, _ := m.optionalContract(ctx, r.Text("contract_id"))
	bankID := any(nil)
	if bank, ok, err := m.lookupBankAccount(ctx, r.Text("ba_id", "bank_account_id")); err != nil {
		return nil, "", err
	} else if ok {
		bankID = bank.ID
	}
	expenseDate := firstNonEmpty(r.Date("payment_date", "expense_date", "paid_at"), r.Date("operate_time"))
	if expenseDate == "" {
		expenseDate = time.Now().Format("2006-01-02")
	}
	createdAt := r.DateTime("operate_time", "create_time", "created_at")
	if createdAt == "" {
		createdAt = expenseDate + " 00:00:00"
	}
	refs := sourceRefs(r, "project_id", "contract_id", "ba_id", "payment_type", "approval_id", "operator_id", "oldpayment_id")
	return map[string]any{
		"code":                   "EXPMIG" + id,
		"expense_date":           expenseDate,
		"expense_amount":         amount,
		"fee_amount":             coalesceDecimal(r.NullableDecimal("fee", "fee_amount"), "0.00"),
		"currency_code":          "CNY",
		"bank_account_id":        bankID,
		"project_code":           nil,
		"contract_code":          nullString(contract.Code),
		"customer_code":          nullString(contract.CustomerCode),
		"accounting_object_type": nullString(accountingObjectType(contract.Code, r.Text("project_id"))),
		"accounting_object_code": nullString(firstNonEmpty(contract.Code, r.Text("project_id"))),
		"handler_user_id":        nullString(m.employeeUIDFromRow(r, "employee_id")),
		"payee_name":             nullString(r.Text("payee", "payee_name", "receiver")),
		"payee_account_masked":   nullString(maskAccountNo(r.Text("payee_account", "account_no"))),
		"payee_bank":             nullString(r.Text("payee_bank", "bank_name")),
		"payment_channel":        nullString(normalizeChannel(r.Text("channel"))),
		"source_request_type":    "migration",
		"source_request_code":    nullString(r.Text("approval_code", "request_code", "pp_code", "code")),
		"status":                 "confirmed",
		"description":            nullString(r.Text("matter", "description", "remarks", "remark")),
		"source_refs_json":       jsonString(refs),
		"created_by":             migrationBy,
		"updated_by":             migrationBy,
		"created_at":             createdAt,
		"updated_at":             createdAt,
		"deleted_at":             nil,
	}, "", nil
}

func backfillCustomerParents(ctx context.Context, m *migrator, result *TargetResult) error {
	if !m.opt.Apply || result.Scanned == 0 {
		return nil
	}
	_, err := m.altoc.ExecContext(ctx, `
		UPDATE customer child
		INNER JOIN customer parent
		   ON parent.legacy_source = 'wizbizdb'
		  AND CAST(parent.legacy_id AS CHAR) = JSON_UNQUOTE(JSON_EXTRACT(child.legacy_stats_json, '$.parent_id'))
		  AND parent.deleted_at IS NULL
		SET child.parent_customer_id = parent.id,
		    child.updated_at = CURRENT_TIMESTAMP
		WHERE child.legacy_source = 'wizbizdb'
		  AND child.deleted_at IS NULL
		  AND JSON_EXTRACT(child.legacy_stats_json, '$.parent_id') IS NOT NULL
	`)
	return err
}

func (m *migrator) backfillContractOwners(ctx context.Context) (TargetResult, error) {
	result := TargetResult{
		Name:        "contract-owners",
		SourceTable: "wb_contract",
		TargetTable: "contract.owner_user_id",
	}
	sourceCols, err := m.columns(ctx, m.source, m.cfg.Source.Database, "wb_contract", true)
	if err != nil {
		return result, err
	}
	if len(sourceCols) == 0 {
		result.Warnings = append(result.Warnings, "source table does not exist; skipped")
		return result, nil
	}
	if !sourceCols["employee_id"] {
		result.Warnings = append(result.Warnings, "source employee_id column does not exist; skipped")
		return result, nil
	}
	targetCols, err := m.columns(ctx, m.altoc, m.cfg.Altoc.Database, "contract", false)
	if err != nil {
		return result, err
	}
	if len(targetCols) == 0 {
		return result, fmt.Errorf("altoc target table contract does not exist")
	}
	if !targetCols["owner_user_id"] {
		return result, fmt.Errorf("altoc target table contract has no owner_user_id column")
	}
	if !targetCols["code"] && !(targetCols["legacy_source"] && targetCols["legacy_id"]) {
		return result, fmt.Errorf("altoc target table contract has no usable legacy/code key")
	}
	badSourceIDs, err := m.badContractOwnerSourceIDs(ctx, targetCols)
	if err != nil {
		return result, err
	}

	querySpec := tableSpec{
		Name:               "contract-owners",
		SourceTable:        "wb_contract",
		SourceIDCandidates: []string{"contract_id", "id"},
		SinceCandidates:    []string{"operate_time", "update_time", "sign_date", "due_date"},
	}
	rows, err := m.querySource(ctx, querySpec, sourceCols)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return result, err
	}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return result, err
		}
		sourceRow := row{}
		for i, col := range cols {
			sourceRow[col] = normalizeDBValue(values[i])
		}
		result.Scanned++
		sourceID := sourceRow.Text(querySpec.SourceIDCandidates...)
		if sourceID == "" {
			result.Skipped++
			continue
		}
		if !badSourceIDs[sourceID] {
			result.Skipped++
			continue
		}
		owner := m.contractOwnerUIDFromRow(sourceRow)
		if owner == "" {
			result.Skipped++
			if len(result.Warnings) < 20 {
				result.Warnings = append(result.Warnings, sourceID+": unmapped employee "+sourceRow.Text("employee_id"))
			}
			continue
		}
		if !m.opt.Apply {
			result.Updated++
			continue
		}
		affected, err := m.updateContractOwner(ctx, targetCols, sourceID, owner)
		if err != nil {
			return result, fmt.Errorf("contract-owners source id %s: %w", sourceID, err)
		}
		if affected > 0 {
			result.Updated += affected
		} else {
			result.Skipped++
		}
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func (m *migrator) badContractOwnerSourceIDs(ctx context.Context, cols map[string]bool) (map[string]bool, error) {
	selectCols := []string{}
	if cols["legacy_source"] && cols["legacy_id"] {
		selectCols = append(selectCols, "legacy_source", "legacy_id")
	}
	if cols["code"] {
		selectCols = append(selectCols, "code")
	}
	where := []string{"(owner_user_id IS NULL OR owner_user_id = '' OR owner_user_id = 'system' OR owner_user_id REGEXP '^[0-9]+$')"}
	if cols["deleted_at"] {
		where = append(where, "deleted_at IS NULL")
	}
	query := "SELECT " + quoteJoin(selectCols) + " FROM contract WHERE " + strings.Join(where, " AND ")
	rows, err := m.altoc.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	names, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	sourceIDs := map[string]bool{}
	for rows.Next() {
		values := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		targetRow := row{}
		for i, name := range names {
			targetRow[name] = normalizeDBValue(values[i])
		}
		sourceID := ""
		if targetRow.Text("legacy_source") == sourceSystem {
			sourceID = targetRow.Text("legacy_id")
		}
		if sourceID == "" {
			sourceID = suffixAfterPrefix(targetRow.Text("code"), "CTMIG")
		}
		if sourceID != "" {
			sourceIDs[sourceID] = true
		}
	}
	return sourceIDs, rows.Err()
}

func (m *migrator) updateContractOwner(ctx context.Context, cols map[string]bool, sourceID string, owner string) (int, error) {
	set := []string{"owner_user_id = ?"}
	args := []any{owner}
	if cols["updated_by"] {
		set = append(set, "updated_by = ?")
		args = append(args, migrationBy)
	}
	if cols["updated_at"] {
		set = append(set, "updated_at = CURRENT_TIMESTAMP")
	}

	keys := []string{}
	keyArgs := []any{}
	if cols["legacy_source"] && cols["legacy_id"] {
		keys = append(keys, "(legacy_source = ? AND legacy_id = ?)")
		keyArgs = append(keyArgs, sourceSystem, sourceID)
	}
	if cols["code"] {
		keys = append(keys, "code = ?")
		keyArgs = append(keyArgs, "CTMIG"+sourceID)
	}
	where := []string{"(" + strings.Join(keys, " OR ") + ")"}
	args = append(args, keyArgs...)
	if cols["deleted_at"] {
		where = append(where, "deleted_at IS NULL")
	}
	where = append(where, "(owner_user_id IS NULL OR owner_user_id = '' OR owner_user_id = 'system' OR owner_user_id REGEXP '^[0-9]+$')")
	query := "UPDATE contract SET " + strings.Join(set, ", ") + " WHERE " + strings.Join(where, " AND ")
	res, err := m.altoc.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

func (m *migrator) refreshFinanceContractSummary(ctx context.Context) (TargetResult, error) {
	result := TargetResult{
		Name:        "finance-summary",
		SourceTable: "finance_invoice/finance_receipt/finance_reconciliation",
		TargetTable: "finance_contract_summary",
	}
	query := `
		SELECT COUNT(*) FROM (
		  SELECT contract_code FROM finance_invoice
		   WHERE deleted_at IS NULL AND legacy_source = 'wizbizdb' AND contract_code IS NOT NULL AND contract_code <> ''
		  UNION
		  SELECT contract_code FROM finance_receipt
		   WHERE deleted_at IS NULL AND legacy_source = 'wizbizdb' AND contract_code IS NOT NULL AND contract_code <> ''
		) seed
	`
	if err := m.finance.QueryRowContext(ctx, query).Scan(&result.Scanned); err != nil {
		return result, err
	}
	if !m.opt.Apply || result.Scanned == 0 {
		result.Updated = result.Scanned
		return result, nil
	}
	res, err := m.finance.ExecContext(ctx, `
		INSERT INTO finance_contract_summary (
		  contract_code,
		  customer_code,
		  project_code,
		  invoice_amount,
		  received_amount,
		  reconciled_amount,
		  unreceived_amount,
		  unreconciled_amount,
		  invoice_count,
		  receipt_count,
		  latest_invoice_date,
		  latest_received_at,
		  calculated_at
		)
		SELECT
		  seed.contract_code,
		  COALESCE(invoice.customer_code, receipt.customer_code) AS customer_code,
		  COALESCE(invoice.project_code, receipt.project_code) AS project_code,
		  COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
		  COALESCE(receipt.received_amount, 0) AS received_amount,
		  COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
		  GREATEST(COALESCE(invoice.invoice_amount, 0) - COALESCE(receipt.received_amount, 0), 0) AS unreceived_amount,
		  GREATEST(COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0), 0) AS unreconciled_amount,
		  COALESCE(invoice.invoice_count, 0) AS invoice_count,
		  COALESCE(receipt.receipt_count, 0) AS receipt_count,
		  invoice.latest_invoice_date,
		  receipt.latest_received_at,
		  NOW() AS calculated_at
		FROM (
		  SELECT contract_code FROM finance_invoice
		   WHERE deleted_at IS NULL AND legacy_source = 'wizbizdb' AND contract_code IS NOT NULL AND contract_code <> ''
		  UNION
		  SELECT contract_code FROM finance_receipt
		   WHERE deleted_at IS NULL AND legacy_source = 'wizbizdb' AND contract_code IS NOT NULL AND contract_code <> ''
		) seed
		LEFT JOIN (
		  SELECT contract_code,
		         MAX(customer_code) AS customer_code,
		         MAX(project_code) AS project_code,
		         SUM(invoice_amount) AS invoice_amount,
		         COUNT(*) AS invoice_count,
		         MAX(invoice_date) AS latest_invoice_date
		    FROM finance_invoice
		   WHERE deleted_at IS NULL
		     AND status <> 'canceled'
		     AND contract_code IS NOT NULL
		     AND contract_code <> ''
		   GROUP BY contract_code
		) invoice ON invoice.contract_code = seed.contract_code
		LEFT JOIN (
		  SELECT contract_code,
		         MAX(customer_code) AS customer_code,
		         MAX(project_code) AS project_code,
		         SUM(received_amount) AS received_amount,
		         COUNT(*) AS receipt_count,
		         MAX(received_at) AS latest_received_at
		    FROM finance_receipt
		   WHERE deleted_at IS NULL
		     AND status <> 'canceled'
		     AND contract_code IS NOT NULL
		     AND contract_code <> ''
		   GROUP BY contract_code
		) receipt ON receipt.contract_code = seed.contract_code
		LEFT JOIN (
		  SELECT contract_code,
		         SUM(reconciled_amount) AS reconciled_amount
		    FROM finance_reconciliation
		   WHERE status = 'active'
		     AND contract_code IS NOT NULL
		     AND contract_code <> ''
		   GROUP BY contract_code
		) reconciliation ON reconciliation.contract_code = seed.contract_code
		ON DUPLICATE KEY UPDATE
		  customer_code = VALUES(customer_code),
		  project_code = VALUES(project_code),
		  invoice_amount = VALUES(invoice_amount),
		  received_amount = VALUES(received_amount),
		  reconciled_amount = VALUES(reconciled_amount),
		  unreceived_amount = VALUES(unreceived_amount),
		  unreconciled_amount = VALUES(unreconciled_amount),
		  invoice_count = VALUES(invoice_count),
		  receipt_count = VALUES(receipt_count),
		  latest_invoice_date = VALUES(latest_invoice_date),
		  latest_received_at = VALUES(latest_received_at),
		  calculated_at = NOW()
	`)
	if err != nil {
		return result, err
	}
	affected, _ := res.RowsAffected()
	result.Updated = int(affected)
	return result, nil
}

func (m *migrator) lookupCustomer(ctx context.Context, sourceID string) (entityRef, bool, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || sourceID == "0" {
		return entityRef{}, false, nil
	}
	if ref, ok := m.customerRefs[sourceID]; ok {
		return ref, ref.ID > 0, nil
	}
	if m.refsPreloaded && !m.opt.Apply {
		return entityRef{}, false, nil
	}
	var ref entityRef
	err := m.altoc.QueryRowContext(ctx, `
		SELECT id, code, name
		FROM customer
		WHERE legacy_source = 'wizbizdb'
		  AND legacy_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, sourceID).Scan(&ref.ID, &ref.Code, &ref.Name)
	if errors.Is(err, sql.ErrNoRows) {
		err = m.altoc.QueryRowContext(ctx, `
			SELECT id, code, name
			FROM customer
			WHERE code = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, "CUMIG"+sourceID).Scan(&ref.ID, &ref.Code, &ref.Name)
	}
	if errors.Is(err, sql.ErrNoRows) {
		m.customerRefs[sourceID] = entityRef{}
		return entityRef{}, false, nil
	}
	if err != nil {
		return entityRef{}, false, err
	}
	m.customerRefs[sourceID] = ref
	return ref, true, nil
}

func (m *migrator) lookupContact(ctx context.Context, sourceID string) (entityRef, bool, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || sourceID == "0" {
		return entityRef{}, false, nil
	}
	if ref, ok := m.contactRefs[sourceID]; ok {
		return ref, ref.ID > 0, nil
	}
	if m.refsPreloaded && !m.opt.Apply {
		return entityRef{}, false, nil
	}
	var ref entityRef
	err := m.altoc.QueryRowContext(ctx, `
		SELECT id, CAST(customer_id AS CHAR), name
		FROM contact
		WHERE legacy_source = 'wizbizdb'
		  AND legacy_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, sourceID).Scan(&ref.ID, &ref.CustomerCode, &ref.Name)
	if errors.Is(err, sql.ErrNoRows) {
		m.contactRefs[sourceID] = entityRef{}
		return entityRef{}, false, nil
	}
	if err != nil {
		return entityRef{}, false, err
	}
	m.contactRefs[sourceID] = ref
	return ref, true, nil
}

func (m *migrator) lookupContract(ctx context.Context, sourceID string) (entityRef, bool, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || sourceID == "0" {
		return entityRef{}, false, nil
	}
	if ref, ok := m.contractRefs[sourceID]; ok {
		return ref, ref.ID > 0, nil
	}
	if m.refsPreloaded && !m.opt.Apply {
		return entityRef{}, false, nil
	}
	var ref entityRef
	err := m.altoc.QueryRowContext(ctx, `
		SELECT ct.id, ct.code, ct.name, cu.id, cu.code, cu.name
		FROM contract ct
		INNER JOIN customer cu ON cu.id = ct.customer_id
		WHERE ct.legacy_source = 'wizbizdb'
		  AND ct.legacy_id = ?
		  AND ct.deleted_at IS NULL
		LIMIT 1
	`, sourceID).Scan(&ref.ID, &ref.Code, &ref.Name, &ref.CustomerID, &ref.CustomerCode, &ref.CustomerName)
	if errors.Is(err, sql.ErrNoRows) {
		err = m.altoc.QueryRowContext(ctx, `
			SELECT ct.id, ct.code, ct.name, cu.id, cu.code, cu.name
			FROM contract ct
			INNER JOIN customer cu ON cu.id = ct.customer_id
			WHERE ct.code = ?
			  AND ct.deleted_at IS NULL
			LIMIT 1
		`, "CTMIG"+sourceID).Scan(&ref.ID, &ref.Code, &ref.Name, &ref.CustomerID, &ref.CustomerCode, &ref.CustomerName)
	}
	if errors.Is(err, sql.ErrNoRows) {
		m.contractRefs[sourceID] = entityRef{}
		return entityRef{}, false, nil
	}
	if err != nil {
		return entityRef{}, false, err
	}
	m.contractRefs[sourceID] = ref
	return ref, true, nil
}

func (m *migrator) optionalContract(ctx context.Context, sourceID string) (entityRef, error) {
	if sourceID == "" || sourceID == "0" {
		return entityRef{}, nil
	}
	ref, ok, err := m.lookupContract(ctx, sourceID)
	if err != nil || !ok {
		return entityRef{}, err
	}
	return ref, nil
}

func (m *migrator) lookupBankAccount(ctx context.Context, sourceID string) (entityRef, bool, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || sourceID == "0" {
		return entityRef{}, false, nil
	}
	if ref, ok := m.bankRefs[sourceID]; ok {
		return ref, ref.ID > 0, nil
	}
	if m.refsPreloaded && !m.opt.Apply {
		return entityRef{}, false, nil
	}
	var ref entityRef
	err := m.finance.QueryRowContext(ctx, `
		SELECT id, code, account_name
		FROM finance_bank_account
		WHERE legacy_source = 'wizbizdb'
		  AND legacy_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, sourceID).Scan(&ref.ID, &ref.Code, &ref.Name)
	if errors.Is(err, sql.ErrNoRows) {
		m.bankRefs[sourceID] = entityRef{}
		return entityRef{}, false, nil
	}
	if err != nil {
		return entityRef{}, false, err
	}
	m.bankRefs[sourceID] = ref
	return ref, true, nil
}

func (m *migrator) lookupArchiveFile(ctx context.Context, apID string) (archiveFile, bool) {
	apID = strings.TrimSpace(apID)
	if apID == "" {
		return archiveFile{}, false
	}
	if file, ok := m.archiveFiles[apID]; ok {
		return file, file.URL != ""
	}
	cols, err := m.columns(ctx, m.source, m.cfg.Source.Database, "wb_archives_page", true)
	if err != nil || len(cols) == 0 {
		m.archiveFiles[apID] = archiveFile{}
		return archiveFile{}, false
	}
	if !cols["ap_id"] || !cols["ap_url"] {
		m.archiveFiles[apID] = archiveFile{}
		return archiveFile{}, false
	}
	var url sql.NullString
	var name sql.NullString
	query := "SELECT ap_url"
	if cols["ap_name"] {
		query += ", ap_name"
	} else {
		query += ", NULL"
	}
	query += " FROM wb_archives_page WHERE ap_id = ?"
	if cols["ap_status"] {
		query += " AND COALESCE(ap_status, '0') <> '1'"
	}
	query += " LIMIT 1"
	err = m.source.QueryRowContext(ctx, query, apID).Scan(&url, &name)
	if err != nil {
		m.archiveFiles[apID] = archiveFile{}
		return archiveFile{}, false
	}
	file := archiveFile{
		URL:      strings.TrimSpace(url.String),
		Name:     archiveFileName(name.String, url.String),
		MimeType: archiveMimeType(url.String),
	}
	m.archiveFiles[apID] = file
	return file, file.URL != ""
}

func (m *migrator) employeeUIDFromRow(r row, key string) string {
	return m.lookupEmployeeUID(r.Text(key))
}

func (m *migrator) contractOwnerUIDFromRow(r row) string {
	return firstNonEmpty(m.employeeUIDFromRow(r, "employee_id"), fallbackContractOwnerUID)
}

func (m *migrator) lookupEmployeeUID(employeeID string) string {
	employeeID = strings.TrimSpace(employeeID)
	if employeeID == "" || employeeID == "0" {
		return ""
	}
	if uid := strings.TrimSpace(manualEmployeeUID[employeeID]); uid != "" {
		m.employeeUID[employeeID] = uid
		return uid
	}
	if uid, ok := m.employeeUID[employeeID]; ok {
		return uid
	}
	var uid string
	err := m.source.QueryRow(`
		SELECT su.user_name
		FROM wb_employee e
		INNER JOIN sys_user su ON su.user_id = e.user_id
		WHERE e.employee_id = ?
		  AND su.user_name IS NOT NULL
		  AND su.user_name <> ''
		LIMIT 1
	`, employeeID).Scan(&uid)
	if err != nil {
		m.employeeUID[employeeID] = ""
		return ""
	}
	uid = strings.TrimSpace(uid)
	m.employeeUID[employeeID] = uid
	return uid
}

func contractStatuses(sourceStatus string) (string, string, string, string) {
	switch strings.TrimSpace(sourceStatus) {
	case "1", "completed", "done":
		return "completed", "closed", "fulfilled", "completed"
	case "2", "terminated", "cancelled", "canceled":
		return "terminated", "terminated", "cancelled", "cancelled"
	default:
		return "effective", "effective", "in_progress", "not_planned"
	}
}

func contractFinancialStatus(r row) string {
	total := decimalFloat(r.Text("total_amount", "amount", "contract_amount"))
	invoiced := decimalFloat(r.Text("invoice_amount", "invoiced_amount"))
	received := decimalFloat(r.Text("exec_amount", "executed_amount", "received_amount"))
	if total > 0 && received >= total {
		return "received"
	}
	if received > 0 {
		return "partially_received"
	}
	if total > 0 && invoiced >= total {
		return "invoiced"
	}
	if invoiced > 0 {
		return "partially_invoiced"
	}
	return "unplanned"
}

func normalizeInvoiceType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "special_vat", "special", "zhuanpiao", "专票", "1":
		return "special_vat"
	case "general_vat", "normal", "putong", "普票", "2":
		return "general_vat"
	case "electronic", "电子", "3":
		return "electronic"
	case "":
		return ""
	default:
		return value
	}
}

func normalizeChannel(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "cash", "现金", "1":
		return "cash"
	case "bank", "bank_transfer", "transfer", "银行", "转账", "2":
		return "bank_transfer"
	case "third_party", "alipay", "wechat", "支付宝", "微信", "3":
		return "third_party"
	case "":
		return ""
	default:
		return "other"
	}
}

func accountingObjectType(contractCode string, projectID string) string {
	if contractCode != "" {
		return "contract"
	}
	if projectID != "" {
		return "legacy_project"
	}
	return ""
}

func (r row) Text(candidates ...string) string {
	for _, key := range candidates {
		if value, ok := r[key]; ok {
			text := cleanAny(value)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func (r row) Date(candidates ...string) string {
	for _, key := range candidates {
		text := r.Text(key)
		if text == "" {
			continue
		}
		return normalizeDate(text)
	}
	return ""
}

func (r row) DateTime(candidates ...string) string {
	for _, key := range candidates {
		text := r.Text(key)
		if text == "" {
			continue
		}
		return normalizeDateTime(text)
	}
	return ""
}

func (r row) NullableDecimal(candidates ...string) any {
	text := r.Text(candidates...)
	if text == "" {
		return nil
	}
	text = strings.ReplaceAll(text, ",", "")
	if _, err := strconv.ParseFloat(text, 64); err != nil {
		return nil
	}
	return text
}

func (r row) NullableInt(candidates ...string) any {
	text := r.Text(candidates...)
	if text == "" {
		return nil
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return nil
	}
	return value
}

func normalizeDBValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(v)
	case time.Time:
		return v.Format("2006-01-02 15:04:05")
	default:
		return v
	}
}

func cleanAny(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case []byte:
		return strings.TrimSpace(string(v))
	case time.Time:
		return v.Format("2006-01-02 15:04:05")
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func nullString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullStringValue(value string) string {
	return strings.TrimSpace(value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func coalesceDecimal(value any, fallback string) any {
	if value == nil {
		return fallback
	}
	return value
}

func sourceRefs(r row, keys ...string) map[string]any {
	refs := map[string]any{}
	for _, key := range keys {
		if value := r.Text(key); value != "" {
			refs[key] = value
		}
	}
	return refs
}

func jsonString(value any) string {
	content, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(content)
}

func nowDateTime() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

func normalizeName(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), "")
}

func normalizePhone(value string) string {
	replacer := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "")
	return replacer.Replace(strings.TrimSpace(value))
}

func normalizeDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func normalizeDateTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) >= 19 {
		return value[:19]
	}
	if len(value) == 10 {
		return value + " 00:00:00"
	}
	return value
}

func dateToDateTime(date string, fallback string) string {
	date = normalizeDate(date)
	if date != "" {
		return date + " 00:00:00"
	}
	return fallback
}

func decimalFloat(value string) float64 {
	value = strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if value == "" {
		return 0
	}
	parsed, _ := strconv.ParseFloat(value, 64)
	return parsed
}

func maskAccountNo(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) <= 8 {
		return value
	}
	return value[:4] + strings.Repeat("*", len(value)-8) + value[len(value)-4:]
}

func archiveFileName(name string, url string) string {
	name = strings.TrimSpace(name)
	ext := ""
	cleanURL := strings.Split(strings.TrimSpace(url), "?")[0]
	if idx := strings.LastIndex(cleanURL, "."); idx >= 0 {
		ext = cleanURL[idx:]
	}
	if name != "" {
		if ext != "" && !strings.HasSuffix(strings.ToLower(name), strings.ToLower(ext)) {
			return name + ext
		}
		return name
	}
	if cleanURL == "" {
		return ""
	}
	parts := strings.Split(cleanURL, "/")
	return parts[len(parts)-1]
}

func archiveMimeType(url string) string {
	lower := strings.ToLower(strings.Split(strings.TrimSpace(url), "?")[0])
	switch {
	case strings.HasSuffix(lower, ".ofd"):
		return "application/ofd"
	case strings.HasSuffix(lower, ".pdf"):
		return "application/pdf"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	default:
		return ""
	}
}

func firstExisting(cols map[string]bool, candidates ...string) string {
	for _, candidate := range candidates {
		if cols[candidate] {
			return candidate
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func suffixAfterPrefix(value string, prefix string) string {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, prefix) {
		return ""
	}
	suffix := strings.TrimSpace(strings.TrimPrefix(value, prefix))
	if suffix == "" {
		return ""
	}
	if _, err := strconv.ParseInt(suffix, 10, 64); err != nil {
		return ""
	}
	return suffix
}

func quoteIdent(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}

func quoteJoin(keys []string) string {
	quoted := make([]string, len(keys))
	for i, key := range keys {
		quoted[i] = quoteIdent(key)
	}
	return strings.Join(quoted, ", ")
}
