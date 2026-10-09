package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"sort"
	"strings"
)

// Only these predeclared operations select a table. Caller cannot supply one.
var financeSettingsOps = map[string]ledgerSpec{
	"expense-types-page":        {"finance_expense_type", "settings", "admin", "page", false},
	"expense-types-create":      {"finance_expense_type", "settings", "admin", "create", true},
	"expense-types-update":      {"finance_expense_type", "settings", "admin", "update", true},
	"income-types-page":         {"finance_income_type", "settings", "admin", "page", false},
	"income-types-create":       {"finance_income_type", "settings", "admin", "create", true},
	"income-types-update":       {"finance_income_type", "settings", "admin", "update", true},
	"subjects-page":             {"finance_subject", "settings", "admin", "page", false},
	"subjects-create":           {"finance_subject", "settings", "admin", "create", true},
	"subjects-update":           {"finance_subject", "settings", "admin", "update", true},
	"subject-mappings-page":     {"finance_subject_mapping", "settings", "admin", "page", false},
	"subject-mappings-create":   {"finance_subject_mapping", "settings", "admin", "create", true},
	"subject-mappings-update":   {"finance_subject_mapping", "settings", "admin", "update", true},
	"accounting-objects-page":   {"finance_accounting_object", "settings", "admin", "page", false},
	"accounting-objects-create": {"finance_accounting_object", "settings", "admin", "create", true},
	"accounting-objects-update": {"finance_accounting_object", "settings", "admin", "update", true},
	"audit-logs-page":           {"finance_audit_log", "settings", "admin", "page", false},
	"approval-instances-page":   {"", "settings", "admin", "page", false},
}
var settingsFields = map[string]string{"code": "code", "name": "name", "status": "status", "remark": "remark", "sortNo": "sort_no", "subjectType": "subject_type", "parentId": "parent_id", "defaultSubjectId": "default_subject_id", "costCategory": "cost_category", "reimbursable": "reimbursable", "isContractIncome": "is_contract_income", "bizType": "biz_type", "bizSubtype": "biz_subtype", "incomeTypeCode": "income_type_code", "expenseTypeCode": "expense_type_code", "defaultSubjectCode": "default_subject_code", "objectStrategy": "object_strategy", "requiredDimensions": "required_dimensions_json", "objectType": "object_type"}

func settingsAllowed(table string) []string {
	common := "code name status remark"
	switch table {
	case "finance_subject":
		return strings.Fields(common + " sortNo subjectType parentId")
	case "finance_expense_type":
		return strings.Fields(common + " sortNo defaultSubjectId costCategory reimbursable")
	case "finance_income_type":
		return strings.Fields(common + " sortNo defaultSubjectId isContractIncome")
	case "finance_subject_mapping":
		return strings.Fields("bizType bizSubtype incomeTypeCode expenseTypeCode defaultSubjectCode objectStrategy requiredDimensions status sortNo remark")
	case "finance_accounting_object":
		return strings.Fields(common + " objectType")
	}
	return nil
}
func FinanceSettingsPermission(op string) (string, string, bool) {
	sp, ok := financeSettingsOps[op]
	return sp.resource, sp.action, ok
}
func ValidateFinanceSettingsInput(op string, i FinanceInput) error {
	sp, ok := financeSettingsOps[op]
	if !ok || i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if sp.kind == "page" {
		if (op == "audit-logs-page" || op == "approval-instances-page") && i.Status != "" {
			return financeInvalid()
		}
		if i.Code != "" && (!financeCode.MatchString(i.Code) || sp.table == "finance_audit_log" || sp.table == "") || len(i.Payload) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || !stringValue(i.Search, 200, true) || i.Status != "" && i.Status != "active" && i.Status != "inactive" {
			return financeInvalid()
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" || sp.kind == "create" && i.Code != "" || sp.kind == "update" && !financeCode.MatchString(i.Code) {
		return financeInvalid()
	}
	allowed := map[string]bool{}
	for _, k := range settingsAllowed(sp.table) {
		allowed[k] = true
	}
	if sp.kind == "update" {
		allowed["expectedVersion"] = true
		delete(allowed, "code")
	}
	for k, v := range i.Payload {
		if !allowed[k] {
			return financeInvalid()
		}
		switch k {
		case "expectedVersion", "defaultSubjectId", "parentId":
			if v == nil && k != "expectedVersion" {
				continue
			}
			n, ok := v.(float64)
			if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "sortNo":
			n, ok := v.(float64)
			if !ok || n < 0 || n > 1000000 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "reimbursable", "isContractIncome":
			if _, ok := v.(bool); !ok {
				return financeInvalid()
			}
		case "status":
			if v != "active" && v != "inactive" {
				return financeInvalid()
			}
		case "code", "defaultSubjectCode", "incomeTypeCode", "expenseTypeCode":
			if (k == "incomeTypeCode" || k == "expenseTypeCode") && v == nil {
				return financeInvalid()
			}
			if !stringValue(v, 50, k == "incomeTypeCode" || k == "expenseTypeCode") {
				return financeInvalid()
			}
			if v != nil && ledgerText(v) != "" && !financeCode.MatchString(ledgerText(v)) {
				return financeInvalid()
			}
		case "subjectType":
			if !strings.Contains("|asset|liability|equity|cost|profit_loss|", "|"+ledgerText(v)+"|") {
				return financeInvalid()
			}
		case "costCategory":
			if v != nil && !strings.Contains("|project|sales|admin|finance|hr|asset|other|", "|"+ledgerText(v)+"|") {
				return financeInvalid()
			}
		case "bizType":
			if !strings.Contains("|receipt|expense|claim|payment|no_contract_income|", "|"+ledgerText(v)+"|") {
				return financeInvalid()
			}
		case "objectType":
			if !strings.Contains("|customer_project|internal_project|department|contract|customer|sales_region|opportunity|sales_campaign|employee|other|", "|"+ledgerText(v)+"|") {
				return financeInvalid()
			}
		case "requiredDimensions":
			rows, ok := v.([]any)
			if !ok || len(rows) > 10 {
				return financeInvalid()
			}
			seen := map[string]bool{}
			for _, x := range rows {
				k := ledgerText(x)
				if !strings.Contains("|project|contract|customer|department|employee|sales_region|", "|"+k+"|") || seen[k] {
					return financeInvalid()
				}
				seen[k] = true
			}
		case "objectStrategy":
			if !stringValue(v, 50, false) {
				return financeInvalid()
			}
		case "bizSubtype":
			if v == nil || !stringValue(v, 50, true) {
				return financeInvalid()
			}
		default:
			if !stringValue(v, 500, true) {
				return financeInvalid()
			}
			if k == "name" && (!stringValue(v, 100, false)) {
				return financeInvalid()
			}
		}
	}
	if sp.kind == "update" && ledgerVersion(i.Payload["expectedVersion"]) < 1 {
		return financeInvalid()
	}
	if sp.kind == "create" {
		keys := strings.Fields("code name")
		if sp.table == "finance_subject" {
			keys = append(keys, "subjectType")
		}
		if sp.table == "finance_accounting_object" {
			keys = append(keys, "objectType")
		}
		if sp.table == "finance_subject_mapping" {
			keys = strings.Fields("bizType defaultSubjectCode objectStrategy")
		}
		for _, k := range keys {
			if ledgerText(i.Payload[k]) == "" {
				return financeInvalid()
			}
		}
	}
	return nil
}
func settingsRow(ctx context.Context, tx *sql.Tx, table, code string, lock bool) (map[string]any, error) {
	cols := ledgerColumns(table)
	q := "SELECT " + financeSelect(cols) + " FROM " + table + " WHERE BINARY code=BINARY ?"
	if table == "finance_subject_mapping" {
		q = "SELECT " + financeSelect(cols) + " FROM " + table + " WHERE id=?"
	}
	if lock {
		q += " FOR UPDATE"
	}
	rows, e := tx.QueryContext(ctx, q, code)
	if e != nil {
		return nil, e
	}
	out, e := readFinanceRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if len(out) != 1 {
		return nil, ledgerError(404, "object_not_found")
	}
	return out[0], nil
}
func (s *Service) FinanceSettings(ctx context.Context, op string, i FinanceInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var dependency *mysql.MySQLError
		if errors.As(err, &dependency) {
			switch dependency.Number {
			case 1062, 1213, 1205:
				err = ledgerError(409, "write_conflict")
			case 1146, 1054:
				err = ledgerError(503, "13b_unavailable")
			}
		}
	}()
	if e := ValidateFinanceSettingsInput(op, i); e != nil {
		return nil, e
	}
	sp := financeSettingsOps[op]
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || scope.Access != "all" || len(scope.DepartmentCodes) != 0 {
		return nil, ledgerError(403, "scope_denied")
	}
	req, e := s.request("finance", enterprise.Read)
	if sp.write {
		req, e = s.request("finance", enterprise.Write)
	}
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if sp.write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	if sp.kind == "page" {
		var out any
		if op == "approval-instances-page" {
			if !domaininstall.IsFinance13bDomain(s.binding.Domains["finance"]) {
				return nil, ledgerError(503, "13b_unavailable")
			}
			parts := []string{}
			for _, table := range []string{"finance_invoice_request", "finance_expense_claim", "finance_project_expense_request", "finance_payment_request"} {
				parts = append(parts, "SELECT '"+table+"' AS entity_type,code,workflow_instance_id,status,updated_at FROM "+table+" WHERE deleted_at IS NULL AND workflow_instance_id IS NOT NULL")
			}
			union := "(" + strings.Join(parts, " UNION ALL ") + ") a"
			var total int64
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+union+" WHERE code LIKE ?", "%"+i.Search+"%").Scan(&total); e != nil {
				return nil, e
			}
			rows, e := tx.QueryContext(ctx, "SELECT entity_type,code,workflow_instance_id,status,updated_at FROM "+union+" WHERE code LIKE ? ORDER BY updated_at DESC,entity_type,code LIMIT ? OFFSET ?", "%"+i.Search+"%", i.PageSize, (i.Page-1)*i.PageSize)
			if e != nil {
				return nil, e
			}
			items, e := readFinanceRows(rows, strings.Fields("entity_type code workflow_instance_id status updated_at"))
			if e != nil {
				return nil, e
			}
			out = map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}
		} else {
			cols := ledgerColumns(sp.table)
			where := "1=1"
			args := []any{}
			if op == "audit-logs-page" {
				cols = strings.Fields("id entity_type entity_code action operator_uid channel created_at")
				where = "(entity_code LIKE ? OR action LIKE ?)"
				args = []any{"%" + i.Search + "%", "%" + i.Search + "%"}
			} else {
				key := "code"
				if sp.table == "finance_subject_mapping" {
					key = "CAST(id AS CHAR)"
				}
				where = "(" + key + " LIKE ?)"
				args = []any{"%" + i.Search + "%"}
				if i.Status != "" {
					where += " AND status=?"
					args = append(args, i.Status)
				}
			}
			if i.Code != "" {
				key := "code"
				if sp.table == "finance_subject_mapping" {
					key = "CAST(id AS CHAR)"
				}
				where += " AND BINARY " + key + "=BINARY ?"
				args = append(args, i.Code)
			}
			var total int64
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+sp.table+" WHERE "+where, args...).Scan(&total); e != nil {
				return nil, e
			}
			rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(cols)+" FROM "+sp.table+" WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", append(args, i.PageSize, (i.Page-1)*i.PageSize)...)
			if e != nil {
				return nil, e
			}
			items, e := readFinanceRows(rows, cols)
			if e != nil {
				return nil, e
			}
			out = map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	if who.Key == "" {
		return nil, financeInvalid()
	}
	// Use the same lexical reference-table order as expense writes. Serializing
	// the small configuration tables also makes hierarchy checks stable.
	for _, table := range []string{"finance_expense_type", "finance_income_type"} {
		rows, e := tx.QueryContext(ctx, "SELECT id FROM "+table+" ORDER BY id FOR UPDATE")
		if e != nil {
			return nil, e
		}
		if _, e = readFinanceRows(rows, []string{"id"}); e != nil {
			return nil, e
		}
	}
	graphRows, e := tx.QueryContext(ctx, "SELECT id,parent_id,code,status FROM finance_subject ORDER BY id FOR UPDATE")
	if e != nil {
		return nil, e
	}
	graph, e := readFinanceRows(graphRows, strings.Fields("id parent_id code status"))
	if e != nil {
		return nil, e
	}
	for _, key := range []string{"defaultSubjectId", "parentId", "defaultSubjectCode"} {
		v := i.Payload[key]
		if v == nil || ledgerText(v) == "" {
			continue
		}
		found := false
		for _, r := range graph {
			if (key == "defaultSubjectCode" && ledgerText(r["code"]) == ledgerText(v) || key != "defaultSubjectCode" && ledgerVersion(r["id"]) == ledgerVersion(v)) && r["status"] == "active" {
				found = true
			}
		}
		if !found {
			return nil, ledgerError(400, "reference_invalid")
		}
	}
	for _, pair := range [][2]string{{"expenseTypeCode", "finance_expense_type"}, {"incomeTypeCode", "finance_income_type"}} {
		if v := ledgerText(i.Payload[pair[0]]); v != "" {
			var id int64
			if e = tx.QueryRowContext(ctx, "SELECT id FROM "+pair[1]+" WHERE code=? AND status='active' FOR UPDATE", v).Scan(&id); e != nil {
				if e == sql.ErrNoRows {
					return nil, ledgerError(400, "reference_invalid")
				}
				return nil, e
			}
		}
	}
	var row map[string]any
	if sp.kind == "update" {
		row, e = settingsRow(ctx, tx, sp.table, i.Code, true)
		if e != nil {
			return nil, e
		}
	}
	if sp.table == "finance_subject" && i.Payload["parentId"] != nil {
		parent := ledgerVersion(i.Payload["parentId"])
		seen := map[int64]bool{ledgerVersion(row["id"]): true}
		for parent > 0 {
			if seen[parent] {
				return nil, ledgerError(400, "reference_invalid")
			}
			seen[parent] = true
			next := int64(0)
			for _, r := range graph {
				if ledgerVersion(r["id"]) == parent {
					next = ledgerVersion(r["parent_id"])
					break
				}
			}
			parent = next
		}
	}
	raw, _ := json.Marshal(map[string]any{"op": op, "intent": FinanceIntent(i), "actor": who.Actor})
	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"op": op, "intent": FinanceIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance13b|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	receipt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.13b." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fields := map[string]any{"updated_by": who.Actor}
		for k, v := range i.Payload {
			if col := settingsFields[k]; col != "" {
				if k == "requiredDimensions" {
					b, _ := json.Marshal(v)
					v = string(b)
				}
				fields[col] = v
			}
		}
		code := i.Code
		if sp.kind == "create" {
			fields["created_by"] = who.Actor
			if e = ledgerInsert(ctx, tx, sp.table, fields); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			code = ledgerText(fields["code"])
			if sp.table == "finance_subject_mapping" {
				var id int64
				if e = tx.QueryRowContext(ctx, "SELECT LAST_INSERT_ID()").Scan(&id); e != nil {
					return integrationoperation.ReceiptBusinessResult{}, e
				}
				code = ledgerText(id)
			}
		} else {
			if e = ledgerVersionCheck(row, i.Payload["expectedVersion"]); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			if sp.table == "finance_subject_mapping" {
				keys := []string{}
				values := []any{}
				for _, k := range settingsSortedKeys(fields) {
					keys = append(keys, k+"=?")
					values = append(values, fields[k])
				}
				values = append(values, row["id"])
				_, e = tx.ExecContext(ctx, "UPDATE "+sp.table+" SET "+strings.Join(keys, ",")+",row_version=row_version+1 WHERE id=?", values...)
			} else {
				e = ledgerUpdate(ctx, tx, sp.table, code, fields)
			}
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		value, e := settingsRow(ctx, tx, sp.table, code, false)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		b, _ := json.Marshal(map[string]any{"data": value})
		if _, e = tx.ExecContext(ctx, "INSERT INTO finance_audit_log(entity_type,entity_code,action,new_value,operator_uid,channel,request_id) VALUES(?,?,?,?,?,'user',?)", sp.table, code, op, string(b), who.Actor, oid); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: sp.table, TargetBizCode: oid, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(b)}, nil
	})
	if e != nil {
		return nil, e
	}
	var snapshot string
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM finance_audit_log WHERE request_id=? AND action=?", result.TargetBizCode, op).Scan(&snapshot); e != nil {
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

func settingsSortedKeys(m map[string]any) []string {
	keys := []string{}
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
