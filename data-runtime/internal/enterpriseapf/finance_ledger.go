package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ledgerSpec struct {
	table, resource, action, kind string
	write                         bool
}

// Closed operations. No table/action is selected by caller payload.
var financeLedgerOps = map[string]ledgerSpec{
	"invoice-requests-page":            {"finance_invoice_request", "invoices", "view", "page", false},
	"invoice-requests-detail":          {"finance_invoice_request", "invoices", "view", "detail", false},
	"invoice-requests-create":          {"finance_invoice_request", "invoices", "edit", "create", true},
	"invoice-requests-update":          {"finance_invoice_request", "invoices", "edit", "update", true},
	"invoice-requests-assign-issuance": {"finance_invoice_request", "invoices", "issue", "assign", true},
	"invoice-requests-issue":           {"finance_invoice_request", "invoices", "issue", "issue", true},
	"invoices-page":                    {"finance_invoice", "invoices", "view", "page", false},
	"invoices-detail":                  {"finance_invoice", "invoices", "view", "detail", false},
	"invoices-update":                  {"finance_invoice", "invoices", "edit", "update", true},
	"invoices-void":                    {"finance_invoice", "invoices", "edit", "void", true},
	"invoices-red-reverse":             {"finance_invoice", "invoices", "edit", "red-reverse", true},
	"receipts-page":                    {"finance_receipt", "receipts", "view", "page", false},
	"receipts-detail":                  {"finance_receipt", "receipts", "view", "detail", false},
	"receipts-create":                  {"finance_receipt", "receipts", "confirm", "create", true},
	"receipts-update":                  {"finance_receipt", "receipts", "confirm", "update", true},
	"receipts-confirm":                 {"finance_receipt", "receipts", "confirm", "confirm", true},
	"receipts-classify":                {"finance_receipt", "receipts", "edit", "classify", true},
	"receipts-delete":                  {"finance_receipt", "receipts", "edit", "delete", true},
	"reconciliation-page":              {"finance_reconciliation", "reconciliation", "view", "page", false},
	"reconciliation-create":            {"finance_reconciliation", "reconciliation", "confirm", "reconcile", true},
	"reconciliation-void":              {"finance_reconciliation", "reconciliation", "confirm", "reverse", true},
	"invoice-files-attach":             {"finance_attachment", "invoices", "edit", "attach", true},
	"invoice-files-read":               {"finance_attachment", "invoices", "view", "file", false},
}

func FinanceLedgerPermission(op string) (string, string, bool) {
	if sp, ok := financeReceivableOps[op]; ok {
		return sp.resource, sp.action, true
	}
	if r, a, ok := FinanceSettingsPermission(op); ok {
		return r, a, ok
	}
	if r, a, ok := FinanceSpendPermission(op); ok {
		return r, a, true
	}
	v, ok := financeLedgerOps[op]
	return v.resource, v.action, ok
}

// Issuance is a closed business action, never an authorization bypass.
func FinanceLedgerInputPermission(op string, i FinanceInput) (string, string, bool) {
	if op == "invoice-files-attach" && ledgerText(i.Payload["attachmentPurpose"]) == "issuance" {
		return "invoices", "issue", true
	}
	return FinancePermission(op)
}

func FinanceLedgerWrite(op string) bool {
	if sp, ok := financeReceivableOps[op]; ok {
		return sp.write
	}
	if sp, ok := financeSettingsOps[op]; ok {
		return sp.write
	}
	if sp, ok := financeSpendOps[op]; ok {
		return sp.write
	}
	return financeLedgerOps[op].write
}
func ledgerError(status int, code string) error {
	return httperror.New(status, "finance_"+code, "Finance command cannot be completed")
}

var ledgerFields = map[string]string{
	"customerCode": "customer_code", "customerName": "customer_name", "contractCode": "contract_code", "projectCode": "project_code", "billingScheduleCode": "billing_schedule_code", "invoiceProfileCode": "invoice_profile_code",
	"invoiceType": "invoice_type", "invoiceMedium": "invoice_medium", "invoiceItem": "invoice_item", "requestedAmount": "requested_amount", "currencyCode": "currency_code", "taxRate": "tax_rate", "taxpayerName": "taxpayer_name", "taxpayerNo": "taxpayer_no", "remark": "remark",
	"invoiceNo": "invoice_no", "invoiceDate": "invoice_date", "invoiceFileKey": "invoice_file_key", "invoiceFileName": "invoice_file_name", "invoiceFileMimeType": "invoice_file_mime_type", "invoiceFileSize": "invoice_file_size",
	"receiptNo": "receipt_no", "receivedAmount": "received_amount", "receivedAt": "received_at", "channel": "channel", "payerName": "payer_name", "handlerUid": "handler_uid", "bankAccountId": "bank_account_id", "receiptSourceType": "receipt_source_type", "note": "note",
	"responsibleUid": "reconciliation_responsible_uid", "dueAt": "reconciliation_due_at", "incomeTypeId": "income_type_id",
	"receiptCode": "receipt_code", "invoiceCode": "invoice_code", "targetType": "target_type", "reconciledAmount": "reconciled_amount", "reason": "reason",
	"fileKey": "file_key", "fileName": "file_name", "mimeType": "mime_type", "fileSize": "file_size", "fileSha256": "file_sha256", "entityType": "entity_type", "entityCode": "entity_code",
}

func ledgerAllowed(op string) []string {
	switch op {
	case "invoice-requests-create", "invoice-requests-update":
		return strings.Fields("customerCode customerName contractCode billingScheduleCode invoiceProfileCode invoiceType invoiceMedium invoiceItem requestedAmount currencyCode taxRate taxpayerName taxpayerNo remark canceled")
	case "invoice-requests-assign-issuance":
		return []string{"responsibleUid", "dueAt"}
	case "invoice-requests-issue":
		return strings.Fields("invoiceNo invoiceDate invoiceFileKey invoiceFileName invoiceFileMimeType invoiceFileSize")
	case "invoices-update":
		return strings.Fields("invoiceItem remark")
	case "invoices-void", "invoices-red-reverse", "reconciliation-void":
		return strings.Fields("reason invoiceNo")
	case "receipts-create", "receipts-update":
		return strings.Fields("customerCode customerName contractCode projectCode billingScheduleCode receiptNo receivedAmount receivedAt currencyCode channel payerName handlerUid bankAccountId receiptSourceType note responsibleUid dueAt")
	case "receipts-classify":
		return strings.Fields("incomeTypeId note")
	case "reconciliation-create":
		return strings.Fields("receiptCode invoiceCode billingScheduleCode contractCode targetType reconciledAmount currencyCode note receiptVersion invoiceVersion scheduleVersion")
	case "invoice-files-attach":
		return strings.Fields("entityType entityCode fileKey fileName mimeType fileSize fileSha256 attachmentPurpose")
	}
	return nil
}
func ValidateFinanceLedgerInput(op string, i FinanceInput) error {
	if _, ok := financeReceivableOps[op]; ok {
		return ValidateFinanceReceivableInput(op, i)
	}
	if _, ok := financeSettingsOps[op]; ok {
		return ValidateFinanceSettingsInput(op, i)
	}
	if _, ok := financeSpendOps[op]; ok {
		return ValidateFinanceSpendInput(op, i)
	}
	sp, ok := financeLedgerOps[op]
	if !ok {
		return financeInvalid()
	}
	if i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if sp.kind == "page" {
		if i.Code != "" || len(i.Payload) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len(i.Search) > 200 || strings.ContainsAny(i.Search+i.Status, "\x00\r\n") {
			return financeInvalid()
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" {
		return financeInvalid()
	}
	create := sp.kind == "create" || sp.kind == "reconcile" || sp.kind == "attach"
	if create && i.Code != "" || !create && !financeCode.MatchString(i.Code) {
		return financeInvalid()
	}
	if !sp.write {
		if len(i.Payload) > 0 {
			return financeInvalid()
		}
		return nil
	}
	allowed := map[string]bool{}
	for _, k := range ledgerAllowed(op) {
		allowed[k] = true
	}
	if !create {
		allowed["expectedVersion"] = true
	}
	for k, v := range i.Payload {
		if !allowed[k] {
			return financeInvalid()
		}
		switch k {
		case "expectedVersion", "receiptVersion", "invoiceVersion", "scheduleVersion", "bankAccountId", "incomeTypeId", "invoiceFileSize", "fileSize":
			n, ok := v.(float64)
			if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
				return financeInvalid()
			}
		case "canceled":
			if v != true {
				return financeInvalid()
			}
		default:
			if v != nil && !stringValue(v, 500, true) {
				return financeInvalid()
			}
		}
	}
	if !create && ledgerVersion(i.Payload["expectedVersion"]) < 1 {
		return financeInvalid()
	}
	for _, k := range []string{"requestedAmount", "receivedAmount", "reconciledAmount"} {
		if v, ok := i.Payload[k]; ok {
			if !decimalValid(v, 18, 2) || moneyCents(fmt.Sprint(v)).Sign() <= 0 {
				return financeInvalid()
			}
		}
	}
	if v, ok := i.Payload["taxRate"]; ok && (!decimalValid(v, 5, 2) || moneyCents(fmt.Sprint(v)).Cmp(big.NewInt(10000)) > 0) {
		return financeInvalid()
	}
	if v, ok := i.Payload["currencyCode"]; ok && !currencyCode.MatchString(fmt.Sprint(v)) {
		return financeInvalid()
	}
	for _, k := range []string{"receivedAt", "invoiceDate"} {
		if v, ok := i.Payload[k]; ok && !dateValid(fmt.Sprint(v)) {
			return financeInvalid()
		}
	}
	for _, k := range []string{"fileKey", "invoiceFileKey"} {
		if v, ok := i.Payload[k]; ok {
			key := fmt.Sprint(v)
			if !strings.HasPrefix(key, "finance/invoices/") || strings.Contains(key, "..") || strings.ContainsAny(key, "?\\#:\x00") {
				return financeInvalid()
			}
		}
	}

	for _, key := range []string{"customerCode", "contractCode", "projectCode", "billingScheduleCode", "invoiceProfileCode", "receiptCode", "invoiceCode", "entityCode"} {
		if v, ok := i.Payload[key]; ok && v != nil && !financeCode.MatchString(ledgerText(v)) {
			return financeInvalid()
		}
	}
	for _, key := range []string{"responsibleUid", "handlerUid"} {
		if v, ok := i.Payload[key]; ok {
			uid := ledgerText(v)
			if len(uid) > 64 || uid == "" || uid == "@all" || strings.TrimSpace(uid) != uid {
				return financeInvalid()
			}
		}
	}
	if v, ok := i.Payload["dueAt"]; ok {
		if v != nil {
			text := ledgerText(v)
			if len(text) != 19 || !dateValid(text[:10]) || text[10] != ' ' {
				return financeInvalid()
			}
			if _, e := time.Parse("2006-01-02 15:04:05", text); e != nil {
				return financeInvalid()
			}
		}
	}
	if op == "receipts-create" || op == "receipts-update" {
		_, a := i.Payload["responsibleUid"]
		_, b := i.Payload["dueAt"]
		if a != b {
			return financeInvalid()
		}
	}
	enums := map[string][]string{"invoiceMedium": {"electronic", "paper"}, "invoiceType": {"special_vat", "general_vat", "electronic", "other"}, "channel": {"cash", "bank_transfer", "third_party", "other"}, "receiptSourceType": {"contract", "no_contract", "pre_contract", "other"}}
	for key, values := range enums {
		if v, ok := i.Payload[key]; ok {
			valid := false
			for _, candidate := range values {
				if v == candidate {
					valid = true
				}
			}
			if !valid {
				return financeInvalid()
			}
		}
	}
	if sp.kind == "create" {
		required := []string{"requestedAmount", "currencyCode", "invoiceItem"}
		if sp.table == "finance_receipt" {
			required = []string{"receivedAmount", "currencyCode", "receivedAt", "responsibleUid", "dueAt"}
		}
		for _, k := range required {
			if ledgerText(i.Payload[k]) == "" {
				return financeInvalid()
			}
		}
	}
	if sp.kind == "assign" {
		if ledgerText(i.Payload["responsibleUid"]) == "" || ledgerText(i.Payload["dueAt"]) == "" {
			return financeInvalid()
		}
	}
	if sp.kind == "issue" {
		for _, k := range strings.Fields("invoiceNo invoiceDate invoiceFileKey invoiceFileName invoiceFileMimeType invoiceFileSize") {
			if ledgerText(i.Payload[k]) == "" {
				return financeInvalid()
			}
		}
	}
	if sp.kind == "reconcile" {
		if ledgerText(i.Payload["receiptCode"]) == "" || ledgerVersion(i.Payload["receiptVersion"]) < 1 || ledgerText(i.Payload["reconciledAmount"]) == "" {
			return financeInvalid()
		}
	}
	if sp.kind == "attach" {
		for _, k := range strings.Fields("entityType entityCode fileKey fileName mimeType fileSize fileSha256") {
			if ledgerText(i.Payload[k]) == "" {
				return financeInvalid()
			}
		}
		if purpose, exists := i.Payload["attachmentPurpose"]; exists && (purpose != "issuance" || i.Payload["entityType"] != "finance_invoice_request") {
			return financeInvalid()
		}
		if len(ledgerText(i.Payload["fileSha256"])) != 64 {
			return financeInvalid()
		}
	}
	return nil
}
func ledgerText(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func ledgerVersion(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case uint64:
		return int64(x)
	case float64:
		return int64(x)
	case string:
		n, _ := strconv.ParseInt(x, 10, 64)
		return n
	}
	return 0
}
func moneyCents(v string) *big.Int {
	parts := strings.SplitN(v, ".", 2)
	f := "00"
	if len(parts) == 2 {
		f = (parts[1] + "00")[:2]
	}
	n := new(big.Int)
	n.SetString(parts[0]+f, 10)
	return n
}
func centsText(n *big.Int) string {
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(n, big.NewInt(100), r)
	return fmt.Sprintf("%s.%02d", q.String(), r.Int64())
}
func ledgerColumns(table string) []string {
	base, _ := domaininstall.APFTables("finance")
	for _, t := range append(append(append(base, domaininstall.FinanceB3Tables()...), domaininstall.Finance13aTables()...), domaininstall.Finance13bTables()...) {
		if t.Logical == table {
			if table == "finance_payment_request" {
				cols := []string{}
				for _, c := range t.Columns {
					if c != "payee_account_secret_ref" {
						cols = append(cols, c)
					}
				}
				return cols
			}
			return t.Columns
		}
	}
	return nil
}
func ledgerRow(ctx context.Context, tx *sql.Tx, table, code string, lock bool) (map[string]any, error) {
	cols := ledgerColumns(table)
	if len(cols) == 0 {
		return nil, financeInvalid()
	}
	q := "SELECT " + financeSelect(cols) + " FROM " + table + " WHERE BINARY code=BINARY ?"
	if table != "finance_reconciliation" {
		q += " AND deleted_at IS NULL"
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
func ledgerScope(row map[string]any, scope altoc.BasicReadScope, actor string) bool {
	if scope.Access == "all" {
		return true
	}
	if scope.Access != "self" {
		return false
	}
	if (row["status"] == "draft" || row["status"] == "rejected") && ledgerText(row["requested_by"]) == actor {
		return true
	}
	for _, k := range []string{"issuance_responsible_uid", "reconciliation_responsible_uid", "issued_by", "reconciled_by"} {
		if ledgerText(row[k]) == actor {
			return true
		}
	}
	return false
}

// Caller-Tx owning Finance core. Only this wrapper commits; all downstream SQL shares it.
func (s *Service) FinanceLedger(ctx context.Context, op string, i FinanceInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	if _, ok := financeSettingsOps[op]; ok {
		return s.FinanceSettings(ctx, op, i, who, scope)
	}
	if _, ok := financeSpendOps[op]; ok {
		return s.FinanceSpend(ctx, op, i, who, scope)
	}
	defer func() {
		var m *mysql.MySQLError
		if errors.As(err, &m) && (m.Number == 1213 || m.Number == 1205 || m.Number == 1062) {
			err = ledgerError(409, "write_conflict")
		}
	}()
	if _, ok := financeReceivableOps[op]; ok {
		return s.FinanceReceivables(ctx, op, i, who, scope)
	}
	if e := ValidateFinanceLedgerInput(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment {
		return nil, ledgerError(403, "identity_invalid")
	}
	if scope.Access != "all" && scope.Access != "self" {
		return nil, ledgerError(403, "scope_denied")
	}
	if !domaininstall.IsFinanceB3Domain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "b3_unavailable")
	}
	sp := financeLedgerOps[op]
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
		out, e = ledgerRead(ctx, tx, sp, i, scope, who)
		if e == nil {
			e = tx.Commit()
		}
		return out, e
	}
	if who.Key == "" {
		return nil, financeInvalid()
	}
	locked, e := ledgerLock(ctx, tx, sp, i, who, scope, domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"]))
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
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance11a|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	receipt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.11a." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		value, e := ledgerMutate(ctx, tx, op, sp, i, who, locked, oid)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e = ledgerSummaries(ctx, tx, locked); e != nil {
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

// Applicant can track their own submitted request; this is read-only and does not widen write responsibility.
func ledgerReadScope(table string, row map[string]any, scope altoc.BasicReadScope, actor string) bool {
	return ledgerScope(row, scope, actor) || table == "finance_invoice_request" && scope.Access == "self" && ledgerText(row["requested_by"]) == actor
}

func ledgerRead(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, scope altoc.BasicReadScope, who Identity) (any, error) {
	if sp.kind != "page" {
		row, e := ledgerRow(ctx, tx, sp.table, i.Code, false)
		if e != nil {
			return nil, e
		}
		if sp.kind == "file" {
			parent := ledgerText(row["entity_type"])
			if parent != "finance_invoice" && parent != "finance_invoice_request" {
				return nil, financeInvalid()
			}
			p, e := ledgerRow(ctx, tx, parent, ledgerText(row["entity_code"]), false)
			if e != nil {
				return nil, e
			}
			if !ledgerReadScope(parent, p, scope, who.Actor) {
				return nil, ledgerError(403, "scope_denied")
			}
		} else if !ledgerReadScope(sp.table, row, scope, who.Actor) {
			return nil, ledgerError(403, "scope_denied")
		}
		if sp.kind == "detail" && sp.table == "finance_invoice" {
			rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(ledgerColumns("finance_reconciliation"))+" FROM finance_reconciliation WHERE invoice_id=? ORDER BY id DESC LIMIT 100", row["id"])
			if e != nil {
				return nil, e
			}
			row["reconciliations"], e = readFinanceRows(rows, ledgerColumns("finance_reconciliation"))
			if e != nil {
				return nil, e
			}
		}

		if sp.kind == "detail" {
			if sp.table == "finance_receipt" && ledgerText(row["contract_code"]) != "" {
				candidates, err := altoc.ReadFinanceBillingCandidatesTx(ctx, tx, ledgerText(row["contract_code"]))
				if err != nil {
					return nil, err
				}
				row["billing_candidates"] = candidates
			}
			if bs := ledgerText(row["billing_schedule_code"]); bs != "" {
				var v int64
				if e := tx.QueryRowContext(ctx, "SELECT row_version FROM altoc_billing_schedule WHERE code=? AND deleted_at IS NULL", bs).Scan(&v); e != nil {
					return nil, e
				}
				row["billing_schedule_version"] = v
			}
			if sp.table == "finance_invoice_request" || sp.table == "finance_invoice" {
				parentCode := ""
				if sp.table == "finance_invoice" && ledgerVersion(row["invoice_request_id"]) > 0 {
					if err := tx.QueryRowContext(ctx, "SELECT code FROM finance_invoice_request WHERE id=? AND deleted_at IS NULL", row["invoice_request_id"]).Scan(&parentCode); err != nil {
						return nil, err
					}
				}
				rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(ledgerColumns("finance_attachment"))+" FROM finance_attachment WHERE ((entity_type=? AND entity_code=?) OR (entity_type='finance_invoice_request' AND entity_code=?)) AND deleted_at IS NULL ORDER BY id DESC", sp.table, i.Code, parentCode)
				if e != nil {
					return nil, e
				}
				row["attachments"], e = readFinanceRows(rows, ledgerColumns("finance_attachment"))
				if e != nil {
					return nil, e
				}
			}
		}
		return map[string]any{"data": row}, nil
	}
	where := "1=1"
	if sp.table != "finance_reconciliation" {
		where = "deleted_at IS NULL"
	}
	args := []any{}
	if scope.Access == "self" {
		column := map[string]string{"finance_invoice_request": "issuance_responsible_uid", "finance_invoice": "issued_by", "finance_receipt": "reconciliation_responsible_uid", "finance_reconciliation": "reconciled_by"}[sp.table]
		if sp.table == "finance_invoice_request" {
			where += " AND (issuance_responsible_uid=? OR requested_by=?)"
			args = append(args, who.Actor, who.Actor)
		} else {
			where += " AND " + column + "=?"
			args = append(args, who.Actor)
		}
	}
	if i.Status != "" {
		where += " AND status=?"
		args = append(args, i.Status)
	}
	if i.Search != "" {
		where += " AND (code LIKE ? OR contract_code LIKE ?)"
		pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(i.Search) + "%"
		args = append(args, pattern, pattern)
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
func ledgerLock(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, who Identity, scope altoc.BasicReadScope, continuation ...bool) (map[string]map[string]any, error) {
	discovered := map[string]map[string]any{}
	codes := map[string]string{}
	create := sp.kind == "create" || sp.kind == "reconcile" || sp.kind == "attach"
	if !create {
		row, e := ledgerRow(ctx, tx, sp.table, i.Code, false)
		if e != nil {
			return nil, e
		}
		discovered[sp.table] = row
		codes[sp.table] = i.Code
	}
	if sp.kind == "reconcile" {
		codes["finance_receipt"] = ledgerText(i.Payload["receiptCode"])
		if v := ledgerText(i.Payload["invoiceCode"]); v != "" {
			codes["finance_invoice"] = v
		}
	}
	if sp.kind == "reverse" {
		row := discovered[sp.table]
		for table, id := range map[string]any{"finance_receipt": row["receipt_id"], "finance_invoice": row["invoice_id"]} {
			if id == nil {
				continue
			}
			var c string
			if e := tx.QueryRowContext(ctx, "SELECT code FROM "+table+" WHERE id=?", id).Scan(&c); e != nil {
				return nil, e
			}
			codes[table] = c
		}
	}
	if sp.kind == "attach" {
		t := ledgerText(i.Payload["entityType"])
		if t != "finance_invoice" && t != "finance_invoice_request" {
			return nil, financeInvalid()
		}
		codes[t] = ledgerText(i.Payload["entityCode"])
	}
	for t, c := range codes {
		if _, ok := discovered[t]; !ok {
			row, e := ledgerRow(ctx, tx, t, c, false)
			if e != nil {
				return nil, e
			}
			discovered[t] = row
		}
	}
	contract, schedule := ledgerText(i.Payload["contractCode"]), ledgerText(i.Payload["billingScheduleCode"])
	for _, t := range []string{"finance_invoice_request", "finance_invoice", "finance_receipt", "finance_reconciliation"} {
		row := discovered[t]
		if row == nil {
			continue
		}
		c, bs := ledgerText(row["contract_code"]), ledgerText(row["billing_schedule_code"])
		if c != "" {
			if contract != "" && contract != c {
				return nil, ledgerError(409, "allocation_target_mismatch")
			}
			contract = c
		}
		if bs != "" {
			if schedule != "" && schedule != bs {
				return nil, ledgerError(409, "allocation_target_mismatch")
			}
			schedule = bs
		}
	}
	locked := map[string]map[string]any{}
	if contract != "" {
		// Discovery does not acquire object locks. Lock customer before contract.
		var cid int64
		if e := tx.QueryRowContext(ctx, "SELECT customer_id FROM altoc_contract WHERE BINARY code=BINARY ? AND deleted_at IS NULL", contract).Scan(&cid); e != nil {
			return nil, e
		}
		var uid string
		if e := tx.QueryRowContext(ctx, "SELECT code FROM altoc_customer WHERE id=? AND deleted_at IS NULL FOR UPDATE", cid).Scan(&uid); e != nil {
			return nil, e
		}
		var id, customer, version int64
		var currency, status string
		if e := tx.QueryRowContext(ctx, "SELECT id,customer_id,row_version,currency_code,legal_status FROM altoc_contract WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", contract).Scan(&id, &customer, &version, &currency, &status); e != nil {
			return nil, e
		}
		if cid != customer {
			return nil, ledgerError(409, "write_conflict")
		}
		// Imported contracts have no receivable facts until the P1 opening batch;
		// billing them now would diverge from Altoc without anyone noticing.
		if _, origin, e := contractW1State(ctx, tx, "altoc_contract", strconv.FormatInt(id, 10)); e != nil {
			return nil, e
		} else if origin == "historical_import" {
			if len(continuation) == 0 || !continuation[0] {
				return nil, ledgerError(409, "historical_contract_not_ready")
			}
			ready, e := historicalContinuation(ctx, tx, contract, schedule)
			if e != nil {
				return nil, e
			}
			if date := ledgerText(i.Payload["invoiceDate"]); date != "" && (len(date) < 10 || date[:10] <= ledgerText(ready["cutoff_date"])[:10]) {
				return nil, ledgerError(409, "before_opening_cutoff")
			}
			if at := ledgerText(i.Payload["receivedAt"]); at != "" && (len(at) < 10 || at[:10] <= ledgerText(ready["cutoff_date"])[:10]) {
				return nil, ledgerError(409, "before_opening_cutoff")
			}
		}
		locked["altoc_contract"] = map[string]any{"id": id, "code": contract, "currency_code": currency, "customer_code": uid, "row_version": version, "legal_status": status}
	}
	if schedule != "" {
		var id, cid, version int64
		var currency, status, direction, amount string
		if e := tx.QueryRowContext(ctx, "SELECT id,contract_id,row_version,currency_code,status,direction,amount FROM altoc_billing_schedule WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", schedule).Scan(&id, &cid, &version, &currency, &status, &direction, &amount); e != nil {
			return nil, e
		}
		if locked["altoc_contract"] == nil || cid != ledgerVersion(locked["altoc_contract"]["id"]) || direction != "receivable" {
			return nil, ledgerError(409, "allocation_target_mismatch")
		}
		locked["altoc_billing_schedule"] = map[string]any{"id": id, "code": schedule, "row_version": version, "currency_code": currency, "status": status, "amount": amount, "continuation_installed": len(continuation) > 0 && continuation[0]}
	}
	for _, t := range []string{"finance_invoice_request", "finance_invoice", "finance_receipt", "finance_reconciliation"} {
		if c := codes[t]; c != "" {
			row, e := ledgerRow(ctx, tx, t, c, true)
			if e != nil {
				return nil, e
			}
			if ledgerVersion(row["row_version"]) != ledgerVersion(discovered[t]["row_version"]) {
				return nil, ledgerError(409, "version_conflict")
			}
			locked[t] = row
		}
	}
	parent := locked[sp.table]
	if sp.kind == "attach" {
		parent = locked[ledgerText(i.Payload["entityType"])]
	}
	if sp.kind == "reconcile" || sp.kind == "reverse" {
		parent = locked["finance_receipt"]
	}
	if sp.kind == "attach" {
		if e := requireFinanceAttachmentAction(parent, i.Payload, who.Actor); e != nil {
			return nil, e
		}
	}
	if parent != nil && !ledgerScope(parent, scope, who.Actor) {
		return nil, ledgerError(403, "scope_denied")
	}
	if create && sp.kind == "create" && scope.Access != "all" && ledgerText(i.Payload["responsibleUid"]) != "" && ledgerText(i.Payload["responsibleUid"]) != who.Actor {
		return nil, ledgerError(403, "scope_denied")
	}
	// A new request is self-responsible until an explicit issue-authorized assignment.
	if sp.table == "finance_attachment" && sp.kind != "attach" {
		row, e := ledgerRow(ctx, tx, sp.table, i.Code, true)
		if e != nil {
			return nil, e
		}
		locked[sp.table] = row
	}
	if contract != "" {
		if _, e := tx.ExecContext(ctx, "INSERT IGNORE INTO finance_contract_summary(contract_code,currency_code,input_sha256) VALUES (?,?,?)", contract, locked["altoc_contract"]["currency_code"], strings.Repeat("0", 64)); e != nil {
			return nil, e
		}
		var v int64
		if e := tx.QueryRowContext(ctx, "SELECT row_version FROM finance_contract_summary WHERE contract_code=? FOR UPDATE", contract).Scan(&v); e != nil {
			return nil, e
		}
	}
	if sp.kind == "classify" {
		var id int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM finance_unclassified_income WHERE receipt_id=? FOR UPDATE", locked["finance_receipt"]["id"]).Scan(&id)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
	}
	if sp.kind == "attach" {
		var id int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM finance_attachment WHERE file_key=? FOR UPDATE", i.Payload["fileKey"]).Scan(&id)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
	}
	return locked, nil
}
func ledgerUpdate(ctx context.Context, tx *sql.Tx, table, code string, fields map[string]any) error {
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	sets := []string{}
	args := []any{}
	for _, k := range keys {
		sets = append(sets, k+"=?")
		args = append(args, fields[k])
	}
	sets = append(sets, "row_version=row_version+1")
	args = append(args, code)
	_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE BINARY code=BINARY ?", args...)
	return e
}
func ledgerInsert(ctx context.Context, tx *sql.Tx, table string, fields map[string]any) error {
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	args := []any{}
	for _, k := range keys {
		args = append(args, fields[k])
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO "+table+"("+strings.Join(keys, ",")+") VALUES ("+strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")+")", args...)
	return e
}
func ledgerMutationFields(op string, p map[string]any) map[string]any {
	m := map[string]any{}
	for _, k := range ledgerAllowed(op) {
		if v, ok := p[k]; ok {
			column := ledgerFields[k]
			if column != "" {
				m[column] = v
			}
		}
	}
	return m
}
func ledgerVersionCheck(row map[string]any, v any) error {
	if row == nil || ledgerVersion(row["row_version"]) != ledgerVersion(v) {
		return ledgerError(409, "version_conflict")
	}
	return nil
}
func requireFinanceAttachmentAction(parent map[string]any, payload map[string]any, actor string) error {
	issuance := ledgerText(payload["attachmentPurpose"]) == "issuance"
	pending := payload["entityType"] == "finance_invoice_request" && parent["status"] == "approved"
	if !issuance && pending {
		return ledgerError(403, "invoice_attachment_issue_required")
	}
	if issuance {
		if !pending {
			return ledgerError(409, "invalid_status")
		}
		if actor == "" || ledgerText(parent["issuance_responsible_uid"]) != actor {
			return ledgerError(403, "invoice_issuance_responsible_required")
		}
		return requireFinanceIssueSeparation(parent, actor)
	}
	return nil
}

func requireFinanceIssueSeparation(row map[string]any, actor string) error {
	if actor == "" || ledgerText(row["requested_by"]) == "" || ledgerText(row["requested_by"]) == actor {
		return ledgerError(403, "invoice_issue_duty_separation_required")
	}
	return nil
}
func requireFinanceReconciliationSeparation(row map[string]any, actor string) error {
	if actor == "" || ledgerText(row["confirmed_by"]) == "" || ledgerText(row["confirmed_by"]) == actor {
		return ledgerError(403, "reconciliation_duty_separation_required")
	}
	return nil
}
func ledgerMutate(ctx context.Context, tx *sql.Tx, op string, sp ledgerSpec, i FinanceInput, who Identity, locked map[string]map[string]any, oid string) (map[string]any, error) {
	row := locked[sp.table]
	if row != nil {
		if e := ledgerVersionCheck(row, i.Payload["expectedVersion"]); e != nil {
			return nil, e
		}
	}
	code := i.Code
	fields := ledgerMutationFields(op, i.Payload)
	fields["updated_by"] = who.Actor
	if c := locked["altoc_contract"]; c != nil {
		if v := fields["currency_code"]; v != nil && v != c["currency_code"] {
			return nil, ledgerError(409, "currency_mismatch")
		}
		if v := fields["customer_code"]; v != nil && v != c["customer_code"] {
			return nil, ledgerError(409, "allocation_target_mismatch")
		}
		if v := fields["contract_code"]; v != nil && v != c["code"] {
			return nil, ledgerError(409, "allocation_target_mismatch")
		}
	}
	if sp.table == "finance_invoice_request" && (sp.kind == "create" || sp.kind == "update") {
		if profile := ledgerText(fields["invoice_profile_code"]); profile != "" {
			customer := ledgerText(fields["customer_code"])
			if customer == "" && row != nil {
				customer = ledgerText(row["customer_code"])
			}
			name, no, kind, err := altoc.ReadFinanceInvoiceProfileTx(ctx, tx, profile, customer)
			if err != nil {
				if err == sql.ErrNoRows {
					return nil, ledgerError(409, "invoice_profile_unavailable")
				}
				return nil, err
			}
			fields["taxpayer_name"] = name
			fields["taxpayer_no"] = no
			fields["invoice_type"] = kind
		}
	}
	switch sp.kind {
	case "create":
		code = map[string]string{"finance_invoice_request": "IR-", "finance_receipt": "RC-"}[sp.table] + strings.ReplaceAll(oid, "-", "")
		fields["code"] = code
		fields["created_by"] = who.Actor
		fields["status"] = "draft"
		if sp.table == "finance_invoice_request" {
			fields["source_app"] = "finance"
			fields["source_biz_type"] = "manual"
			fields["requested_by"] = who.Actor
			fields["idempotency_key"] = oid
			// Do not invent a due date: new requests have no issue responsibility until assigned.
			delete(fields, "issuance_responsible_uid")
			delete(fields, "issuance_due_at")
			if bs := locked["altoc_billing_schedule"]; bs != nil {
				if bs["status"] != "billable" && bs["status"] != "invoicing" {
					return nil, ledgerError(409, "schedule_not_billable")
				}
				var used string
				if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(requested_amount),0) AS CHAR) FROM finance_invoice_request WHERE billing_schedule_code=? AND status NOT IN ('canceled','rejected') AND deleted_at IS NULL", bs["code"]).Scan(&used); e != nil {
					return nil, e
				}
				if new(big.Int).Add(moneyCents(used), moneyCents(ledgerText(fields["requested_amount"]))).Cmp(moneyCents(ledgerText(bs["amount"]))) > 0 {
					return nil, ledgerError(409, "amount_exceeded")
				}
			}
		}
		if sp.table == "finance_receipt" {
			if fields["receipt_source_type"] == nil {
				fields["receipt_source_type"] = "contract"
			}
			if e := ledgerBank(ctx, tx, fields); e != nil {
				return nil, e
			}
		}
		if e := ledgerInsert(ctx, tx, sp.table, fields); e != nil {
			return nil, e
		}
	case "update":
		if sp.table == "finance_invoice_request" {
			if row["status"] != "draft" && row["status"] != "rejected" {
				return nil, ledgerError(409, "invalid_status")
			}
			if i.Payload["canceled"] == true {
				fields["status"] = "canceled"
			}
		}
		if sp.table == "finance_invoice" && row["status"] != "issued" && row["status"] != "draft" {
			return nil, ledgerError(409, "invalid_status")
		}
		if sp.table == "finance_receipt" {
			if row["status"] != "draft" {
				return nil, ledgerError(409, "invalid_status")
			}
			bankFields := map[string]any{"currency_code": row["currency_code"]}
			if row["bank_account_id"] != nil {
				bankFields["bank_account_id"] = row["bank_account_id"]
			}
			for k, v := range fields {
				bankFields[k] = v
			}
			if e := ledgerBank(ctx, tx, bankFields); e != nil {
				return nil, e
			}
		}

		if sp.table == "finance_invoice_request" && i.Payload["canceled"] != true {
			if bs := locked["altoc_billing_schedule"]; bs != nil {
				var used string
				if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(requested_amount),0) AS CHAR) FROM finance_invoice_request WHERE billing_schedule_code=? AND code<>? AND status NOT IN ('canceled','rejected') AND deleted_at IS NULL", bs["code"], code).Scan(&used); e != nil {
					return nil, e
				}
				amount := row["requested_amount"]
				if v, ok := fields["requested_amount"]; ok {
					amount = v
				}
				if new(big.Int).Add(moneyCents(used), moneyCents(ledgerText(amount))).Cmp(moneyCents(ledgerText(bs["amount"]))) > 0 {
					return nil, ledgerError(409, "amount_exceeded")
				}
			}
		}
		if len(fields) == 1 {
			return nil, financeInvalid()
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
	case "assign":
		if row["status"] != "approved" {
			return nil, ledgerError(409, "invalid_status")
		}
		fields = map[string]any{"issuance_responsible_uid": i.Payload["responsibleUid"], "issuance_due_at": i.Payload["dueAt"], "updated_by": who.Actor}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
	case "issue":
		if row["status"] != "approved" {
			return nil, ledgerError(409, "invalid_status")
		}
		if e := requireFinanceIssueSeparation(row, who.Actor); e != nil {
			return nil, e
		}
		var fileName, mimeType string
		var fileSize int64
		if err := tx.QueryRowContext(ctx, "SELECT file_name,mime_type,file_size FROM finance_attachment WHERE entity_type='finance_invoice_request' AND entity_code=? AND file_key=? AND deleted_at IS NULL", code, i.Payload["invoiceFileKey"]).Scan(&fileName, &mimeType, &fileSize); err != nil {
			if err == sql.ErrNoRows {
				return nil, ledgerError(409, "invoice_attachment_required")
			}
			return nil, err
		}
		invoiceCode := "INV-" + strings.ReplaceAll(oid, "-", "")
		inv := map[string]any{"code": invoiceCode, "invoice_request_id": row["id"], "invoice_amount": row["requested_amount"], "status": "issued", "issued_by": who.Actor, "created_by": who.Actor, "updated_by": who.Actor}
		for _, k := range []string{"customer_code", "customer_name", "contract_code", "billing_schedule_code", "currency_code", "invoice_type", "invoice_medium", "invoice_item", "tax_rate", "taxpayer_name", "taxpayer_no", "remark"} {
			if row[k] != nil {
				inv[k] = row[k]
			}
		}
		for k, v := range fields {
			inv[k] = v
		}
		// Immutable owning attachment metadata is authoritative, not browser claims.
		inv["invoice_file_name"] = fileName
		inv["invoice_file_mime_type"] = mimeType
		inv["invoice_file_size"] = fileSize
		if e := ledgerInsert(ctx, tx, "finance_invoice", inv); e != nil {
			return nil, e
		}
		var invoiceID int64
		if e := tx.QueryRowContext(ctx, "SELECT id FROM finance_invoice WHERE code=?", invoiceCode).Scan(&invoiceID); e != nil {
			return nil, e
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, map[string]any{"status": "issued", "issued_invoice_id": invoiceID, "issued_by": who.Actor, "updated_by": who.Actor}); e != nil {
			return nil, e
		}
	case "void", "red-reverse":
		if row["status"] != "issued" && row["status"] != "draft" {
			return nil, ledgerError(409, "invalid_status")
		}
		if moneyCents(ledgerText(row["reconciled_amount"])).Sign() != 0 {
			return nil, ledgerError(409, "invoice_has_reconciliation")
		}
		if ledgerText(i.Payload["reason"]) == "" {
			return nil, financeInvalid()
		}
		if sp.kind == "red-reverse" {
			if ledgerText(i.Payload["invoiceNo"]) == "" {
				return nil, financeInvalid()
			}
			red := map[string]any{}
			for _, k := range ledgerColumns("finance_invoice") {
				if row[k] != nil {
					red[k] = row[k]
				}
			}
			for _, k := range []string{"id", "unreconciled_amount", "created_at", "updated_at", "deleted_at", "row_version"} {
				delete(red, k)
			}
			red["code"] = "RED-" + strings.ReplaceAll(oid, "-", "")
			red["invoice_no"] = i.Payload["invoiceNo"]
			red["status"] = "red_reversed"
			red["reversal_of_invoice_id"] = row["id"]
			red["reversed_by"] = who.Actor
			red["created_by"] = who.Actor
			red["reconciled_amount"] = "0.00"
			if e := ledgerInsert(ctx, tx, "finance_invoice", red); e != nil {
				return nil, e
			}
			if _, e := tx.ExecContext(ctx, "UPDATE finance_invoice SET reversed_at=CURRENT_TIMESTAMP(3),reverse_reason=? WHERE code=?", i.Payload["reason"], red["code"]); e != nil {
				return nil, e
			}
		}
		status := "canceled"
		if sp.kind == "red-reverse" {
			status = "red_reversed"
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, map[string]any{"status": status, "reverse_reason": i.Payload["reason"], "reversed_by": who.Actor, "updated_by": who.Actor}); e != nil {
			return nil, e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_invoice SET reversed_at=CURRENT_TIMESTAMP(3) WHERE code=?", code); e != nil {
			return nil, e
		}
	case "confirm":
		if row["status"] != "draft" {
			return nil, ledgerError(409, "invalid_status")
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, map[string]any{"status": "confirmed", "confirmed_by": who.Actor, "updated_by": who.Actor}); e != nil {
			return nil, e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_receipt SET confirmed_at=CURRENT_TIMESTAMP(3) WHERE code=?", code); e != nil {
			return nil, e
		}
	case "delete":
		if row["status"] != "draft" || moneyCents(ledgerText(row["reconciled_amount"])).Sign() != 0 {
			return nil, ledgerError(409, "invalid_status")
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_receipt SET deleted_at=CURRENT_TIMESTAMP(3),status='canceled',row_version=row_version+1,updated_by=? WHERE code=?", who.Actor, code); e != nil {
			return nil, e
		}
		return map[string]any{"code": code, "deleted": true, "row_version": ledgerVersion(row["row_version"]) + 1}, nil
	case "classify":
		var incomeStatus string
		if ledgerVersion(i.Payload["incomeTypeId"]) < 1 {
			return nil, financeInvalid()
		}
		if err := tx.QueryRowContext(ctx, "SELECT status FROM finance_income_type WHERE id=?", i.Payload["incomeTypeId"]).Scan(&incomeStatus); err != nil {
			return nil, err
		}
		if incomeStatus != "active" {
			return nil, ledgerError(409, "income_type_unavailable")
		}
		if moneyCents(ledgerText(row["reconciled_amount"])).Sign() != 0 {
			return nil, ledgerError(409, "receipt_has_reconciliation")
		}
		if e := ledgerUpdate(ctx, tx, sp.table, code, fields); e != nil {
			return nil, e
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO finance_unclassified_income(code,receipt_id,income_type_id,resolution_status,note,created_by,updated_by) VALUES(?,?,?,'classified',?,?,?) ON DUPLICATE KEY UPDATE income_type_id=VALUES(income_type_id),note=VALUES(note),row_version=row_version+1,updated_by=VALUES(updated_by)", "UCI-"+strings.ReplaceAll(oid, "-", ""), row["id"], fields["income_type_id"], fields["note"], who.Actor, who.Actor); e != nil {
			return nil, e
		}
	case "reconcile":
		return ledgerReconcile(ctx, tx, i, who, locked, oid)
	case "reverse":
		if bs := locked["altoc_billing_schedule"]; bs != nil && bs["continuation_installed"] == true && locked["finance_allocation_batch"] == nil {
			var count int
			if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM finance_allocation_batch WHERE status='active' AND JSON_SEARCH(allocation_lines,'one',?,NULL,'$[*].code') IS NOT NULL", code).Scan(&count); e != nil {
				return nil, e
			}
			if count > 0 {
				return nil, ledgerError(409, "allocation_batch_reverse_required")
			}
		}
		receipt := locked["finance_receipt"]
		if row["status"] != "active" {
			return nil, ledgerError(409, "invalid_status")
		}
		if e := requireFinanceReconciliationSeparation(receipt, who.Actor); e != nil {
			return nil, e
		}
		if ledgerText(i.Payload["reason"]) == "" {
			return nil, financeInvalid()
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_reconciliation SET status='reversed',reversed_at=CURRENT_TIMESTAMP(3),reversed_by=?,reverse_reason=?,row_version=row_version+1 WHERE code=?", who.Actor, i.Payload["reason"], code); e != nil {
			return nil, e
		}
		if e := ledgerAllocationTotals(ctx, tx, locked); e != nil {
			return nil, e
		}
	case "attach":
		parent := locked[ledgerText(i.Payload["entityType"])]
		if parent == nil || parent["status"] == "canceled" || parent["status"] == "red_reversed" {
			return nil, ledgerError(409, "invalid_status")
		}
		code = "FA-" + strings.ReplaceAll(oid, "-", "")
		delete(fields, "updated_by")
		fields["code"] = code
		fields["created_by"] = who.Actor
		if e := ledgerInsert(ctx, tx, sp.table, fields); e != nil {
			return nil, e
		}
	default:
		return nil, financeInvalid()
	}
	return ledgerRow(ctx, tx, sp.table, code, false)
}
func ledgerBank(ctx context.Context, tx *sql.Tx, fields map[string]any) error {
	if id, ok := fields["bank_account_id"]; ok {
		var status, currency string
		if e := tx.QueryRowContext(ctx, "SELECT status,currency_code FROM finance_bank_account WHERE id=? AND deleted_at IS NULL", id).Scan(&status, &currency); e != nil {
			return e
		}
		if status != "active" || fields["currency_code"] != nil && currency != fields["currency_code"] {
			return ledgerError(409, "bank_account_unavailable")
		}
	}
	return nil
}
func ledgerReconcile(ctx context.Context, tx *sql.Tx, i FinanceInput, who Identity, l map[string]map[string]any, oid string) (map[string]any, error) {
	receipt, invoice, bs := l["finance_receipt"], l["finance_invoice"], l["altoc_billing_schedule"]
	if e := ledgerVersionCheck(receipt, i.Payload["receiptVersion"]); e != nil {
		return nil, e
	}
	if receipt["status"] != "confirmed" && receipt["status"] != "partially_reconciled" {
		return nil, ledgerError(409, "receipt_not_confirmed")
	}
	if e := requireFinanceReconciliationSeparation(receipt, who.Actor); e != nil {
		return nil, e
	}
	if bs != nil && bs["continuation_installed"] == true {
		if e := requireHistoricalTarget(ctx, tx, l, receipt); e != nil {
			return nil, e
		}
	}
	currency := ledgerText(receipt["currency_code"])
	if v := ledgerText(i.Payload["currencyCode"]); v != "" && v != currency {
		return nil, ledgerError(409, "currency_mismatch")
	}
	amount := moneyCents(ledgerText(i.Payload["reconciledAmount"]))
	if amount.Cmp(moneyCents(ledgerText(receipt["unreconciled_amount"]))) > 0 {
		return nil, ledgerError(409, "amount_exceeded")
	}
	target := ledgerText(i.Payload["targetType"])
	if target == "" {
		target = "invoice"
		if invoice == nil {
			target = "billing_schedule"
		}
	}
	if target != "invoice" && target != "billing_schedule" && target != "contract" && target != "advance" && target != "unclassified" && target != "manual" {
		return nil, financeInvalid()
	}
	if invoice != nil && target != "invoice" {
		return nil, financeInvalid()
	}
	if target == "invoice" && invoice == nil || target == "billing_schedule" && bs == nil || target == "contract" && l["altoc_contract"] == nil {
		return nil, financeInvalid()
	}
	if invoice != nil {
		if e := ledgerVersionCheck(invoice, i.Payload["invoiceVersion"]); e != nil {
			return nil, e
		}
		if invoice["status"] != "issued" || invoice["currency_code"] != currency || ledgerText(invoice["customer_code"]) != ledgerText(receipt["customer_code"]) {
			return nil, ledgerError(409, "allocation_target_mismatch")
		}
		if amount.Cmp(moneyCents(ledgerText(invoice["unreconciled_amount"]))) > 0 {
			return nil, ledgerError(409, "amount_exceeded")
		}
	}
	if bs != nil {
		if e := ledgerVersionCheck(bs, i.Payload["scheduleVersion"]); e != nil {
			return nil, e
		}
		if bs["currency_code"] != currency || bs["status"] == "cancelled" {
			return nil, ledgerError(409, "allocation_target_mismatch")
		}
	}

	if bs != nil {
		var current string
		if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(reconciled_amount),0) AS CHAR) FROM finance_reconciliation WHERE billing_schedule_code=? AND status='active'", bs["code"]).Scan(&current); e != nil {
			return nil, e
		}
		capacity := new(big.Int).Sub(moneyCents(ledgerText(bs["amount"])), moneyCents(current))
		if bs["continuation_installed"] == true {
			var e error
			capacity, e = receivableCapacity(ctx, tx, bs)
			if e != nil {
				return nil, e
			}
		}
		if amount.Cmp(capacity) > 0 {
			return nil, ledgerError(409, "amount_exceeded")
		}
	}
	fields := map[string]any{"code": "RL-" + strings.ReplaceAll(oid, "-", ""), "receipt_id": receipt["id"], "target_type": target, "customer_code": receipt["customer_code"], "contract_code": receipt["contract_code"], "project_code": receipt["project_code"], "billing_schedule_code": receipt["billing_schedule_code"], "currency_code": currency, "reconciled_amount": i.Payload["reconciledAmount"], "reconciled_at": "2000-01-01 00:00:00", "status": "active", "idempotency_key": oid, "reconciled_by": who.Actor, "created_by": who.Actor, "note": i.Payload["note"]}
	if invoice != nil {
		fields["invoice_id"] = invoice["id"]
		fields["contract_code"] = invoice["contract_code"]
		fields["billing_schedule_code"] = invoice["billing_schedule_code"]
	}
	if bs != nil {
		fields["billing_schedule_code"] = bs["code"]
	}
	if c := l["altoc_contract"]; c != nil {
		fields["contract_code"] = c["code"]
	}
	if e := ledgerInsert(ctx, tx, "finance_reconciliation", fields); e != nil {
		return nil, e
	}
	if _, e := tx.ExecContext(ctx, "UPDATE finance_reconciliation SET reconciled_at=CURRENT_TIMESTAMP(3) WHERE code=?", fields["code"]); e != nil {
		return nil, e
	}
	if e := ledgerAllocationTotals(ctx, tx, l); e != nil {
		return nil, e
	}
	return ledgerRow(ctx, tx, "finance_reconciliation", ledgerText(fields["code"]), false)
}
func ledgerAllocationTotals(ctx context.Context, tx *sql.Tx, l map[string]map[string]any) error {
	if r := l["finance_invoice"]; r != nil {
		if _, e := tx.ExecContext(ctx, "UPDATE finance_invoice SET reconciled_amount=(SELECT COALESCE(SUM(reconciled_amount),0) FROM finance_reconciliation WHERE invoice_id=? AND status='active'),row_version=row_version+1 WHERE id=?", r["id"], r["id"]); e != nil {
			return e
		}
	}
	if r := l["finance_receipt"]; r != nil {
		if _, e := tx.ExecContext(ctx, "UPDATE finance_receipt SET reconciled_amount=(SELECT COALESCE(SUM(reconciled_amount),0) FROM finance_reconciliation WHERE receipt_id=? AND status='active'),row_version=row_version+1 WHERE id=?", r["id"], r["id"]); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_receipt SET status=CASE WHEN reconciled_amount=0 THEN 'confirmed' WHEN reconciled_amount<received_amount THEN 'partially_reconciled' ELSE 'reconciled' END WHERE id=?", r["id"]); e != nil {
			return e
		}
	}
	return nil
}

// Finance owns recomputation inputs. Altoc owns its write core below, in the same caller Tx.
func ledgerSummaries(ctx context.Context, tx *sql.Tx, l map[string]map[string]any) error {
	contract := l["altoc_contract"]
	if contract == nil {
		return nil
	}
	code := ledgerText(contract["code"])
	var invoice, received, reconciled string
	for n, q := range []string{"SELECT CAST(COALESCE(SUM(invoice_amount),0) AS CHAR) FROM finance_invoice WHERE contract_code=? AND status='issued' AND deleted_at IS NULL", "SELECT CAST(COALESCE(SUM(received_amount),0) AS CHAR) FROM finance_receipt WHERE contract_code=? AND status NOT IN ('draft','canceled') AND deleted_at IS NULL", "SELECT CAST(COALESCE(SUM(reconciled_amount),0) AS CHAR) FROM finance_reconciliation WHERE contract_code=? AND status='active'"} {
		var v string
		if e := tx.QueryRowContext(ctx, q, code).Scan(&v); e != nil {
			return e
		}
		switch n {
		case 0:
			invoice = v
		case 1:
			received = v
		case 2:
			reconciled = v
		}
	}
	raw, _ := json.Marshal([]string{code, ledgerText(contract["currency_code"]), invoice, received, reconciled})
	h := sha256.Sum256(raw)
	if _, e := tx.ExecContext(ctx, "UPDATE finance_contract_summary SET invoice_amount=?,received_amount=?,reconciled_amount=?,input_sha256=?,billing_schedule_count=(SELECT COUNT(*) FROM altoc_billing_schedule WHERE contract_id=? AND deleted_at IS NULL),row_version=row_version+1 WHERE contract_code=?", invoice, received, reconciled, hex.EncodeToString(h[:]), contract["id"], code); e != nil {
		return e
	}
	bs := l["altoc_billing_schedule"]
	if bs != nil {
		var invoiced, allocated string
		if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(invoice_amount),0) AS CHAR) FROM finance_invoice WHERE billing_schedule_code=? AND status='issued' AND deleted_at IS NULL", bs["code"]).Scan(&invoiced); e != nil {
			return e
		}
		if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(reconciled_amount),0) AS CHAR) FROM finance_reconciliation WHERE billing_schedule_code=? AND status='active'", bs["code"]).Scan(&allocated); e != nil {
			return e
		}
		if e := altoc.ApplyFinanceBillingSummaryTx(ctx, tx, altoc.FinanceBillingSummary{ContractID: ledgerVersion(contract["id"]), ScheduleID: ledgerVersion(bs["id"]), ExpectedVersion: ledgerVersion(bs["row_version"]), InvoicedAmount: invoiced, ReceivedAmount: allocated}); e != nil {
			return e
		}
	}
	if bs != nil && bs["continuation_installed"] == true {
		_, origin, e := contractW1State(ctx, tx, "altoc_contract", ledgerText(contract["id"]))
		if e != nil {
			return e
		}
		if origin == "historical_import" {
			return altoc.ApplyHistoricalFinanceContractSummaryTx(ctx, tx, ledgerVersion(contract["id"]), invoice, reconciled)
		}
	}
	return altoc.ApplyFinanceContractSummaryTx(ctx, tx, ledgerVersion(contract["id"]), invoice, reconciled)
}
