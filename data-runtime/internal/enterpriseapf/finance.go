package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// FinanceInput is a closed command, not a generic table mutation.
type FinanceInput struct {
	AsOfDate            string         `json:"asOfDate,omitempty"`
	StaleBefore         string         `json:"staleBefore,omitempty"`
	BalanceState        string         `json:"balanceState,omitempty"`
	CurrencyCode        string         `json:"currencyCode,omitempty"`
	LegalEntityCode     string         `json:"legalEntityCode,omitempty"`
	AccountType         string         `json:"accountType,omitempty"`
	Complete            bool           `json:"complete,omitempty"`
	AccountCountAllowed bool           `json:"accountCountAllowed,omitempty"`
	Code                string         `json:"code"`
	Page                int            `json:"page"`
	PageSize            int            `json:"pageSize"`
	Search              string         `json:"search"`
	Status              string         `json:"status"`
	AccountCode         string         `json:"accountCode"`
	StartDate           string         `json:"startDate"`
	EndDate             string         `json:"endDate"`
	Payload             map[string]any `json:"payload"`
}

func FinanceIntent(i FinanceInput) []any {
	keys := make([]string, 0, len(i.Payload))
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]any, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, []any{k, i.Payload[k]})
	}
	fields := []any{i.Code, i.Page, i.PageSize, i.Search, i.Status, i.AccountCode, i.StartDate, i.EndDate, pairs}
	if i.AccountCountAllowed {
		fields = append(fields, []any{"accountCountAllowed", true})
	}
	for _, f := range []struct {
		key   string
		value any
		set   bool
	}{{"legalEntityCode", i.LegalEntityCode, i.LegalEntityCode != ""}, {"accountType", i.AccountType, i.AccountType != ""}, {"complete", true, i.Complete}, {"asOfDate", i.AsOfDate, i.AsOfDate != ""}, {"staleBefore", i.StaleBefore, i.StaleBefore != ""}, {"balanceState", i.BalanceState, i.BalanceState != ""}, {"currencyCode", i.CurrencyCode, i.CurrencyCode != ""}} {
		if f.set {
			fields = append(fields, []any{f.key, f.value})
		}
	}
	return fields
}
func FinancePermission(op string) (string, string, bool) {
	if r, a, ok := FinanceApprovalPermission(op); ok {
		return r, a, ok
	}
	if r, a, ok := FinanceLedgerPermission(op); ok {
		return r, a, ok
	}
	switch op {
	case "accounts-list", "accounts-view", "balances-list", "balance-entries-list":
		return "bank_accounts", "view", true
	// Registering the day's balance is routine cashier work; it does not need
	// (and does not grant) account administration.
	case "balance-entries-create":
		return "bank_accounts", "edit", true
	case "accounts-create", "accounts-update":
		return "bank_accounts", "admin", true
	// Sensitive: neither admin nor edit implies it.
	case accountNoRevealOperation:
		return "bank_accounts", "reveal-account-no", true
	case "legal-entities-list", "legal-entities-view":
		return "legal_entities", "view", true
	case "legal-entities-create", "legal-entities-update":
		return "legal_entities", "edit", true
	case "parameters-list", "parameters-view", "parameters-history", "parameters-create", "parameters-update":
		return "settings", "admin", true
	}
	return "", "", false
}

var financeCode = regexp.MustCompile(`^[A-Za-z0-9_-]{1,50}$`)
var currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)

func financeInvalid() error {
	return httperror.New(400, "finance_input_invalid", "Invalid Finance input")
}
func stringValue(v any, max int, nullable bool) bool {
	if v == nil {
		return nullable
	}
	s, ok := v.(string)
	if !ok || len([]rune(s)) > max || strings.TrimSpace(s) != s {
		return false
	}
	for _, c := range s {
		if c < 32 || c == 127 {
			return false
		}
	}
	return nullable || s != ""
}
func dateValid(s string) bool {
	d, e := time.Parse("2006-01-02", s)
	return e == nil && d.Format("2006-01-02") == s
}
func decimalValid(v any, precision, scale int) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	return regexp.MustCompile(fmt.Sprintf(`^(0|[1-9][0-9]{0,%d})(\.[0-9]{1,%d})?$`, precision-scale-1, scale)).MatchString(s)
}
func ValidateFinanceInput(op string, i FinanceInput) error {
	if i.AsOfDate != "" || i.StaleBefore != "" || i.BalanceState != "" || i.CurrencyCode != "" {
		if op != "accounts-list" || !dateValid(i.AsOfDate) || i.Complete || i.StaleBefore != "" && (!dateValid(i.StaleBefore) || i.StaleBefore > i.AsOfDate) || i.BalanceState != "" && !map[string]bool{"known": true, "missing": true, "stale": true, "conflict": true}[i.BalanceState] || i.BalanceState == "stale" && i.StaleBefore == "" || i.CurrencyCode != "" && !regexp.MustCompile(`^[A-Z]{3}$`).MatchString(i.CurrencyCode) {
			return financeInvalid()
		}
	}
	if i.LegalEntityCode != "" && ((op != "accounts-list" && op != "balances-list") || !financeCode.MatchString(i.LegalEntityCode)) || i.AccountType != "" && (op != "accounts-list" || !map[string]bool{"bank": true, "third_party": true, "cash": true, "internal": true}[i.AccountType]) || i.Complete && (op != "accounts-list" || i.Page != 1) {
		return financeInvalid()
	}
	if i.AccountCountAllowed && op != "legal-entities-list" && op != "legal-entities-view" {
		return financeInvalid()
	}
	if _, _, ok := FinanceApprovalPermission(op); ok {
		return ValidateFinanceApprovalInput(op, i)
	}
	if _, _, ok := FinanceLedgerPermission(op); ok {
		return ValidateFinanceLedgerInput(op, i)
	}
	if _, _, ok := FinancePermission(op); !ok {
		return financeInvalid()
	}
	if op == accountNoRevealOperation {
		return validateAccountNoReveal(i)
	}
	if strings.HasPrefix(op, "balance-entries-") {
		return validateBalanceEntryInput(op, i)
	}
	list := strings.HasSuffix(op, "-list") || op == "parameters-history"
	write := strings.HasSuffix(op, "-create") || strings.HasSuffix(op, "-update")
	if list {
		if i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || !stringValue(i.Search, 200, true) {
			return financeInvalid()
		}
	} else if i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" {
		return financeInvalid()
	}
	if strings.HasSuffix(op, "-view") || strings.HasSuffix(op, "-update") || op == "parameters-history" {
		if !financeCode.MatchString(i.Code) {
			return financeInvalid()
		}
	} else if i.Code != "" {
		return financeInvalid()
	}
	if i.Status != "" {
		valid := i.Status == "active" || i.Status == "inactive" || (op == "accounts-list" && i.Status == "closed")
		if !valid || op == "balances-list" || op == "parameters-history" {
			return financeInvalid()
		}
	}
	if op == "balances-list" {
		if i.AccountCode != "" && !financeCode.MatchString(i.AccountCode) {
			return financeInvalid()
		}
		if i.StartDate != "" && !dateValid(i.StartDate) || i.EndDate != "" && !dateValid(i.EndDate) || i.StartDate != "" && i.EndDate != "" && i.StartDate > i.EndDate {
			return financeInvalid()
		}
	} else if i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if op == "parameters-history" && i.Search != "" {
		return financeInvalid()
	}
	if !write {
		if len(i.Payload) != 0 {
			return financeInvalid()
		}
		return nil
	}
	if len(i.Payload) == 0 {
		return financeInvalid()
	}
	account := strings.HasPrefix(op, "accounts-")
	entity := strings.HasPrefix(op, "legal-entities-")
	allowed := map[string]bool{}
	fields := []string{"name", "effectiveFrom", "effectiveTo", "baseSalary", "welfareCostRate", "managementAllocationRate", "resourceAllocationCost", "currencyCode", "status", "remark"}
	if account {
		fields = []string{"accountName", "bankName", "accountNoMasked", "accountNoSecretRef", "accountType", "currencyCode", "ownerDeptCode", "status", "shortName", "bankBranchCode", "legalEntityCode", "sortNo", "accountSubtype"}
	}
	if entity {
		fields = []string{"name", "shortName", "unifiedSocialCreditCode", "entityType", "registeredAddress", "invoiceTitle", "invoiceTaxNo", "status", "sortNo", "remark"}
	}
	for _, k := range fields {
		allowed[k] = true
	}
	update := strings.HasSuffix(op, "-update")
	if update {
		allowed["expectedVersion"] = true
	}
	for k, v := range i.Payload {
		if !allowed[k] {
			return financeInvalid()
		}
		switch k {
		case "expectedVersion":
			n, ok := v.(float64)
			if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "baseSalary", "resourceAllocationCost":
			if !decimalValid(v, 18, 2) {
				return financeInvalid()
			}
		case "welfareCostRate", "managementAllocationRate":
			if !decimalValid(v, 10, 4) {
				return financeInvalid()
			}
		case "effectiveFrom":
			s, ok := v.(string)
			if !ok || !dateValid(s) {
				return financeInvalid()
			}
		case "effectiveTo":
			if v != nil {
				s, ok := v.(string)
				if !ok || !dateValid(s) {
					return financeInvalid()
				}
			}
		case "currencyCode":
			s, ok := v.(string)
			if !ok || !currencyCode.MatchString(s) {
				return financeInvalid()
			}
		case "status":
			if v != "active" && v != "inactive" && (!account || v != "closed") {
				return financeInvalid()
			}
		case "accountType":
			if v != "bank" && v != "cash" && v != "third_party" && v != "internal" {
				return financeInvalid()
			}
		case "accountNoSecretRef":
			if v != nil {
				s, ok := v.(string)
				if !ok || !regexp.MustCompile(`^[A-Za-z0-9_:/.-]{1,200}$`).MatchString(s) || strings.Contains(s, "..") {
					return financeInvalid()
				}
			}
		case "accountNoMasked":
			if !stringValue(v, 100, true) {
				return financeInvalid()
			}
			if s, ok := v.(string); ok && regexp.MustCompile(`[0-9]{8,}`).MatchString(s) {
				return financeInvalid()
			}
		case "ownerDeptCode":
			if v != nil {
				s, ok := v.(string)
				if !ok || !regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(s) {
					return financeInvalid()
				}
			}
		case "accountName", "name":
			if !stringValue(v, map[bool]int{true: 200, false: 100}[account || entity], false) {
				return financeInvalid()
			}
		case "shortName":
			if !stringValue(v, map[bool]int{true: 100, false: 50}[entity], true) || v == "" {
				return financeInvalid()
			}
		case "bankBranchCode":
			if s, ok := v.(string); v != nil && (!ok || !regexp.MustCompile(`^[A-Za-z0-9-]{1,30}$`).MatchString(s)) {
				return financeInvalid()
			}
		case "legalEntityCode":
			if s, ok := v.(string); v != nil && (!ok || !financeCode.MatchString(s)) {
				return financeInvalid()
			}
		case "sortNo":
			n, ok := v.(float64)
			if !ok || n < 0 || n > 1000000 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "accountSubtype":
			if v != nil && v != "basic" && v != "general" && v != "special" && v != "loan" {
				return financeInvalid()
			}
		case "entityType":
			if v != "company" && v != "branch" && v != "other" {
				return financeInvalid()
			}
		case "unifiedSocialCreditCode", "invoiceTaxNo":
			if s, ok := v.(string); v != nil && (!ok || !regexp.MustCompile(`^[A-Za-z0-9]{1,50}$`).MatchString(s)) {
				return financeInvalid()
			}
		case "registeredAddress":
			if !stringValue(v, 500, true) {
				return financeInvalid()
			}
		case "invoiceTitle":
			if !stringValue(v, 200, true) {
				return financeInvalid()
			}
		case "bankName":
			if !stringValue(v, 200, true) {
				return financeInvalid()
			}
		case "remark":
			if !stringValue(v, 500, true) {
				return financeInvalid()
			}
		}
	}
	if update {
		if i.Payload["expectedVersion"] == nil || len(i.Payload) < 2 {
			return financeInvalid()
		}
	}
	required := []string{"name", "effectiveFrom", "effectiveTo", "baseSalary", "welfareCostRate", "managementAllocationRate", "resourceAllocationCost", "currencyCode", "status", "remark"}
	if account {
		required = []string{"accountName", "bankName", "accountNoMasked", "accountType", "currencyCode", "ownerDeptCode"}
	}
	if entity {
		required = []string{"name"}
	}
	if !update || !account && !entity {
		for _, k := range required {
			if _, ok := i.Payload[k]; !ok {
				return financeInvalid()
			}
		}
	}
	if !update && (account || entity) {
		if _, ok := i.Payload["status"]; ok {
			return financeInvalid()
		}
	}
	return nil
}

// Present only after the reviewed column subset; never assumed.
var bankW1Columns = []string{"short_name", "bank_branch_code", "legal_entity_code", "sort_no", "account_subtype"}
var legalEntityColumns = []string{"id", "code", "name", "short_name", "unified_social_credit_code", "entity_type", "registered_address", "invoice_title", "invoice_tax_no", "status", "sort_no", "remark", "row_version"}
var bankColumns = []string{"id", "code", "account_name", "bank_name", "account_no_masked", "account_type", "currency_code", "owner_dept_code", "status", "row_version"}
var parameterColumns = []string{"id", "code", "name", "effective_from", "effective_to", "base_salary", "welfare_cost_rate", "management_allocation_rate", "resource_allocation_cost", "currency_code", "status", "remark", "row_version"}
var financeFields = map[string]string{"accountName": "account_name", "bankName": "bank_name", "accountNoMasked": "account_no_masked", "accountNoSecretRef": "account_no_secret_ref", "accountType": "account_type", "currencyCode": "currency_code", "ownerDeptCode": "owner_dept_code", "status": "status", "name": "name", "effectiveFrom": "effective_from", "effectiveTo": "effective_to", "baseSalary": "base_salary", "welfareCostRate": "welfare_cost_rate", "managementAllocationRate": "management_allocation_rate", "resourceAllocationCost": "resource_allocation_cost", "remark": "remark", "shortName": "short_name", "bankBranchCode": "bank_branch_code", "legalEntityCode": "legal_entity_code", "sortNo": "sort_no", "accountSubtype": "account_subtype", "unifiedSocialCreditCode": "unified_social_credit_code", "entityType": "entity_type", "registeredAddress": "registered_address", "invoiceTitle": "invoice_title", "invoiceTaxNo": "invoice_tax_no"}

func readFinanceRows(rows *sql.Rows, columns []string) ([]map[string]any, error) {
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for n := range values {
			ptrs[n] = &values[n]
		}
		if e := rows.Scan(ptrs...); e != nil {
			return nil, e
		}
		item := map[string]any{}
		for n, k := range columns {
			v := values[n]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			if k == "id" || k == "row_version" {
				switch x := v.(type) {
				case string:
					n, e := strconv.ParseInt(x, 10, 64)
					if e != nil || n > 9007199254740991 {
						return nil, financeInvalid()
					}
					v = n
				case uint64:
					if x > 9007199254740991 {
						return nil, financeInvalid()
					}
					v = int64(x)
				}
			}
			item[k] = v
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func financeSelect(columns []string) string {
	out := []string{}
	for _, c := range columns {
		if c == "effective_from" || c == "effective_to" || c == "snapshot_date" {
			out = append(out, "CAST("+c+" AS CHAR) AS "+c)
		} else {
			out = append(out, c)
		}
	}
	return strings.Join(out, ",")
}
func (s *Service) Finance(ctx context.Context, op string, i FinanceInput, who Identity) (out any, err error) {
	defer func() {
		var dependency *mysql.MySQLError
		if errors.As(err, &dependency) && (dependency.Number == 1213 || dependency.Number == 1205 || dependency.Number == 1062) {
			err = httperror.New(409, "finance_write_conflict", "Concurrent Finance write conflict; retry the same intent")
		}
	}()
	if e := ValidateFinanceInput(op, i); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || who.Client != "enterprise.runtime" {
		return nil, httperror.New(403, "finance_identity_invalid", "Invalid writer")
	}
	write := strings.HasSuffix(op, "-create") || strings.HasSuffix(op, "-update")
	req, e := s.request("finance", enterprise.Read)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if write {
		req.Operation = enterprise.Write
		tx, resolved, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		requests := []enterprise.ResolveRequest{req}
		if op == "accounts-view" {
			if b, ok := s.binding.Domains["migration"]; ok && b.Read == enterprise.PathUnified {
				ledger, err := s.request("migration", enterprise.Read)
				if err != nil {
					return nil, err
				}
				requests = append(requests, ledger)
			}
		}
		tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, requests...)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if op == "accounts-list" && i.AsOfDate != "" {
		result, err := financeBalancesAsOf(ctx, tx, resolved[0], i)
		if err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return result, nil
	}
	account := strings.HasPrefix(op, "accounts-")
	entity := strings.HasPrefix(op, "legal-entities-")
	logical := "finance_people_cost_parameter"
	columns := parameterColumns
	if account {
		logical = "finance_bank_account"
		columns = bankColumns
	}
	if entity {
		logical = "finance_legal_entity"
		columns = legalEntityColumns
	}
	table, e := resolved[0].Table(logical)
	if e != nil {
		if entity {
			// The directory is an optional reviewed subset; without it there is
			// nothing to read or write, which is not a permission problem.
			return nil, httperror.New(503, "finance_legal_entity_unavailable", "Legal entity directory is not installed")
		}
		return nil, e
	}
	if account {
		extended, e := financeHasColumn(ctx, tx, table, "short_name")
		if e != nil {
			return nil, e
		}
		if extended {
			columns = append(append([]string{}, bankColumns...), bankW1Columns...)
		} else {
			for _, k := range []string{"shortName", "bankBranchCode", "legalEntityCode", "sortNo", "accountSubtype"} {
				if _, ok := i.Payload[k]; ok {
					return nil, httperror.New(409, "finance_account_fields_unavailable", "Account fields are not installed")
				}
			}
		}
	}
	audit, e := resolved[0].Table("finance_audit_log")
	if e != nil {
		return nil, e
	}
	if write {
		return s.financeWrite(ctx, tx, resolved[0], table, audit, columns, op, i, who)
	}
	if op == "parameters-history" {
		var exists int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE BINARY code=BINARY ?", i.Code).Scan(&exists); e != nil {
			return nil, e
		}
		if exists != 1 {
			return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
		}
		var total int64
		where := "entity_type='people_cost_parameter' AND BINARY entity_code=BINARY ? AND action='version'"
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+audit+" WHERE "+where, i.Code).Scan(&total); e != nil {
			return nil, e
		}
		rows, e := tx.QueryContext(ctx, "SELECT new_value FROM "+audit+" WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", i.Code, i.PageSize, (i.Page-1)*i.PageSize)
		if e != nil {
			return nil, e
		}
		items := []map[string]any{}
		for rows.Next() {
			var raw []byte
			if e = rows.Scan(&raw); e != nil {
				rows.Close()
				return nil, e
			}
			var item map[string]any
			if e = json.Unmarshal(raw, &item); e != nil {
				rows.Close()
				return nil, e
			}
			items = append(items, item)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
	}
	where := "1=1"
	args := []any{}
	registered := false
	if account {
		where += " AND deleted_at IS NULL"
	}
	if op == "balances-list" {
		table, e = resolved[0].Table("finance_account_balance_snapshot")
		if e != nil {
			return nil, e
		}
		bank, _ := resolved[0].Table("finance_bank_account")
		table += " b JOIN " + bank + " a ON a.id=b.bank_account_id"
		where = "a.deleted_at IS NULL"
		snapshotsTable, _ := resolved[0].Table("finance_account_balance_snapshot")
		where += " AND " + financeSnapshotVisibility(snapshotsTable, "b")
		if i.Search != "" {
			where += " AND (LOCATE(?,a.code)>0 OR LOCATE(?,a.account_name)>0)"
			args = append(args, i.Search, i.Search)
		}
		columns = []string{"id", "account_code", "account_name", "snapshot_date", "balance_amount", "currency_code", "source_type", "note"}
		snapshots, _ := resolved[0].Table("finance_account_balance_snapshot")
		if registered, e = financeHasColumn(ctx, tx, snapshots, "entry_count"); e != nil {
			return nil, e
		} else if registered {
			columns = append(columns, "entry_count", "latest_tie_count", "distinct_amounts")
		}
		if i.AccountCode != "" {
			where += " AND BINARY a.code=BINARY ?"
			args = append(args, i.AccountCode)
		}
		if i.StartDate != "" {
			where += " AND b.snapshot_date>=?"
			args = append(args, i.StartDate)
		}
		if i.EndDate != "" {
			where += " AND b.snapshot_date<=?"
			args = append(args, i.EndDate)
		}
	} else {
		if i.Code != "" {
			where += " AND BINARY code=BINARY ?"
			args = append(args, i.Code)
		}
		if i.Status != "" {
			where += " AND status=?"
			args = append(args, i.Status)
		}
		if i.Search != "" {
			name := "name"
			if account {
				name = "account_name"
			}
			where += " AND (LOCATE(?,code)>0 OR LOCATE(?," + name + ")>0"
			args = append(args, i.Search, i.Search)
			if entity || account && len(columns) > len(bankColumns) {
				where += " OR LOCATE(?,COALESCE(short_name,''))>0"
				args = append(args, i.Search)
			}
			where += ")"
		}
	}
	if i.LegalEntityCode != "" {
		bank := table
		prefix := ""
		if op == "balances-list" {
			bank, _ = resolved[0].Table("finance_bank_account")
			prefix = "a."
		}
		has, err := financeHasColumn(ctx, tx, bank, "legal_entity_code")
		if err != nil {
			return nil, err
		}
		if has {
			where += " AND BINARY " + prefix + "legal_entity_code=BINARY ?"
			args = append(args, i.LegalEntityCode)
		} else {
			where += " AND 1=0"
		}
	}
	if i.AccountType != "" {
		where += " AND account_type=?"
		args = append(args, i.AccountType)
	}
	selectSQL := financeSelect(columns)
	order := "id"
	if entity || account && len(columns) > len(bankColumns) {
		order = "sort_no,id"
	}
	if op == "balances-list" {
		selectSQL = "b.id,a.code AS account_code,a.account_name,CAST(b.snapshot_date AS CHAR) AS snapshot_date,CAST(b.balance_amount AS CHAR) AS balance_amount,b.currency_code,b.source_type,b.note"
		if registered {
			selectSQL += ",b.entry_count,b.latest_tie_count,b.distinct_amounts"
		}
		order = "b.snapshot_date DESC,b.id"
	}
	list := strings.HasSuffix(op, "-list")
	var total int64
	if list {
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
	}
	query := "SELECT " + selectSQL + " FROM " + table + " WHERE " + where + " ORDER BY " + order
	filterArgs := append([]any{}, args...)
	if list {
		query += " LIMIT ? OFFSET ?"
		limit := i.PageSize
		if i.Complete && total <= 200 {
			limit = 200
		}
		args = append(args, limit, (i.Page-1)*i.PageSize)
	}
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	items, e := readFinanceRows(rows, columns)
	if e != nil {
		return nil, e
	}
	if !list && len(items) != 1 {
		return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
	}
	if entity && i.AccountCountAllowed {
		bank, e := resolved[0].Table("finance_bank_account")
		if e != nil {
			return nil, e
		}
		extended, e := financeHasColumn(ctx, tx, bank, "legal_entity_code")
		if e != nil {
			return nil, e
		}
		for _, item := range items {
			var count int64
			if extended {
				if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+bank+" WHERE BINARY legal_entity_code=BINARY ? AND deleted_at IS NULL", item["code"]).Scan(&count); e != nil {
					return nil, e
				}
			}
			item["account_count"] = count
		}
	}
	if account && len(columns) > len(bankColumns) {
		refs := map[string]string{}
		if entityTable, e := resolved[0].Table("finance_legal_entity"); e == nil {
			refs["finance_legal_entity"] = entityTable
		}
		for _, item := range items {
			if code, ok := item["legal_entity_code"].(string); ok && code != "" {
				name, e := financeW3ReferenceName(ctx, tx, refs, "finance_legal_entity", code)
				if e != nil {
					return nil, e
				}
				if name != "" {
					item["legal_entity_name"] = name
				}
			}
		}
	}
	var totals []map[string]any
	if account {
		if totals, e = accountLatestBalances(ctx, tx, resolved[0], table, where, filterArgs, items, len(columns) > len(bankColumns)); e != nil {
			return nil, e
		}
	}
	if op == "accounts-view" && len(resolved) > 1 {
		if e = w3FinanceSourceMetadata(ctx, tx, resolved[1], items[0]); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	if list {
		out := map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}
		if account {
			out["balanceTotals"] = totals
			if i.Complete {
				out["complete"] = total <= 200
			}
		}
		return out, nil
	}
	return map[string]any{"data": items[0]}, nil
}
func (s *Service) financeWrite(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, table, audit string, columns []string, op string, i FinanceInput, who Identity) (any, error) {
	if who.Key == "" {
		return nil, financeInvalid()
	}
	update := strings.HasSuffix(op, "-update")
	account := strings.HasPrefix(op, "accounts-")
	legalEntity := strings.HasPrefix(op, "legal-entities-")
	// Serialize interval writers even when the parameter table is empty. Registry
	// lock upgrade deadlocks abort one transaction; same key can retry safely.
	var generation uint64
	if !account && !legalEntity {
		if e := tx.QueryRowContext(ctx, "SELECT generation FROM enterprise_schema_registry WHERE id=1 FOR UPDATE").Scan(&generation); e != nil {
			return nil, e
		}
	}
	if update {
		var id int64
		q := "SELECT id FROM " + table + " WHERE BINARY code=BINARY ?"
		if account {
			q += " AND deleted_at IS NULL"
		}
		if e := tx.QueryRowContext(ctx, q+" FOR UPDATE", i.Code).Scan(&id); e == sql.ErrNoRows {
			return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
		} else if e != nil {
			return nil, e
		}
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	receipt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	code := i.Code
	if !update {
		prefix := "BA-"
		if !account {
			prefix = "PCP-"
		}
		if legalEntity {
			// Hex after the prefix; migrated entities use ENT-W<source id>.
			prefix = "ENT-"
		}
		code = prefix + strings.ReplaceAll(oid, "-", "")
	}
	entity := "bank_account"
	if !account {
		entity = "people_cost_parameter"
	}
	if legalEntity {
		entity = "legal_entity"
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.wp3." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var old map[string]any
		if update {
			rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(columns)+" FROM "+table+" WHERE BINARY code=BINARY ?", code)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			items, e := readFinanceRows(rows, columns)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			old = items[0]
			if float64(old["row_version"].(int64)) != i.Payload["expectedVersion"] {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "finance_version_conflict", "Object version changed")
			}
		}
		if legalEntity {
			if name, ok := i.Payload["name"]; ok {
				var n int
				if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE name=? AND BINARY code<>BINARY ?", name, code).Scan(&n); e != nil {
					return integrationoperation.ReceiptBusinessResult{}, e
				}
				if n != 0 {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "finance_legal_entity_name_exists", "Legal entity name already exists")
				}
			}
		}
		if account {
			if e := validateAccountW1Fields(ctx, tx, r, table, code, old, i.Payload); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		if !account && !legalEntity {
			from := i.Payload["effectiveFrom"].(string)
			to := i.Payload["effectiveTo"]
			if to != nil && to.(string) < from {
				return integrationoperation.ReceiptBusinessResult{}, financeInvalid()
			}
			if i.Payload["status"] == "active" {
				var n int
				end := "9999-12-31"
				if to != nil {
					end = to.(string)
				}
				if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE status='active' AND BINARY code<>BINARY ? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)", code, end, from).Scan(&n); e != nil {
					return integrationoperation.ReceiptBusinessResult{}, e
				}
				if n != 0 {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "finance_effective_range_overlap", "Effective periods overlap")
				}
			}
		}
		keys := []string{}
		for k := range i.Payload {
			if k != "expectedVersion" {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		cols := []string{}
		marks := []string{}
		values := []any{}
		for _, k := range keys {
			cols = append(cols, financeFields[k])
			marks = append(marks, "?")
			values = append(values, i.Payload[k])
		}
		if update {
			sets := []string{}
			for _, c := range cols {
				sets = append(sets, c+"=?")
			}
			values = append(values, who.Actor, code, i.Payload["expectedVersion"])
			res, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+",updated_by=?,row_version=row_version+1 WHERE BINARY code=BINARY ? AND row_version=?", values...)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			n, _ := res.RowsAffected()
			if n != 1 {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "finance_version_conflict", "Object version changed")
			}
		} else {
			cols = append(cols, "code", "created_by", "updated_by")
			marks = append(marks, "?", "?", "?")
			values = append(values, code, who.Actor, who.Actor)
			if _, e := tx.ExecContext(ctx, "INSERT INTO "+table+" ("+strings.Join(cols, ",")+") VALUES ("+strings.Join(marks, ",")+")", values...); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(columns)+" FROM "+table+" WHERE BINARY code=BINARY ?", code)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		items, e := readFinanceRows(rows, columns)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		snapshot, _ := json.Marshal(items[0])
		oldJSON, _ := json.Marshal(old)
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_id,entity_code,action,old_value,new_value,operator_uid,channel,request_id) VALUES (?,?,?,'version',?,?,?,'user',?)", entity, items[0]["id"], code, string(oldJSON), string(snapshot), who.Actor, who.RequestID); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: entity, TargetBizCode: code + ":v" + strconv.FormatInt(items[0]["row_version"].(int64), 10), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "finance_idempotency_conflict", "Intent changed")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid Finance receipt")
	}
	var snapshot []byte
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE entity_type=? AND BINARY entity_code=BINARY ? AND action='version' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.row_version'))=?", entity, parts[0], parts[1]).Scan(&snapshot); e != nil {
		return nil, e
	}
	var item map[string]any
	if e = json.Unmarshal(snapshot, &item); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": item}, nil
}

func financeHasColumn(ctx context.Context, tx *sql.Tx, table, column string) (bool, error) {
	rows, e := tx.QueryContext(ctx, "SELECT * FROM "+table+" LIMIT 0")
	if e != nil {
		return false, e
	}
	defer rows.Close()
	columns, e := rows.Columns()
	if e != nil {
		return false, e
	}
	for _, c := range columns {
		if c == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Cross-field and cross-object rules for the account fields added by W1. old
// is nil on create. Uniqueness is prechecked so the caller gets a specific code
// instead of the generic write conflict.
func validateAccountW1Fields(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, table, code string, old, payload map[string]any) error {
	if v, ok := payload["shortName"]; ok && v != nil {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE short_name=? AND BINARY code<>BINARY ?", v, code).Scan(&n); e != nil {
			return e
		}
		if n != 0 {
			return httperror.New(409, "finance_account_short_name_exists", "Account short name already exists")
		}
	}
	if v, ok := payload["legalEntityCode"]; ok && v != nil {
		entities, e := r.Table("finance_legal_entity")
		if e != nil {
			return httperror.New(503, "finance_legal_entity_unavailable", "Legal entity directory is not installed")
		}
		var status string
		if e = tx.QueryRowContext(ctx, "SELECT status FROM "+entities+" WHERE BINARY code=BINARY ? FOR SHARE", v).Scan(&status); e == sql.ErrNoRows || e == nil && status != "active" {
			return httperror.New(409, "finance_legal_entity_invalid", "Legal entity is missing or inactive")
		} else if e != nil {
			return e
		}
	}
	subtype, changed := payload["accountSubtype"]
	if !changed && old != nil {
		subtype = old["account_subtype"]
	}
	kind, ok := payload["accountType"]
	if !ok && old != nil {
		kind = old["account_type"]
	}
	if subtype != nil && kind != "bank" {
		return httperror.New(409, "finance_account_subtype_invalid", "Only bank accounts have a subtype")
	}
	return nil
}

// accountLatestBalances adds each account's most recent balance to the returned
// rows and totals the most recent balances of the whole filtered result per
// legal entity and currency. "No balance yet" stays absent: it is not zero.
func accountLatestBalances(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, accounts, where string, args []any, items []map[string]any, extended bool) ([]map[string]any, error) {
	snapshots, e := r.Table("finance_account_balance_snapshot")
	if e != nil {
		return nil, e
	}
	latest := snapshots + " s ON s.id=(SELECT x.id FROM " + snapshots + " x WHERE x.bank_account_id=a.id AND " + financeSnapshotVisibility(snapshots, "x") + " ORDER BY x.snapshot_date DESC,x.id DESC LIMIT 1)"
	// The filter was written for the bare account table; give it that table alone.
	filtered := "(SELECT * FROM " + accounts + " WHERE " + where + ") a"
	byID := map[int64]map[string]any{}
	for _, item := range items {
		item["latest_balance_amount"], item["latest_balance_date"] = nil, nil
		if id, ok := item["id"].(int64); ok {
			byID[id] = item
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT a.id,CAST(s.balance_amount AS CHAR),CAST(s.snapshot_date AS CHAR) FROM "+filtered+" JOIN "+latest, args...)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var id int64
		var amount, date string
		if e = rows.Scan(&id, &amount, &date); e != nil {
			rows.Close()
			return nil, e
		}
		if item := byID[id]; item != nil {
			item["latest_balance_amount"], item["latest_balance_date"] = amount, date
		}
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}
	entity := "NULL"
	if extended {
		entity = "a.legal_entity_code"
	}
	rows, e = tx.QueryContext(ctx, "SELECT "+entity+",a.currency_code,COUNT(*),CAST(SUM(s.balance_amount) AS CHAR) FROM "+filtered+" JOIN "+latest+" GROUP BY 1,2 ORDER BY 1,2", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	totals := []map[string]any{}
	for rows.Next() {
		var code sql.NullString
		var currency, amount string
		var count int64
		if e = rows.Scan(&code, &currency, &count, &amount); e != nil {
			return nil, e
		}
		totals = append(totals, map[string]any{"legal_entity_code": nullString(code), "currency_code": currency, "account_count": count, "amount": amount})
	}
	return totals, rows.Err()
}

// Only imported snapshots lose to a manual snapshot of the same account/day.
// API snapshots retain their existing date/id ordering; W3 does not redefine them.
func financeSnapshotVisibility(table, alias string) string {
	return "NOT (" + alias + ".source_type='import' AND EXISTS (SELECT 1 FROM " + table + " preferred WHERE preferred.bank_account_id=" + alias + ".bank_account_id AND preferred.snapshot_date=" + alias + ".snapshot_date AND preferred.source_type='manual'))"
}
