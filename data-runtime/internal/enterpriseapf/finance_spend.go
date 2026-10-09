package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"math/big"
	"sort"
	"strings"
	"time"
)

// APF-13a: twenty exact user operations. Bind/recovery use the existing Finance approval port.
var financeSpendOps = map[string]ledgerSpec{
	"payment-requests-page":    {"finance_payment_request", "expenses", "view", "page", false},
	"payment-requests-detail":  {"finance_payment_request", "expenses", "view", "detail", false},
	"payment-requests-create":  {"finance_payment_request", "expenses", "edit", "create", true},
	"payment-requests-update":  {"finance_payment_request", "expenses", "edit", "update", true},
	"payment-requests-cancel":  {"finance_payment_request", "expenses", "edit", "cancel", true},
	"payment-requests-submit":  {"finance_payment_request", "expenses", "edit", "submit", true},
	"payment-requests-confirm": {"finance_payment_request", "expenses", "confirm", "confirm", true},

	"expenses-page":            {"finance_expense", "expenses", "view", "page", false},
	"expenses-detail":          {"finance_expense", "expenses", "view", "detail", false},
	"expenses-create":          {"finance_expense", "expenses", "edit", "create", true},
	"expenses-update":          {"finance_expense", "expenses", "edit", "update", true},
	"expenses-delete":          {"finance_expense", "expenses", "edit", "delete", true},
	"expenses-confirm":         {"finance_expense", "expenses", "confirm", "confirm", true},
	"claims-page":              {"finance_expense_claim", "expenses", "view", "page", false},
	"claims-detail":            {"finance_expense_claim", "expenses", "view", "detail", false},
	"claims-create":            {"finance_expense_claim", "expenses", "edit", "create", true},
	"claims-update":            {"finance_expense_claim", "expenses", "edit", "update", true},
	"claims-cancel":            {"finance_expense_claim", "expenses", "edit", "cancel", true},
	"claims-submit":            {"finance_expense_claim", "expenses", "edit", "submit", true},
	"claims-confirm":           {"finance_expense_claim", "expenses", "confirm", "confirm", true},
	"project-requests-page":    {"finance_project_expense_request", "expenses", "view", "page", false},
	"project-requests-detail":  {"finance_project_expense_request", "expenses", "view", "detail", false},
	"project-requests-create":  {"finance_project_expense_request", "expenses", "edit", "create", true},
	"project-requests-update":  {"finance_project_expense_request", "expenses", "edit", "update", true},
	"project-requests-cancel":  {"finance_project_expense_request", "expenses", "edit", "cancel", true},
	"project-requests-submit":  {"finance_project_expense_request", "expenses", "edit", "submit", true},
	"project-requests-confirm": {"finance_project_expense_request", "expenses", "confirm", "confirm", true},
}

func FinanceSpendPermission(op string) (string, string, bool) {
	sp, ok := financeSpendOps[op]
	return sp.resource, sp.action, ok
}

var spendFields = map[string]string{"requestedAmount": "requested_amount", "paymentType": "payment_type", "plannedPayDate": "planned_pay_date", "title": "title", "projectCode": "project_code", "contractCode": "contract_code", "customerCode": "customer_code", "currencyCode": "currency_code", "remark": "remark", "expenseDate": "expense_date", "expenseAmount": "expense_amount", "description": "description", "payeeName": "payee_name", "paymentChannel": "payment_channel", "bankAccountId": "bank_account_id", "expenseTypeId": "expense_type_id", "subjectId": "subject_id"}

func spendAllowed(sp ledgerSpec) []string {
	if sp.kind != "create" && sp.kind != "update" {
		return nil
	}
	if sp.table == "finance_expense" {
		return strings.Fields("projectCode contractCode customerCode currencyCode expenseDate expenseAmount description payeeName paymentChannel bankAccountId expenseTypeId subjectId")
	}
	if sp.table == "finance_payment_request" {
		return strings.Fields("title paymentType payeeName requestedAmount plannedPayDate bankAccountId projectCode contractCode customerCode currencyCode remark")
	}
	return strings.Fields("title projectCode contractCode customerCode currencyCode remark items")
}
func ValidateFinanceSpendInput(op string, i FinanceInput) error {
	sp, ok := financeSpendOps[op]
	if !ok {
		return financeInvalid()
	}
	if i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if sp.kind == "page" {
		if i.Code != "" || (len(i.Payload) > 0 && !(op == "expenses-page" && len(i.Payload) == 1 && i.Payload["projectOnly"] == true)) || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len(i.Search) > 200 || strings.ContainsAny(i.Search+i.Status, "\x00\r\n") {
			return financeInvalid()
		}
		if i.Status != "" && !strings.Contains("|draft|pending_approval|approved|rejected|paid|confirmed|canceled|", "|"+i.Status+"|") {
			return financeInvalid()
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" || sp.kind == "create" && i.Code != "" || sp.kind != "create" && !financeCode.MatchString(i.Code) {
		return financeInvalid()
	}
	if !sp.write {
		if len(i.Payload) > 0 {
			return financeInvalid()
		}
		return nil
	}
	allowed := map[string]bool{}
	for _, k := range spendAllowed(sp) {
		allowed[k] = true
	}
	if sp.kind != "create" {
		allowed["expectedVersion"] = true
	}
	for k, v := range i.Payload {
		if !allowed[k] {
			return financeInvalid()
		}
		switch k {
		case "expectedVersion", "bankAccountId", "expenseTypeId", "subjectId":
			if k == "bankAccountId" && v == nil {
				continue
			}
			n, ok := v.(float64)
			if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "items":
			if _, e := spendItems(v); e != nil {
				return e
			}
		case "expenseAmount", "requestedAmount":
			if !decimalValid(v, 18, 2) || moneyCents(ledgerText(v)).Sign() <= 0 {
				return financeInvalid()
			}
		case "expenseDate", "plannedPayDate":
			if k == "plannedPayDate" && v == nil {
				continue
			}
			if !dateValid(ledgerText(v)) {
				return financeInvalid()
			}
		case "currencyCode":
			if !currencyCode.MatchString(ledgerText(v)) {
				return financeInvalid()
			}
		case "paymentType":
			if v != "supplier" && v != "customer_refund" && v != "loan" && v != "expense" && v != "other" {
				return financeInvalid()
			}
		case "paymentChannel":
			if v != "cash" && v != "bank_transfer" && v != "third_party" && v != "other" {
				return financeInvalid()
			}
		default:
			if v != nil && !stringValue(v, 500, true) {
				return financeInvalid()
			}
			if (k == "projectCode" || k == "contractCode" || k == "customerCode") && ledgerText(v) != "" && !financeCode.MatchString(ledgerText(v)) {
				return financeInvalid()
			}
			if sp.table == "finance_payment_request" && k == "payeeName" && !stringValue(v, 200, false) {
				return financeInvalid()
			}
			if k == "title" && (ledgerText(v) == "" || len(ledgerText(v)) > 200) {
				return financeInvalid()
			}
		}
	}
	if sp.table == "finance_project_expense_request" {
		if v, ok := i.Payload["projectCode"]; ok && ledgerText(v) == "" {
			return financeInvalid()
		}
	}
	if sp.kind != "create" && ledgerVersion(i.Payload["expectedVersion"]) < 1 {
		return financeInvalid()
	}
	if sp.kind == "create" {
		keys := strings.Fields("title currencyCode items")
		if sp.table == "finance_payment_request" {
			keys = strings.Fields("title currencyCode paymentType payeeName requestedAmount")
		}
		if sp.table == "finance_expense" {
			keys = strings.Fields("expenseAmount expenseDate currencyCode")
		}
		if sp.table == "finance_project_expense_request" {
			keys = append(keys, "projectCode")
		}
		for _, k := range keys {
			if ledgerText(i.Payload[k]) == "" {
				return financeInvalid()
			}
		}
	}
	return nil
}
func spendItems(v any) ([]map[string]any, error) {
	rows, ok := v.([]any)
	if !ok || len(rows) < 1 || len(rows) > 100 {
		return nil, financeInvalid()
	}
	out := []map[string]any{}
	total := new(big.Int)
	for _, v := range rows {
		row, ok := v.(map[string]any)
		if !ok {
			return nil, financeInvalid()
		}
		for k, x := range row {
			switch k {
			case "amount":
				if !decimalValid(x, 18, 2) || moneyCents(ledgerText(x)).Sign() <= 0 {
					return nil, financeInvalid()
				}
			case "description":
				if !stringValue(x, 500, true) {
					return nil, financeInvalid()
				}
			case "occurredAt":
				if !dateValid(ledgerText(x)) {
					return nil, financeInvalid()
				}
			case "expenseTypeId", "subjectId":
				n, ok := x.(float64)
				if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
					return nil, financeInvalid()
				}
			default:
				return nil, financeInvalid()
			}
		}
		if ledgerText(row["amount"]) == "" || ledgerText(row["description"]) == "" {
			return nil, financeInvalid()
		}
		total.Add(total, moneyCents(ledgerText(row["amount"])))
		out = append(out, row)
	}
	if len(total.String()) > 18 {
		return nil, financeInvalid()
	}
	return out, nil
}
func spendScope(row map[string]any, scope altoc.BasicReadScope, actor string) bool {
	return scope.Access == "all" || scope.Access == "self" && (ledgerText(row["applicant_uid"]) == actor || ledgerText(row["handler_uid"]) == actor || ledgerText(row["created_by"]) == actor)
}
func spendItemsTable(table string) (string, string) {
	if table == "finance_expense_claim" {
		return "finance_expense_claim_item", "claim_id"
	}
	if table == "finance_project_expense_request" {
		return "finance_project_expense_request_item", "request_id"
	}
	return "", ""
}
func spendRead(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, scope altoc.BasicReadScope, who Identity) (any, error) {
	if sp.kind == "detail" {
		row, e := ledgerRow(ctx, tx, sp.table, i.Code, false)
		if e != nil {
			return nil, e
		}
		if !spendScope(row, scope, who.Actor) {
			return nil, ledgerError(403, "scope_denied")
		}
		if e = spendLoadItems(ctx, tx, sp.table, row); e != nil {
			return nil, e
		}
		return map[string]any{"data": row}, nil
	}
	where := "deleted_at IS NULL"
	if i.Payload["projectOnly"] == true {
		where += " AND project_code IS NOT NULL AND project_code<>''"
	}
	args := []any{}
	if scope.Access == "self" {
		if sp.table == "finance_expense" {
			where += " AND (handler_uid=? OR created_by=?)"
			args = append(args, who.Actor, who.Actor)
		} else {
			where += " AND (applicant_uid=? OR handler_uid=? OR created_by=?)"
			args = append(args, who.Actor, who.Actor, who.Actor)
		}
	}
	if i.Search != "" {
		where += " AND (code LIKE ? OR project_code LIKE ? OR contract_code LIKE ?)"
		pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(i.Search) + "%"
		args = append(args, pattern, pattern, pattern)
	}
	if i.Status != "" {
		where += " AND status=?"
		args = append(args, i.Status)
	}
	var total int64
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+sp.table+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	cols := ledgerColumns(sp.table)
	rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(cols)+" FROM "+sp.table+" WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", append(args, i.PageSize, (i.Page-1)*i.PageSize)...)
	if e != nil {
		return nil, e
	}
	items, e := readFinanceRows(rows, cols)
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, e
}
func spendLoadItems(ctx context.Context, tx *sql.Tx, table string, row map[string]any) error {
	it, fk := spendItemsTable(table)
	if it == "" {
		return nil
	}
	cols := ledgerColumns(it)
	rs, e := tx.QueryContext(ctx, "SELECT "+financeSelect(cols)+" FROM "+it+" WHERE "+fk+"=? ORDER BY sort_no,id", row["id"])
	if e != nil {
		return e
	}
	row["items"], e = readFinanceRows(rs, cols)
	return e
}
func spendLock(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, who Identity, scope altoc.BasicReadScope) (map[string]map[string]any, error) {
	locked := map[string]map[string]any{}
	var discovered map[string]any
	var e error
	if sp.kind != "create" {
		discovered, e = spendRow(ctx, tx, sp, i.Code, false)
		if e != nil {
			return nil, e
		}
		if !spendScope(discovered, scope, who.Actor) {
			return nil, ledgerError(403, "scope_denied")
		}
	}
	value := func(key, column string) string {
		if x, ok := i.Payload[key]; ok {
			return ledgerText(x)
		}
		return ledgerText(discovered[column])
	}
	contract, customer, currency := value("contractCode", "contract_code"), value("customerCode", "customer_code"), value("currencyCode", "currency_code")
	if contract != "" {
		if e = altoc.LockFinanceExpenseContractTx(ctx, tx, contract, customer, currency); e != nil {
			return nil, e
		}
	} else if customer != "" {
		return nil, ledgerError(400, "contract_reference_required")
	}
	// Fixed reference table/column names only, before parent locks. Child IDs are
	// checked inside the same transaction; callers cannot select arbitrary tables.
	refs := map[string]any{}
	for k, v := range i.Payload {
		refs[k] = v
	}
	if discovered != nil {
		for k, c := range map[string]string{"bankAccountId": "bank_account_id", "expenseTypeId": "expense_type_id", "subjectId": "subject_id"} {
			if _, ok := refs[k]; !ok && discovered[c] != nil {
				refs[k] = discovered[c]
			}
		}
	}
	if items, ok := i.Payload["items"].([]any); ok {
		for _, it := range items {
			row := it.(map[string]any)
			for _, k := range []string{"expenseTypeId", "subjectId"} {
				if row[k] != nil {
					refs[k+":"+ledgerText(row[k])] = row[k]
				}
			}
		}
	}
	// One canonical table/id order regardless of parent-vs-item placement.
	ids := map[string]int64{}
	tables := map[string]string{}
	for k, v := range refs {
		key := strings.Split(k, ":")[0]
		table := map[string]string{"bankAccountId": "finance_bank_account", "expenseTypeId": "finance_expense_type", "subjectId": "finance_subject"}[key]
		if table == "" || v == nil {
			continue
		}
		id := ledgerVersion(v)
		token := fmt.Sprintf("%s:%020d", table, id)
		ids[token] = id
		tables[token] = table
	}
	keys := []string{}
	for token := range ids {
		keys = append(keys, token)
	}
	sort.Strings(keys)
	for _, token := range keys {
		var id int64
		if e = tx.QueryRowContext(ctx, "SELECT id FROM "+tables[token]+" WHERE id=? AND status='active' FOR UPDATE", ids[token]).Scan(&id); e != nil {
			if e == sql.ErrNoRows {
				return nil, ledgerError(400, "reference_invalid")
			}
			return nil, e
		}
	}

	if discovered != nil {
		row, e := spendRow(ctx, tx, sp, i.Code, true)
		if e != nil {
			return nil, e
		}
		if ledgerVersion(row["row_version"]) != ledgerVersion(discovered["row_version"]) || !spendScope(row, scope, who.Actor) {
			return nil, ledgerError(409, "version_conflict")
		}
		locked[sp.table] = row
		if e = spendLoadItems(ctx, tx, sp.table, row); e != nil {
			return nil, e
		}
	}
	return locked, nil
}
func requireSpendDutySeparation(row map[string]any, actor string) error {
	if actor == "" {
		return ledgerError(403, "identity_invalid")
	}
	for _, k := range []string{"applicant_uid", "handler_uid", "created_by"} {
		if ledgerText(row[k]) == actor {
			return ledgerError(403, "payment_confirmation_duty_separation_required")
		}
	}
	return nil
}
func spendMutate(ctx context.Context, tx *sql.Tx, op string, sp ledgerSpec, i FinanceInput, who Identity, locked map[string]map[string]any, oid string) (map[string]any, error) {
	row := locked[sp.table]
	fields := map[string]any{}
	for k, v := range i.Payload {
		if c := spendFields[k]; c != "" {
			fields[c] = v
		}
	}
	fields["updated_by"] = who.Actor
	if sp.kind != "create" {
		if e := ledgerVersionCheck(row, i.Payload["expectedVersion"]); e != nil {
			return nil, e
		}
	}
	code := i.Code
	switch sp.kind {
	case "create":
		prefix := map[string]string{"finance_expense": "EXP", "finance_expense_claim": "CLM", "finance_project_expense_request": "PER", "finance_payment_request": "PAY"}[sp.table]
		code = prefix + "-" + oid
		fields["code"] = code
		fields["status"] = "draft"
		fields["created_by"] = who.Actor
		fields["handler_uid"] = who.Actor
		if sp.table != "finance_expense" {
			fields["applicant_uid"] = who.Actor
			if sp.table != "finance_payment_request" {
				fields["total_amount"] = spendTotal(i.Payload["items"])
			}
		}
		if e := ledgerInsert(ctx, tx, sp.table, fields); e != nil {
			return nil, e
		}
	case "update":
		if row["status"] != "draft" && row["status"] != "rejected" {
			return nil, ledgerError(409, "state_conflict")
		}
		if v, ok := i.Payload["items"]; ok {
			fields["total_amount"] = spendTotal(v)
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
	case "delete", "cancel":
		if row["status"] != "draft" && row["status"] != "rejected" {
			return nil, ledgerError(409, "state_conflict")
		}
		fields["status"] = "canceled"
		if sp.kind == "delete" {
			if _, e := tx.ExecContext(ctx, "UPDATE "+sp.table+" SET deleted_at=UTC_TIMESTAMP(3) WHERE code=?", code); e != nil {
				return nil, e
			}
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
		return map[string]any{"code": code, "status": "canceled"}, nil
	case "confirm":
		if e := requireSpendDutySeparation(row, who.Actor); e != nil {
			return nil, e
		}
		if sp.table == "finance_expense" {
			if row["status"] != "draft" {
				return nil, ledgerError(409, "state_conflict")
			}
			fields["status"] = "confirmed"
			fields["confirmed_by"] = who.Actor
		} else {
			if row["status"] != "approved" || ledgerText(row["workflow_instance_id"]) == "" || row["generated_expense_id"] != nil {
				return nil, ledgerError(409, "state_conflict")
			}
			expenseCode := "EXP-" + oid
			amount := row["total_amount"]
			if sp.table == "finance_payment_request" {
				amount = row["requested_amount"]
			}
			expense := map[string]any{"code": expenseCode, "expense_date": time.Now().UTC().Format("2006-01-02"), "expense_amount": amount, "currency_code": row["currency_code"], "project_code": row["project_code"], "contract_code": row["contract_code"], "customer_code": row["customer_code"], "handler_uid": row["handler_uid"], "source_request_type": sp.table, "source_request_code": code, "status": "confirmed", "description": row["title"], "payee_name": row["payee_name"], "bank_account_id": row["bank_account_id"], "created_by": row["created_by"], "updated_by": who.Actor, "confirmed_by": who.Actor}
			if e := ledgerInsert(ctx, tx, "finance_expense", expense); e != nil {
				return nil, e
			}

			var id int64
			if e := tx.QueryRowContext(ctx, "SELECT id FROM finance_expense WHERE code=?", expenseCode).Scan(&id); e != nil {
				return nil, e
			}
			fields["status"] = "paid"
			if sp.table == "finance_expense_claim" || sp.table == "finance_payment_request" {
				fields["paid_amount"] = amount
			}
			fields["generated_expense_id"] = id
			fields["confirmed_by"] = who.Actor
			if _, e := tx.ExecContext(ctx, "UPDATE "+sp.table+" SET paid_at=UTC_TIMESTAMP(3) WHERE code=?", code); e != nil {
				return nil, e
			}
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
	default:
		return nil, financeInvalid()
	}
	if v, ok := i.Payload["items"]; ok {
		parent, e := ledgerRow(ctx, tx, sp.table, code, false)
		if e != nil {
			return nil, e
		}
		if e = spendReplaceItems(ctx, tx, sp.table, parent["id"], v); e != nil {
			return nil, e
		}
	}
	result, e := ledgerRow(ctx, tx, sp.table, code, false)
	if e == nil {
		e = spendLoadItems(ctx, tx, sp.table, result)
	}
	return result, e
}
func spendTotal(v any) string {
	items, _ := spendItems(v)
	sum := new(big.Int)
	for _, it := range items {
		sum.Add(sum, moneyCents(ledgerText(it["amount"])))
	}
	return centsText(sum)
}
func spendReplaceItems(ctx context.Context, tx *sql.Tx, table string, id any, v any) error {
	it, fk := spendItemsTable(table)
	if it == "" {
		return financeInvalid()
	}
	if _, e := tx.ExecContext(ctx, "DELETE FROM "+it+" WHERE "+fk+"=?", id); e != nil {
		return e
	}
	items, e := spendItems(v)
	if e != nil {
		return e
	}
	for n, row := range items {
		m := map[string]any{fk: id, "amount": row["amount"], "description": row["description"], "sort_no": n}
		if table == "finance_project_expense_request" {
			m["item_name"] = row["description"]
		} else {
			m["occurred_at"] = row["occurredAt"]
		}
		for k, c := range map[string]string{"expenseTypeId": "expense_type_id", "subjectId": "subject_id"} {
			if x, ok := row[k]; ok {
				m[c] = x
			}
		}
		if e = ledgerInsert(ctx, tx, it, m); e != nil {
			return e
		}
	}
	return nil
}

func (s *Service) FinanceSpend(ctx context.Context, op string, i FinanceInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {

	defer func() {
		var m *mysql.MySQLError
		if errors.As(err, &m) && (m.Number == 1213 || m.Number == 1205 || m.Number == 1062) {
			err = ledgerError(409, "write_conflict")
		}
	}()
	if e := ValidateFinanceSpendInput(op, i); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment {
		return nil, ledgerError(403, "identity_invalid")
	}
	if (scope.Access != "all" && scope.Access != "self") || len(scope.DepartmentCodes) > 0 {
		return nil, ledgerError(403, "scope_denied")
	}
	sp := financeSpendOps[op]
	if sp.table == "finance_payment_request" && !domaininstall.IsFinance13bDomain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "13b_unavailable")
	}
	if !domaininstall.IsFinance13aDomain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "b3_unavailable")
	}
	req, e := s.request("finance", enterprise.Read)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if sp.write {
		req.Operation = enterprise.Write
		ar, e := s.request("altoc", enterprise.Write)
		if e != nil {
			return nil, e
		}
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, ar, req)
	} else {
		ar, ae := s.request("altoc", enterprise.Read)
		if ae != nil {
			return nil, ae
		}
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, ar, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[len(rs)-1]
	if sp.kind == "page" || sp.kind == "detail" || sp.kind == "file" {
		out, e = spendRead(ctx, tx, sp, i, scope, who)
		if e == nil {
			e = tx.Commit()
		}
		return out, e
	}
	if who.Key == "" {
		return nil, financeInvalid()
	}
	locked, e := spendLock(ctx, tx, sp, i, who, scope)
	if e != nil {
		return nil, e
	}
	costTargets, e := lockCostFinancialTargets(ctx, tx, r, i, locked)
	if e != nil {
		return nil, e
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	batch := "13a"
	if sp.table == "finance_payment_request" {
		batch = "13b"
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance"+batch+"|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	receipt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance." + batch + "." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		value, e := spendMutate(ctx, tx, op, sp, i, who, locked, oid)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}

		if e = refreshCostFinancialTargets(ctx, tx, r, costTargets); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		snapshot, _ := json.Marshal(map[string]any{"data": value})
		audit, _ := r.Table("finance_audit_log")
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_code,action,new_value,operator_uid,channel,request_id) VALUES (?,?,?,? ,?,'user',?)", sp.table, ledgerText(value["code"]), op, string(snapshot), who.Actor, oid); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: sp.table, TargetBizCode: oid, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(snapshot)}, nil
	})
	if e != nil {
		return nil, e
	}
	var snapshot string
	audit, _ := r.Table("finance_audit_log")
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE request_id=? AND action=?", result.TargetBizCode, op).Scan(&snapshot); e != nil {
		return nil, e
	}
	var reply map[string]any
	if e = json.Unmarshal([]byte(snapshot), &reply); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return reply, nil
}

func spendRow(ctx context.Context, tx *sql.Tx, sp ledgerSpec, code string, lock bool) (map[string]any, error) {
	if sp.kind != "delete" {
		return ledgerRow(ctx, tx, sp.table, code, lock)
	}
	cols := ledgerColumns(sp.table)
	q := "SELECT " + financeSelect(cols) + " FROM " + sp.table + " WHERE BINARY code=BINARY ?"
	if lock {
		q += " FOR UPDATE"
	}
	rows, e := tx.QueryContext(ctx, q, code)
	if e != nil {
		return nil, e
	}
	items, e := readFinanceRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if len(items) != 1 {
		return nil, ledgerError(404, "object_not_found")
	}
	return items[0], nil
}
