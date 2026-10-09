package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"math/big"
	"sort"
	"strings"
)

var financeReceivableOps = map[string]ledgerSpec{
	"historical-finance-page":         {"finance_historical_readiness", "historical_finance", "view", "opening-page", false},
	"historical-finance-preview":      {"finance_historical_readiness", "historical_finance", "view", "preview", false},
	"historical-finance-activate":     {"finance_historical_readiness", "historical_finance", "activate", "activate", true},
	"historical-finance-history-page": {"finance_historical_readiness", "historical_finance", "view", "history", false},
	"allocation-candidates":           {"finance_allocation_batch", "reconciliation", "view", "candidates", false},
	"allocation-batches-page":         {"finance_allocation_batch", "reconciliation", "view", "page", false},
	"allocation-batches-detail":       {"finance_allocation_batch", "reconciliation", "view", "detail", false},
	"reconciliation-allocate-batch":   {"finance_allocation_batch", "reconciliation", "confirm", "allocate", true},
	"allocation-batches-reverse":      {"finance_allocation_batch", "reconciliation", "confirm", "reverse-batch", true},
	"receivable-adjustments-page":     {"finance_receivable_adjustment", "receivable_adjustments", "view", "page", false},
	"receivable-adjustments-detail":   {"finance_receivable_adjustment", "receivable_adjustments", "view", "detail", false},
	"receivable-adjustments-create":   {"finance_receivable_adjustment", "receivable_adjustments", "edit", "adjust-create", true},
	"receivable-adjustments-confirm":  {"finance_receivable_adjustment", "receivable_adjustments", "confirm", "adjust-confirm", true},
	"receivable-adjustments-reverse":  {"finance_receivable_adjustment", "receivable_adjustments", "reverse", "adjust-reverse", true},
}

func ValidateFinanceReceivableInput(op string, i FinanceInput) error {
	sp, ok := financeReceivableOps[op]
	if !ok {
		return financeInvalid()
	}
	if sp.write {
		allowed := map[string]bool{}
		for _, k := range strings.Fields("expectedVersion receiptVersion contractCode billingScheduleCode scheduleVersion reviewHash evidenceSha256 adjustmentType amount reason items") {
			allowed[k] = true
		}
		for k := range i.Payload {
			if !allowed[k] {
				return financeInvalid()
			}
		}
		switch sp.kind {
		case "activate":
			if ledgerVersion(i.Payload["expectedVersion"]) < 1 || len(ledgerText(i.Payload["reviewHash"])) != 64 || len(ledgerText(i.Payload["evidenceSha256"])) != 64 {
				return financeInvalid()
			}
		case "allocate":
			items, ok := i.Payload["items"].([]any)
			if !ok || len(items) == 0 || len(items) > 100 || ledgerVersion(i.Payload["receiptVersion"]) < 1 {
				return financeInvalid()
			}
			seen := map[string]bool{}
			for _, item := range items {
				v, ok := item.(map[string]any)
				if !ok {
					return financeInvalid()
				}
				for k := range v {
					if k != "contractCode" && k != "billingScheduleCode" && k != "scheduleVersion" && k != "amount" {
						return financeInvalid()
					}
				}
				c := ledgerText(v["billingScheduleCode"])
				if c == "" || seen[c] || ledgerText(v["contractCode"]) == "" || ledgerVersion(v["scheduleVersion"]) < 1 || !continuationMoney.MatchString(ledgerText(v["amount"])) || moneyCents(ledgerText(v["amount"])).Sign() <= 0 {
					return financeInvalid()
				}
				seen[c] = true
			}
		case "adjust-create":
			typ := ledgerText(i.Payload["adjustmentType"])
			if typ != "discount" && typ != "bad_debt" && typ != "rounding" && typ != "correction" {
				return financeInvalid()
			}
			amount := ledgerText(i.Payload["amount"])
			if !continuationMoney.MatchString(amount) || moneyCents(amount).Sign() == 0 || typ != "correction" && moneyCents(amount).Sign() < 0 || ledgerText(i.Payload["reason"]) == "" || len(ledgerText(i.Payload["reason"])) > 1000 || ledgerVersion(i.Payload["scheduleVersion"]) < 1 || ledgerText(i.Payload["contractCode"]) == "" || ledgerText(i.Payload["billingScheduleCode"]) == "" {
				return financeInvalid()
			}
		default:
			if ledgerVersion(i.Payload["expectedVersion"]) < 1 {
				return financeInvalid()
			}
			if strings.Contains(sp.kind, "reverse") && (ledgerText(i.Payload["reason"]) == "" || len(ledgerText(i.Payload["reason"])) > 1000) {
				return financeInvalid()
			}
		}
	}
	if sp.kind != "opening-page" && sp.kind != "page" && sp.kind != "history" && sp.kind != "adjust-create" && i.Code == "" {
		return financeInvalid()
	}
	return nil
}
func receivableRow(ctx context.Context, tx *sql.Tx, table, code string, lock bool) (map[string]any, error) {
	var cols []string
	for _, t := range domaininstall.FinanceReceivablesTables() {
		if t.Logical == table {
			cols = t.Columns
		}
	}
	if len(cols) == 0 {
		return nil, financeInvalid()
	}
	q := "SELECT " + financeSelect(cols) + " FROM " + table + " WHERE BINARY code=BINARY ?"
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

// Every write uses the Registry generation fence and one caller transaction,
// including command receipt, original allocation lines and all summary writes.
func (s *Service) FinanceReceivables(ctx context.Context, op string, i FinanceInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if e := ValidateFinanceReceivableInput(op, i); e != nil {
		return nil, e
	}
	sp := financeReceivableOps[op]
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment {
		return nil, ledgerError(403, "identity_invalid")
	}
	if scope.Access != "all" && scope.Access != "self" {
		return nil, ledgerError(403, "scope_denied")
	}
	if !domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "receivables_unavailable")
	}
	requests := []enterprise.ResolveRequest{}
	for _, domain := range []string{"altoc", "finance", "migration"} {
		mode := enterprise.Read
		if sp.write && domain != "migration" {
			mode = enterprise.Write
		}
		r, e := s.request(domain, mode)
		if e != nil {
			return nil, e
		}
		if sp.write && domain == "migration" {
			continue
		}
		requests = append(requests, r)
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	var e error
	if sp.write {
		tx, resolved, e = s.registry.BeginWriteTransaction(ctx, requests...)
	} else {
		tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, requests...)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if sp.write {
		mr, e := s.request("migration", enterprise.Read)
		if e != nil {
			return nil, e
		}
		ms, e := s.registry.ResolveDomains(mr)
		if e != nil {
			return nil, e
		}
		if ms[0].DB != resolved[0].DB {
			return nil, enterprise.ErrBindingMismatch
		}
		resolved = append(resolved, ms[0])
	}

	tables := map[string]string{}
	var finance enterprise.Resolved
	for _, r := range resolved {
		if _, e := r.Table("finance_allocation_batch"); e == nil {
			finance = r
		}
		for _, logical := range []string{"mig_batch", "mig_batch_step", "mig_object_map", "mig_source_row"} {
			if t, e := r.Table(logical); e == nil {
				tables[logical] = t
			}
		}
	}
	if !sp.write {
		v, e := s.readFinanceReceivables(ctx, tx, sp, i, who, scope, tables)
		if e != nil {
			return nil, e
		}
		return map[string]any{"data": v}, tx.Commit()
	}
	if who.Key == "" {
		return nil, financeInvalid()
	}
	// Scope is checked before receipt lookup; no replay can bypass current access.
	state, e := lockReceivableCommand(ctx, tx, sp, i, who, scope)
	if e != nil {
		return nil, e
	}
	allLocked := map[string]map[string]any{"finance_receipt": state.Receipt}
	for n, c := range state.Contracts {
		allLocked["contract"+ledgerText(n)] = c
	}
	costTargets, e := lockCostFinancialTargets(ctx, tx, finance, i, allLocked)
	if e != nil {
		return nil, e
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(map[string]any{"operation": op, "intent": FinanceIntent(i), "actor": who.Actor})
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance-b5b|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	receipt, _ := finance.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(finance.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.b5b." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		v, e := mutateReceivableCommand(ctx, tx, sp, i, who, scope, state, tables, oid)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e = refreshCostFinancialTargets(ctx, tx, finance, costTargets); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		snapshot, _ := json.Marshal(map[string]any{"data": v})
		audit, _ := finance.Table("finance_audit_log")
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_code,action,new_value,operator_uid,channel,request_id) VALUES(?,?,?,?,?,'user',?)", sp.table, ledgerText(v["code"]), op, string(snapshot), who.Actor, oid); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: sp.table, TargetBizCode: oid, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(snapshot)}, nil
	})
	if e != nil {
		return nil, e
	}
	var snapshot string
	audit, _ := finance.Table("finance_audit_log")
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE request_id=? AND action=?", result.TargetBizCode, op).Scan(&snapshot); e != nil {
		return nil, e
	}
	var value map[string]any
	if e = json.Unmarshal([]byte(snapshot), &value); e != nil {
		return nil, e
	}
	return value, tx.Commit()
}

type receivableCommandState struct {
	Object, Receipt      map[string]any
	Contracts, Schedules []map[string]any
}

func lockReceivableCommand(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, who Identity, scope altoc.BasicReadScope) (receivableCommandState, error) {
	st := receivableCommandState{}
	pairs := map[string]string{}
	if sp.kind == "allocate" {
		for _, line := range i.Payload["items"].([]any) {
			v := line.(map[string]any)
			pairs[ledgerText(v["billingScheduleCode"])] = ledgerText(v["contractCode"])
		}
	}
	if sp.kind == "activate" {
		pairs[""] = i.Code
	}
	if sp.kind == "adjust-create" {
		pairs[ledgerText(i.Payload["billingScheduleCode"])] = ledgerText(i.Payload["contractCode"])
	}
	if sp.kind == "adjust-confirm" || sp.kind == "adjust-reverse" || sp.kind == "reverse-batch" {
		row, e := receivableRow(ctx, tx, sp.table, i.Code, false)
		if e != nil {
			return st, e
		}
		st.Object = row
		if sp.kind == "reverse-batch" {
			var lines []map[string]any
			if json.Unmarshal([]byte(ledgerText(row["allocation_lines"])), &lines) != nil {
				return st, financeInvalid()
			}
			for _, v := range lines {
				pairs[ledgerText(v["billingScheduleCode"])] = ledgerText(v["contractCode"])
			}
		} else {
			pairs[ledgerText(row["billing_schedule_code"])] = ledgerText(row["contract_code"])
		}
	}
	// Resolve first, then lock every customer/contract/schedule in numeric ID order.
	customers, contracts, schedules := map[int64]string{}, map[int64]string{}, map[int64]string{}
	for schedule, contract := range pairs {
		var id, cid int64
		if e := tx.QueryRowContext(ctx, "SELECT id,customer_id FROM altoc_contract WHERE code=? AND deleted_at IS NULL", contract).Scan(&id, &cid); e != nil {
			return st, e
		}
		contracts[id] = contract
		customers[cid] = ""
		if schedule != "" {
			var sid, owner int64
			if e := tx.QueryRowContext(ctx, "SELECT id,contract_id FROM altoc_billing_schedule WHERE code=? AND deleted_at IS NULL", schedule).Scan(&sid, &owner); e != nil {
				return st, e
			}
			if owner != id {
				return st, ledgerError(409, "allocation_target_mismatch")
			}
			schedules[sid] = schedule
		}
	}
	ordered := func(m map[int64]string) []int64 {
		a := []int64{}
		for k := range m {
			a = append(a, k)
		}
		sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
		return a
	}
	for _, id := range ordered(customers) {
		var c string
		if e := tx.QueryRowContext(ctx, "SELECT code FROM altoc_customer WHERE id=? AND deleted_at IS NULL FOR UPDATE", id).Scan(&c); e != nil {
			return st, e
		}
		customers[id] = c
	}
	for _, id := range ordered(contracts) {
		var cid, version int64
		var currency, legal sql.NullString
		if e := tx.QueryRowContext(ctx, "SELECT customer_id,row_version,currency_code,legal_status FROM altoc_contract WHERE id=? AND deleted_at IS NULL FOR UPDATE", id).Scan(&cid, &version, &currency, &legal); e != nil {
			return st, e
		}
		if _, ok := customers[cid]; !ok {
			return st, ledgerError(409, "write_conflict")
		}
		st.Contracts = append(st.Contracts, map[string]any{"id": id, "code": contracts[id], "customer_code": customers[cid], "row_version": version, "currency_code": currency.String, "legal_status": legal.String})
	}
	for _, id := range ordered(schedules) {
		var cid, version int64
		var currency, status, direction, amount string
		if e := tx.QueryRowContext(ctx, "SELECT contract_id,row_version,currency_code,status,direction,amount FROM altoc_billing_schedule WHERE id=? AND deleted_at IS NULL FOR UPDATE", id).Scan(&cid, &version, &currency, &status, &direction, &amount); e != nil {
			return st, e
		}
		if contracts[cid] == "" || direction != "receivable" {
			return st, ledgerError(409, "allocation_target_mismatch")
		}
		st.Schedules = append(st.Schedules, map[string]any{"id": id, "contract_id": cid, "code": schedules[id], "row_version": version, "currency_code": currency, "status": status, "amount": amount, "continuation_installed": true})
	}
	if sp.kind == "allocate" || sp.kind == "reverse-batch" {
		receiptCode := i.Code
		if st.Object != nil {
			receiptCode = ledgerText(st.Object["receipt_code"])
		}
		row, e := ledgerRow(ctx, tx, "finance_receipt", receiptCode, true)
		if e != nil {
			return st, e
		}
		if !ledgerScope(row, scope, who.Actor) {
			return st, ledgerError(403, "scope_denied")
		}
		st.Receipt = row
		for _, c := range st.Contracts {
			if e := checkAllocationEntity(ctx, tx, c, row); e != nil {
				return st, e
			}
		}

		for _, c := range st.Contracts {
			if c["customer_code"] != row["customer_code"] || c["currency_code"] != row["currency_code"] || ledgerText(row["contract_code"]) != "" && row["contract_code"] != c["code"] {
				return st, ledgerError(409, "allocation_target_mismatch")
			}
		}
	} else if scope.Access != "all" {
		return st, ledgerError(403, "scope_denied")
	}
	if st.Object != nil {
		fresh, e := receivableRow(ctx, tx, sp.table, i.Code, true)
		if e != nil {
			return st, e
		}
		if fresh["row_version"] != st.Object["row_version"] {
			return st, ledgerError(409, "version_conflict")
		}
		st.Object = fresh
	}
	for _, c := range st.Contracts {
		if _, e := tx.ExecContext(ctx, "INSERT IGNORE INTO finance_contract_summary(contract_code,currency_code,input_sha256) VALUES(?,?,?)", c["code"], c["currency_code"], strings.Repeat("0", 64)); e != nil {
			return st, e
		}
		var version int64
		if e := tx.QueryRowContext(ctx, "SELECT row_version FROM finance_contract_summary WHERE contract_code=? FOR UPDATE", c["code"]).Scan(&version); e != nil {
			return st, e
		}
	}
	return st, nil
}
func stateLocks(st receivableCommandState, schedule string) map[string]map[string]any {
	l := map[string]map[string]any{"finance_receipt": st.Receipt}
	for _, bs := range st.Schedules {
		if bs["code"] == schedule {
			l["altoc_billing_schedule"] = bs
			for _, c := range st.Contracts {
				if c["id"] == bs["contract_id"] {
					l["altoc_contract"] = c
				}
			}
		}
	}
	return l
}
func mutateReceivableCommand(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, who Identity, scope altoc.BasicReadScope, st receivableCommandState, tables map[string]string, oid string) (map[string]any, error) {
	code := "FB-" + strings.ReplaceAll(oid, "-", "")
	switch sp.kind {
	case "activate":
		v, e := inspectOpeningEvidence(ctx, tx, tables, i.Code)
		if e != nil {
			return nil, e
		}
		if ledgerVersion(v["row_version"]) != ledgerVersion(i.Payload["expectedVersion"]) || v["review_hash"] != i.Payload["reviewHash"] || v["evidence_sha256"] != i.Payload["evidenceSha256"] {
			return nil, ledgerError(409, "opening_evidence_changed")
		}
		delete(v, "row_version")
		delete(v, "ready")
		delete(v, "calculation_basis")
		delete(v, "historical_details")
		v["code"] = code
		v["activated_by"] = who.Actor
		if e = ledgerInsert(ctx, tx, sp.table, v); e != nil {
			return nil, e
		}
	case "allocate":
		if e := ledgerVersionCheck(st.Receipt, i.Payload["receiptVersion"]); e != nil {
			return nil, e
		}
		if e := requireFinanceReconciliationSeparation(st.Receipt, who.Actor); e != nil {
			return nil, e
		}
		lines := []map[string]any{}
		total := new(big.Int)
		for n, line := range i.Payload["items"].([]any) {
			v := line.(map[string]any)
			l := stateLocks(st, ledgerText(v["billingScheduleCode"]))
			if e := requireHistoricalTarget(ctx, tx, l, st.Receipt); e != nil {
				return nil, e
			}
			p := map[string]any{"receiptVersion": st.Receipt["row_version"], "scheduleVersion": v["scheduleVersion"], "targetType": "billing_schedule", "reconciledAmount": v["amount"]}
			child := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte(oid+"/"+ledgerText(n)), 4).String()
			row, e := ledgerReconcile(ctx, tx, FinanceInput{Payload: p}, who, l, child)
			if e != nil {
				return nil, e
			}
			lines = append(lines, map[string]any{"code": row["code"], "contractCode": v["contractCode"], "billingScheduleCode": v["billingScheduleCode"], "amount": v["amount"]})
			total.Add(total, moneyCents(ledgerText(v["amount"])))
			if e = ledgerSummaries(ctx, tx, l); e != nil {
				return nil, e
			}
			st.Receipt, e = ledgerRow(ctx, tx, "finance_receipt", ledgerText(st.Receipt["code"]), true)
			if e != nil {
				return nil, e
			}
		}
		raw, _ := json.Marshal(lines)
		if e := ledgerInsert(ctx, tx, sp.table, map[string]any{"code": code, "receipt_id": st.Receipt["id"], "receipt_code": st.Receipt["code"], "currency_code": st.Receipt["currency_code"], "total_amount": centsText(total), "allocation_lines": string(raw), "created_by": who.Actor}); e != nil {
			return nil, e
		}
	case "reverse-batch":
		code = i.Code
		if e := ledgerVersionCheck(st.Object, i.Payload["expectedVersion"]); e != nil {
			return nil, e
		}
		if st.Object["status"] != "active" {
			return nil, ledgerError(409, "invalid_status")
		}
		if e := requireFinanceReconciliationSeparation(st.Receipt, who.Actor); e != nil {
			return nil, e
		}
		var lines []map[string]any
		json.Unmarshal([]byte(ledgerText(st.Object["allocation_lines"])), &lines)
		for _, v := range lines {
			l := stateLocks(st, ledgerText(v["billingScheduleCode"]))
			row, e := ledgerRow(ctx, tx, "finance_reconciliation", ledgerText(v["code"]), true)
			if e != nil {
				return nil, e
			}
			l["finance_reconciliation"] = row
			l["finance_allocation_batch"] = st.Object
			if row["status"] != "active" {
				return nil, ledgerError(409, "allocation_batch_changed")
			}
			if _, e = ledgerMutate(ctx, tx, "reconciliation-void", financeLedgerOps["reconciliation-void"], FinanceInput{Code: ledgerText(row["code"]), Payload: map[string]any{"expectedVersion": row["row_version"], "reason": i.Payload["reason"]}}, who, l, oid); e != nil {
				return nil, e
			}
			if e = ledgerSummaries(ctx, tx, l); e != nil {
				return nil, e
			}
		}
		if _, e := tx.ExecContext(ctx, "UPDATE finance_allocation_batch SET status='reversed',reversed_by=?,reversed_at=CURRENT_TIMESTAMP(3),reverse_reason=?,row_version=row_version+1 WHERE id=?", who.Actor, i.Payload["reason"], st.Object["id"]); e != nil {
			return nil, e
		}
	case "adjust-create":
		l := stateLocks(st, ledgerText(i.Payload["billingScheduleCode"]))
		bs := l["altoc_billing_schedule"]
		if e := ledgerVersionCheck(bs, i.Payload["scheduleVersion"]); e != nil {
			return nil, e
		}
		if e := requireHistoricalTarget(ctx, tx, l, nil); e != nil {
			return nil, e
		}
		if e := ledgerInsert(ctx, tx, sp.table, map[string]any{"code": code, "contract_id": l["altoc_contract"]["id"], "billing_schedule_id": bs["id"], "contract_code": i.Payload["contractCode"], "billing_schedule_code": bs["code"], "currency_code": bs["currency_code"], "adjustment_type": i.Payload["adjustmentType"], "amount": i.Payload["amount"], "reason": i.Payload["reason"], "entered_by": who.Actor}); e != nil {
			return nil, e
		}
	case "adjust-confirm", "adjust-reverse":
		code = i.Code
		row := st.Object
		if e := ledgerVersionCheck(row, i.Payload["expectedVersion"]); e != nil {
			return nil, e
		}
		if e := requireAdjustmentSeparation(ledgerText(row["entered_by"]), who.Actor); e != nil {
			return nil, e
		}
		want := "draft"
		if sp.kind == "adjust-reverse" {
			want = "confirmed"
		}
		if row["status"] != want {
			return nil, ledgerError(409, "invalid_status")
		}
		l := stateLocks(st, ledgerText(row["billing_schedule_code"]))
		if e := requireHistoricalTarget(ctx, tx, l, nil); e != nil {
			return nil, e
		}
		delta := moneyCents(ledgerText(row["amount"]))
		if sp.kind == "adjust-reverse" {
			delta.Neg(delta)
		}
		capacity, e := receivableCapacity(ctx, tx, l["altoc_billing_schedule"])
		if e != nil {
			return nil, e
		}
		if capacity.Cmp(delta) < 0 {
			return nil, ledgerError(409, "amount_exceeded")
		}
		q := "UPDATE finance_receivable_adjustment SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=?"
		args := []any{who.Actor, row["id"]}
		if sp.kind == "adjust-reverse" {
			q = "UPDATE finance_receivable_adjustment SET status='reversed',reversed_by=?,reversed_at=CURRENT_TIMESTAMP(3),reverse_reason=?,row_version=row_version+1 WHERE id=?"
			args = []any{who.Actor, i.Payload["reason"], row["id"]}
		}
		if _, e = tx.ExecContext(ctx, q, args...); e != nil {
			return nil, e
		}
		if e = ledgerSummaries(ctx, tx, l); e != nil {
			return nil, e
		}
	default:
		return nil, financeInvalid()
	}
	return receivableRow(ctx, tx, sp.table, code, false)
}
func requireHistoricalTarget(ctx context.Context, tx *sql.Tx, l map[string]map[string]any, receipt map[string]any) error {
	c := l["altoc_contract"]
	if c == nil {
		return financeInvalid()
	}
	_, origin, e := contractW1State(ctx, tx, "altoc_contract", ledgerText(c["id"]))
	if e != nil {
		return e
	}
	if origin != "historical_import" {
		return nil
	}
	bs := l["altoc_billing_schedule"]
	if bs == nil {
		return ledgerError(409, "historical_contract_not_ready")
	}
	ready, e := historicalContinuation(ctx, tx, ledgerText(c["code"]), ledgerText(bs["code"]))
	if e != nil {
		return e
	}
	if receipt != nil {
		at := ledgerText(receipt["received_at"])
		cut := ledgerText(ready["cutoff_date"])
		if len(at) < 10 || len(cut) < 10 || at[:10] <= cut[:10] {
			return ledgerError(409, "before_opening_cutoff")
		}
	}
	return nil
}
func receivableCapacity(ctx context.Context, tx *sql.Tx, bs map[string]any) (*big.Int, error) {
	var allocated, adjusted string
	if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(reconciled_amount),0) AS CHAR) FROM finance_reconciliation WHERE billing_schedule_code=? AND status='active'", bs["code"]).Scan(&allocated); e != nil {
		return nil, e
	}
	if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(amount),0) AS CHAR) FROM finance_receivable_adjustment WHERE billing_schedule_id=? AND status='confirmed'", bs["id"]).Scan(&adjusted); e != nil {
		return nil, e
	}
	v := moneyCents(ledgerText(bs["amount"]))
	v.Sub(v, moneyCents(allocated))
	v.Sub(v, moneyCents(adjusted))
	return v, nil
}
func (s *Service) readFinanceReceivables(ctx context.Context, tx *sql.Tx, sp ledgerSpec, i FinanceInput, who Identity, scope altoc.BasicReadScope, tables map[string]string) (any, error) {
	if sp.kind == "opening-page" {
		if scope.Access != "all" {
			return nil, ledgerError(403, "scope_denied")
		}
		if i.Status != "" && i.Status != "pending" && i.Status != "active" {
			return nil, financeInvalid()
		}
		page, size := financePage(i)
		from := "altoc_contract c JOIN altoc_billing_schedule bs ON bs.contract_id=c.id JOIN " + tables["mig_object_map"] + " m ON m.target_domain='altoc' AND m.target_table='altoc_billing_schedule' AND m.target_key=bs.code AND m.map_role='opening' JOIN " + tables["mig_batch"] + " b ON b.id=m.batch_id LEFT JOIN finance_historical_readiness hr ON hr.contract_id=c.id AND hr.billing_schedule_id=bs.id"
		where := "c.deleted_at IS NULL AND bs.deleted_at IS NULL AND c.origin_type='historical_import' AND bs.plan_type='opening_balance' AND b.status='applied'"
		args := []any{}
		if i.Search != "" {
			where += " AND (c.code LIKE ? OR c.name LIKE ?)"
			args = append(args, "%"+i.Search+"%", "%"+i.Search+"%")
		}
		if i.Status == "pending" {
			where += " AND hr.id IS NULL"
		} else if i.Status == "active" {
			where += " AND hr.id IS NOT NULL"
		}
		var total int64
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		cols := []string{"code", "name", "opening_amount", "currency_code", "cutoff_date", "status", "row_version"}
		rows, e := tx.QueryContext(ctx, "SELECT c.code,c.name,COALESCE(hr.opening_amount,bs.amount),bs.currency_code,COALESCE(CAST(hr.cutoff_date AS CHAR),JSON_UNQUOTE(JSON_EXTRACT(b.scope_json,'$.confirmation.asOfDate'))),IF(hr.id IS NULL,'pending','active'),bs.row_version FROM "+from+" WHERE "+where+" ORDER BY c.code LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
		if e != nil {
			return nil, e
		}
		items, e := readFinanceRows(rows, cols)
		return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, e
	}

	if sp.kind == "preview" || sp.kind == "history" {
		if scope.Access != "all" {
			return nil, ledgerError(403, "scope_denied")
		}
		if sp.kind == "preview" {
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM finance_historical_readiness WHERE contract_code=?", i.Code).Scan(&n); e != nil {
				return nil, e
			}
			if n == 1 {
				return historicalContinuation(ctx, tx, i.Code, "")
			}
			preview, e := inspectOpeningEvidence(ctx, tx, tables, i.Code)
			if e == nil {
				preview["status"] = "pending"
			}
			return preview, e
		}
		if i.Code == "" {
			return nil, financeInvalid()
		}
		var pk, snapshot string
		if e := tx.QueryRowContext(ctx, "SELECT m.source_pk,b.source_snapshot FROM "+tables["mig_object_map"]+" m JOIN "+tables["mig_batch"]+" b ON b.id=m.batch_id WHERE m.target_domain='altoc' AND m.target_table='altoc_contract' AND m.target_key=? AND m.map_role='primary'", i.Code).Scan(&pk, &snapshot); e != nil {
			return nil, ledgerError(404, "object_not_found")
		}
		page, size := financePage(i)
		where := "source_system='wizbiz' AND source_snapshot=? AND source_table IN ('wb_project_income','wb_invoice','wb_project_payment') AND JSON_UNQUOTE(JSON_EXTRACT(row_json,'$.contract_id'))=?"
		args := []any{snapshot, pk}
		var total int64
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tables["mig_source_row"]+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		rows, e := tx.QueryContext(ctx, "SELECT source_table,source_pk,CAST(JSON_UNQUOTE(JSON_EXTRACT(row_json,'$.amount')) AS CHAR) AS amount,row_sha256,captured_at FROM "+tables["mig_source_row"]+" WHERE "+where+" ORDER BY id LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
		if e != nil {
			return nil, e
		}
		items, e := readFinanceRows(rows, []string{"source_table", "source_pk", "amount", "row_sha256", "captured_at"})
		if e != nil {
			return nil, e
		}
		return map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "read_only": true, "excluded_from_balance": true}, nil
	}
	if sp.kind == "candidates" {
		receipt, e := ledgerRow(ctx, tx, "finance_receipt", i.Code, false)
		if e != nil {
			return nil, e
		}
		if !ledgerScope(receipt, scope, who.Actor) {
			return nil, ledgerError(403, "scope_denied")
		}
		page, size := financePage(i)
		where := "c.deleted_at IS NULL AND bs.deleted_at IS NULL AND bs.direction='receivable' AND bs.status<>'cancelled' AND cu.code=? AND bs.currency_code=? AND (c.origin_type<>'historical_import' OR EXISTS(SELECT 1 FROM finance_historical_readiness hr WHERE hr.contract_id=c.id AND hr.billing_schedule_id=bs.id))" // W1 is required by this installed subset.
		args := []any{receipt["customer_code"], receipt["currency_code"]}
		if c := ledgerText(receipt["contract_code"]); c != "" {
			where += " AND c.code=?"
			args = append(args, c)
		}
		from := "altoc_billing_schedule bs JOIN altoc_contract c ON c.id=bs.contract_id JOIN altoc_customer cu ON cu.id=c.customer_id"
		var total int64
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		cols := []string{"code", "contract_code", "name", "currency_code", "amount", "due_date", "row_version", "outstanding_amount"}
		rows, e := tx.QueryContext(ctx, "SELECT bs.code,c.code AS contract_code,bs.name,bs.currency_code,bs.amount,bs.due_date,bs.row_version,CAST(bs.amount-(SELECT COALESCE(SUM(reconciled_amount),0) FROM finance_reconciliation r WHERE r.billing_schedule_code=bs.code AND r.status='active')-(SELECT COALESCE(SUM(amount),0) FROM finance_receivable_adjustment a WHERE a.billing_schedule_id=bs.id AND a.status='confirmed') AS CHAR) AS outstanding_amount FROM "+from+" WHERE "+where+" ORDER BY bs.due_date IS NULL,bs.due_date,bs.id LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
		if e != nil {
			return nil, e
		}
		items, e := readFinanceRows(rows, cols)
		return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, e
	}
	if sp.kind == "detail" {
		row, e := receivableRow(ctx, tx, sp.table, i.Code, false)
		if e != nil {
			return nil, e
		}
		if scope.Access != "all" {
			if sp.table != "finance_allocation_batch" {
				return nil, ledgerError(403, "scope_denied")
			}
			receipt, e := ledgerRow(ctx, tx, "finance_receipt", ledgerText(row["receipt_code"]), false)
			if e != nil {
				return nil, e
			}
			if !ledgerScope(receipt, scope, who.Actor) {
				return nil, ledgerError(403, "scope_denied")
			}
		}
		return row, nil
	}
	page, size := financePage(i)
	where := "1=1"
	args := []any{}
	if scope.Access != "all" {
		if sp.table != "finance_allocation_batch" {
			return nil, ledgerError(403, "scope_denied")
		}
		where += " AND receipt_id IN (SELECT id FROM finance_receipt WHERE reconciliation_responsible_uid=?)"
		args = append(args, who.Actor)
	}
	if i.Status != "" {
		where += " AND status=?"
		args = append(args, i.Status)
	}
	if i.Search != "" {
		where += " AND code LIKE ?"
		args = append(args, "%"+i.Search+"%")
	}
	var total int64
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+sp.table+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	var cols []string
	for _, t := range domaininstall.FinanceReceivablesTables() {
		if t.Logical == sp.table {
			cols = t.Columns
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+financeSelect(cols)+" FROM "+sp.table+" WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	if e != nil {
		return nil, e
	}
	items, e := readFinanceRows(rows, cols)
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, e
}

func financePage(i FinanceInput) (int, int) {
	p, n := i.Page, i.PageSize
	if p < 1 {
		p = 1
	}
	if n < 1 {
		n = 20
	}
	if n > 100 {
		n = 100
	}
	return p, n
}

func checkAllocationEntity(ctx context.Context, tx *sql.Tx, contract, receipt map[string]any) error {
	has, e := financeHasColumn(ctx, tx, "altoc_contract", "receiving_bank_account_code")
	if e != nil {
		return e
	}
	if !has {
		return ledgerError(409, "legal_entity_not_ready")
	}
	var bank sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT receiving_bank_account_code FROM altoc_contract WHERE id=?", contract["id"]).Scan(&bank); e != nil {
		return e
	}
	if !bank.Valid || bank.String == "" {
		return ledgerError(409, "legal_entity_not_ready")
	}
	has, e = financeHasColumn(ctx, tx, "finance_bank_account", "legal_entity_code")
	if e != nil {
		return e
	}
	if !has {
		return ledgerError(409, "legal_entity_not_ready")
	}
	var target, source sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT legal_entity_code FROM finance_bank_account WHERE code=? AND deleted_at IS NULL", bank.String).Scan(&target); e != nil {
		return ledgerError(409, "legal_entity_not_ready")
	}
	if e = tx.QueryRowContext(ctx, "SELECT legal_entity_code FROM finance_bank_account WHERE id=? AND deleted_at IS NULL", receipt["bank_account_id"]).Scan(&source); e != nil || !source.Valid || !target.Valid || source.String == "" || target.String == "" {
		return ledgerError(409, "legal_entity_not_ready")
	}
	if source.String != target.String {
		return ledgerError(409, "legal_entity_mismatch")
	}
	return nil
}
