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
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strconv"
	"strings"
	"time"
)

var receivableOps = map[string][2]string{
	"receivables-page": {"receivable", "view"}, "receivables-detail": {"receivable", "view"}, "receivables-aging-summary": {"receivable", "view"},
	"receivables-set-collection-owner": {"receivable", "assign"}, "receivables-set-due-date": {"receivable", "set-due-date"}, "collection-followup-create": {"receivable", "followup"},
}

func IsReceivableOperation(op string) bool { _, ok := receivableOps[op]; return ok }
func receivableError(status int, code string) error {
	return httperror.New(status, code, "应收资料已变化或暂不可用，请刷新后重试")
}

var receivableBuckets = []string{"not_due", "1_30", "31_60", "61_90", "91_180", "over_180", "no_due_date"}

func ReceivableAgingBucket(due string, now time.Time) string {
	if due == "" {
		return "no_due_date"
	}
	d, e := time.Parse("2006-01-02", due)
	if e != nil {
		return "no_due_date"
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	days := int(today.Sub(d).Hours() / 24)
	switch {
	case days <= 0:
		return "not_due"
	case days <= 30:
		return "1_30"
	case days <= 60:
		return "31_60"
	case days <= 90:
		return "61_90"
	case days <= 180:
		return "91_180"
	default:
		return "over_180"
	}
}
func validateReceivable(op string, i SalesInput) error {
	_, action, ok := SalesPermission(op)
	if !ok {
		return salesInvalid()
	}
	page := op != "receivables-detail" && action == "view"
	if page {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	if page {
		for _, k := range []string{"page", "pageSize", "search", "status", "customerId", "contractId", "collectionResponsibleUid", "currencyCode", "agingBucket", "queryDate", "legalEntityCode", "legalEntityRead"} {
			fields[k] = true
		}
		for _, k := range []string{"page", "pageSize"} {
			n, ok := i.Payload[k].(float64)
			max := float64(1000000)
			if k == "pageSize" {
				max = 100
			}
			if !ok || n < 1 || n > max || n != float64(int(n)) {
				return salesInvalid()
			}
		}
		for _, k := range []string{"customerId", "contractId"} {
			if v := salesText(i.Payload, k); v != "" && !validCustomerID(v) {
				return salesInvalid()
			}
		}
		for _, field := range []struct {
			key string
			max int
		}{{"search", 200}, {"collectionResponsibleUid", 64}, {"status", 30}} {
			if value, exists := i.Payload[field.key]; exists && value != nil && !stringValue(value, field.max, true) {
				return salesInvalid()
			}
		}
		if b := salesText(i.Payload, "agingBucket"); b != "" && !containsSalesSupport(receivableBuckets, b) {
			return salesInvalid()
		}
		if v := salesText(i.Payload, "currencyCode"); v != "" && (len(v) != 3 || strings.Trim(v, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") != "") {
			return salesInvalid()
		}
		if v := salesText(i.Payload, "legalEntityCode"); v != "" {
			if !financeCode.MatchString(v) || i.Payload["legalEntityRead"] != true {
				return salesInvalid()
			}
		} else if _, ok := i.Payload["legalEntityRead"]; ok {
			return salesInvalid()
		}
		if v := salesText(i.Payload, "queryDate"); v != "" {
			if _, e := time.Parse("2006-01-02", v); e != nil {
				return salesInvalid()
			}
		}
	} else if action == "view" {
		fields["page"] = true
		fields["pageSize"] = true
		for _, k := range []string{"page", "pageSize"} {
			if v, exists := i.Payload[k]; exists {
				n, ok := v.(float64)
				max := float64(1000000)
				if k == "pageSize" {
					max = 100
				}
				if !ok || n < 1 || n > max || n != float64(int(n)) {
					return salesInvalid()
				}
			}
		}
	} else if action != "view" {
		fields["expectedVersion"] = true
		if !validExpectedVersion(i.Payload["expectedVersion"]) {
			return salesInvalid()
		}
		switch op {
		case "receivables-set-collection-owner":
			fields["collection_responsible_uid"] = true
			fields["collection_due_at"] = true
			if !stringValue(i.Payload["collection_responsible_uid"], 64, false) {
				return salesInvalid()
			}
		case "receivables-set-due-date":
			fields["due_date"] = true
			if _, ok := i.Payload["due_date"]; !ok {
				return salesInvalid()
			}
			if v := salesText(i.Payload, "due_date"); v != "" {
				if _, e := time.Parse("2006-01-02", v); e != nil {
					return salesInvalid()
				}
			}
		case "collection-followup-create":
			for _, k := range []string{"result", "promised_payment_date", "promised_amount", "next_followup_at"} {
				fields[k] = true
			}
			if !stringValue(i.Payload["result"], 1000, false) {
				return salesInvalid()
			}
			if v := salesText(i.Payload, "promised_payment_date"); v != "" {
				if _, e := time.Parse("2006-01-02", v); e != nil {
					return salesInvalid()
				}
			}
			if v, ok := i.Payload["promised_amount"]; ok && v != nil {
				if !validMoney(v) {
					return salesInvalid()
				}
			}
		}
		for _, k := range []string{"collection_due_at", "next_followup_at"} {
			if v := salesText(i.Payload, k); v != "" {
				if _, e := time.Parse("2006-01-02 15:04:05", v); e != nil {
					return salesInvalid()
				}
			}
		}
	}
	for k, v := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
		if v != nil && !stringValue(v, 1000, true) && k != "page" && k != "pageSize" && k != "expectedVersion" && k != "legalEntityRead" {
			return salesInvalid()
		}
	}
	return nil
}
func (s *Service) Receivables(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = receivableError(409, "receivable_version_conflict")
		}
	}()
	if e := validateReceivable(op, i); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, receivableError(403, "receivable_identity_invalid")
	}
	_, action, _ := SalesPermission(op)
	write := action != "view"
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	if scope.Access == "none" {
		return nil, receivableError(403, "receivable_scope_denied")
	}
	if write && who.Key == "" {
		return nil, receivableError(400, "receivable_key_required")
	}
	if op == "receivables-set-collection-owner" {
		if e := s.verifyOwnerTarget(ctx, salesText(i.Payload, "collection_responsible_uid")); e != nil {
			return nil, e
		}
	}
	checkedOwner := ""
	if op == "collection-followup-create" && salesText(i.Payload, "next_followup_at") != "" {
		pre, e := s.request("altoc", enterprise.Read)
		if e != nil {
			return nil, e
		}
		t, rs, e := s.registry.BeginSnapshotReadTransaction(ctx, pre)
		if e != nil {
			return nil, e
		}
		table, e := rs[0].Table("altoc_billing_schedule")
		if e != nil {
			t.Rollback()
			return nil, e
		}
		e = t.QueryRowContext(ctx, "SELECT COALESCE(collection_responsible_uid,'') FROM "+table+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&checkedOwner)
		t.Rollback()
		if e != nil {
			return nil, e
		}
		if e = s.verifyOwnerTarget(ctx, checkedOwner); e != nil {
			return nil, e
		}
	}
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
	}
	req, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	continuation := domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"])
	var financeReq enterprise.ResolveRequest
	if salesText(i.Payload, "legalEntityCode") != "" || continuation {
		financeReq, e = s.request("finance", enterprise.Read)
		if e != nil {
			return nil, e
		}
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if write {
		if continuation {
			tx, resolved, e = s.registry.BeginWriteTransaction(ctx, req)
		} else {
			tx, resolved, e = s.registry.BeginWriteTransaction(ctx, req)
		}
	} else {
		if salesText(i.Payload, "legalEntityCode") != "" || continuation {
			tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, req, financeReq)
		} else {
			tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
		}
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if write && continuation {
		fr, e := s.registry.ResolveDomains(financeReq)
		if e != nil {
			return nil, e
		}
		if fr[0].DB != resolved[0].DB {
			return nil, enterprise.ErrBindingMismatch
		}
		resolved = append(resolved, fr[0])
	}
	r := resolved[0]
	plans, e := r.Table("altoc_billing_schedule")
	if e != nil {
		return nil, e
	}
	contracts, e := r.Table("altoc_contract")
	if e != nil {
		return nil, e
	}
	if !write {
		bank := ""
		if len(resolved) > 1 {
			bank, e = resolved[1].Table("finance_bank_account")
			if e != nil {
				return nil, e
			}
		}
		out, e := readReceivables(ctx, tx, plans, contracts, bank, r, op, i, who.Actor, scope, continuation)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	events, e := r.Table("altoc_collection_event")
	if e != nil {
		return nil, receivableError(503, "receivable_collection_not_installed")
	}
	// Registry -> contract -> billing schedule -> receipt -> append-only event.
	var parentID string
	if e = tx.QueryRowContext(ctx, "SELECT CAST(contract_id AS CHAR) FROM "+plans+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&parentID); e == sql.ErrNoRows {
		return nil, receivableError(404, "receivable_not_found")
	} else if e != nil {
		return nil, e
	}
	parent, e := salesRow(ctx, tx, contracts, "id=? AND deleted_at IS NULL", parentID)
	if e != nil {
		return nil, e
	}
	row, e := salesRow(ctx, tx, plans, "id=? AND contract_id=? AND direction='receivable' AND deleted_at IS NULL", i.ID, parentID)
	if e != nil {
		return nil, e
	}
	if !receivableScopeAllows(scope, who.Actor, parent, row) {
		return nil, receivableError(403, "receivable_scope_denied")
	}
	if checkedOwner != "" && salesText(row, "collection_responsible_uid") != checkedOwner {
		return nil, receivableError(409, "receivable_owner_changed")
	}

	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"operation": op, "intent": SalesIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(map[string]any{"operation": op, "intent": SalesIntent(i), "actor": who.Actor})
	rt, e := r.Table("service_command_receipt")
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(rt))
	if e != nil {
		return nil, e
	}
	identityBytes, _ := json.Marshal([]string{who.Tenant, who.Actor, op, who.Key})
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, identityBytes, 4).String()
	receipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.b5a." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if salesText(parent, "origin_type") == "historical_import" {
			if !continuation {
				return integrationoperation.ReceiptBusinessResult{}, receivableError(409, "historical_contract_not_ready")
			}
			if _, e := historicalContinuation(ctx, tx, salesText(parent, "code"), salesText(row, "code")); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		remaining := moneyCents(salesText(row, "unreceived_amount"))
		if continuation {
			remaining, e = receivableCapacity(ctx, tx, row)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		if remaining.Sign() <= 0 || salesText(row, "status") == "cancelled" || salesText(row, "status") == "received" || salesText(row, "status") == "bad_debt" {
			return integrationoperation.ReceiptBusinessResult{}, receivableError(409, "receivable_closed")
		}
		if fmt.Sprint(row["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return integrationoperation.ReceiptBusinessResult{}, receivableError(409, "receivable_version_conflict")
		}
		fields := map[string]any{}
		kind := "followup"
		switch op {
		case "receivables-set-collection-owner":
			kind = "assign"
			fields["collection_responsible_uid"] = i.Payload["collection_responsible_uid"]
			if _, ok := i.Payload["collection_due_at"]; ok {
				fields["collection_due_at"] = nullableReceivable(salesText(i.Payload, "collection_due_at"))
			}
		case "receivables-set-due-date":
			kind = "due_date"
			fields["due_date"] = nullableReceivable(salesText(i.Payload, "due_date"))
		case "collection-followup-create":
			if _, ok := i.Payload["next_followup_at"]; ok {
				fields["collection_due_at"] = nullableReceivable(salesText(i.Payload, "next_followup_at"))
			}
		}
		before := map[string]any{}
		for k := range fields {
			before[k] = row[k]
		}
		beforeJSON, _ := json.Marshal(before)
		afterJSON, _ := json.Marshal(fields)
		if _, er := tx.ExecContext(ctx, "INSERT INTO "+events+"(code,billing_schedule_id,contract_id,event_type,before_json,after_json,result,promised_payment_date,promised_amount,next_followup_at,actor_uid,idempotency_key,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", salesCode("CE-", oid), i.ID, parentID, kind, string(beforeJSON), string(afterJSON), nullableReceivable(salesText(i.Payload, "result")), nullableReceivable(salesText(i.Payload, "promised_payment_date")), i.Payload["promised_amount"], nullableReceivable(salesText(i.Payload, "next_followup_at")), who.Actor, who.Key, oid); er != nil {
			return integrationoperation.ReceiptBusinessResult{}, er
		}
		sets, args := []string{}, []any{}
		for _, k := range []string{"collection_responsible_uid", "collection_due_at", "due_date"} {
			if v, ok := fields[k]; ok {
				sets = append(sets, k+"=?")
				args = append(args, v)
			}
		}
		sets = append(sets, "row_version=row_version+1", "updated_by=?")
		args = append(args, who.Actor, i.ID)
		if _, er := tx.ExecContext(ctx, "UPDATE "+plans+" SET "+strings.Join(sets, ",")+" WHERE id=?", args...); er != nil {
			return integrationoperation.ReceiptBusinessResult{}, er
		}
		version, _ := strconv.ParseInt(fmt.Sprint(row["row_version"]), 10, 64)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "receivable", TargetBizCode: i.ID + ":v" + fmt.Sprint(version+1), HTTPStatus: 200}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, receivableError(409, "receivable_idempotency_conflict")
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, salesInvalid()
	}
	version, _ := strconv.ParseInt(parts[1], 10, 64)
	return map[string]any{"id": parts[0], "row_version": version}, nil
}
func receivableScopeAllows(scope altoc.BasicReadScope, actor string, parent, row map[string]any) bool {
	return altocScopeAllows(scope, actor, salesText(parent, "owner_uid"), salesText(parent, "owner_dept_code")) || ((scope.Access == "self" || scope.Access == "self_dept") && (salesText(row, "collection_responsible_uid") == actor || salesText(row, "owner_uid") == actor))
}

func nullableReceivable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// All totals and pages share a repeatable-read snapshot. No current balances are
// presented as historical as-of facts. Contract scope governs ownership;
// explicitly assigned collectors also get only their own plan in self scope.
func readReceivables(ctx context.Context, tx *sql.Tx, plans, contracts, bank string, r enterprise.Resolved, op string, i SalesInput, actor string, scope altoc.BasicReadScope, continuation ...bool) (any, error) {
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	currentDate := time.Now().In(zone).Format("2006-01-02")
	if d := salesText(i.Payload, "queryDate"); d != "" && d != currentDate {
		return nil, httperror.New(400, "receivable_history_not_ready", "仅支持当前业务日；历史计划版本与调整事件尚未完整")
	}
	hasOrigin, e := financeHasColumn(ctx, tx, contracts, "origin_type")
	if e != nil {
		return nil, e
	}
	origin := "'native'"
	if hasOrigin {
		origin = "c.origin_type"
	}
	scopeWhere, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	scopeWhere = strings.ReplaceAll(strings.ReplaceAll(scopeWhere, "owner_uid", "c.owner_uid"), "owner_dept_code", "c.owner_dept_code")
	if scope.Access == "self" || scope.Access == "self_dept" {
		scopeWhere = "(" + scopeWhere + " OR BINARY b.collection_responsible_uid=BINARY ? OR BINARY b.owner_uid=BINARY ?)"
		args = append(args, actor, actor)
	}
	if entity := salesText(i.Payload, "legalEntityCode"); entity != "" {
		has, e := financeHasColumn(ctx, tx, contracts, "receiving_bank_account_code")
		if e != nil {
			return nil, e
		}
		hasBank, e := financeHasColumn(ctx, tx, bank, "legal_entity_code")
		if e != nil {
			return nil, e
		}
		if !has || !hasBank {
			return nil, receivableError(503, "receivable_legal_entity_not_ready")
		}
	}
	where := "b.deleted_at IS NULL AND c.deleted_at IS NULL AND b.direction='receivable' AND (" + scopeWhere + ")"
	if entity := salesText(i.Payload, "legalEntityCode"); entity != "" {
		where += " AND EXISTS(SELECT 1 FROM " + bank + " a WHERE BINARY a.code=BINARY c.receiving_bank_account_code AND a.deleted_at IS NULL AND BINARY a.legal_entity_code=BINARY ?)"
		args = append(args, entity)
	}
	for _, f := range []struct{ key, col string }{{"customerId", "c.customer_id"}, {"contractId", "c.id"}, {"collectionResponsibleUid", "b.collection_responsible_uid"}, {"currencyCode", "b.currency_code"}, {"status", "b.status"}} {
		if v := salesText(i.Payload, f.key); v != "" {
			where += " AND BINARY " + f.col + "=BINARY ?"
			args = append(args, v)
		}
	}
	if v := salesText(i.Payload, "search"); v != "" {
		where += " AND (b.name LIKE ? OR b.code LIKE ? OR c.name LIKE ? OR c.code LIKE ?)"
		for n := 0; n < 4; n++ {
			args = append(args, "%"+strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(v, "\\", "\\\\"), "%", "\\%"), "_", "\\_")+"%")
		}
	}
	// Business date is pinned once; no CURDATE drift between page and aggregate.
	bucket := "CASE WHEN b.due_date IS NULL THEN 'no_due_date' WHEN DATEDIFF('" + currentDate + "',b.due_date)<=0 THEN 'not_due' WHEN DATEDIFF('" + currentDate + "',b.due_date)<=30 THEN '1_30' WHEN DATEDIFF('" + currentDate + "',b.due_date)<=60 THEN '31_60' WHEN DATEDIFF('" + currentDate + "',b.due_date)<=90 THEN '61_90' WHEN DATEDIFF('" + currentDate + "',b.due_date)<=180 THEN '91_180' ELSE 'over_180' END"
	historical := origin + "='historical_import'"
	ready := origin + "<>'historical_import'"
	remaining := "b.unreceived_amount"
	if len(continuation) > 0 && continuation[0] {
		proof := "EXISTS(SELECT 1 FROM finance_historical_readiness hr WHERE hr.contract_id=c.id AND hr.billing_schedule_id=b.id)"
		ready = "(" + ready + " OR " + proof + ")"
		historical = "(" + historical + " AND NOT " + proof + ")"
		remaining = "(b.unreceived_amount-(SELECT COALESCE(SUM(a.amount),0) FROM finance_receivable_adjustment a WHERE a.billing_schedule_id=b.id AND a.status='confirmed'))"
	}

	from := plans + " b JOIN " + contracts + " c ON c.id=b.contract_id"
	if op == "receivables-detail" {
		rows, e := tx.QueryContext(ctx, "SELECT b.*,"+remaining+" AS unreceived_amount,("+ready+") AS financial_ready,c.code AS contract_code,c.name AS contract_name,"+origin+" AS origin_type FROM "+from+" WHERE "+where+" AND b.id=?", append(args, i.ID)...)
		if e != nil {
			return nil, e
		}
		cols, e := rows.Columns()
		if e != nil {
			rows.Close()
			return nil, e
		}
		items, e := readFinanceRows(rows, cols)
		if e != nil {
			return nil, e
		}
		if len(items) != 1 {
			return nil, receivableError(404, "receivable_not_found")
		}
		item := projectReceivable(items[0])
		item["financial_ready"] = ledgerVersion(items[0]["financial_ready"]) == 1
		item["query_date"] = currentDate
		today, _ := time.Parse("2006-01-02", currentDate)
		item["aging_bucket"] = ReceivableAgingBucket(salesText(item, "due_date"), today)
		events, e := r.Table("altoc_collection_event")
		item["collection_installed"] = e == nil
		item["followups"] = []map[string]any{}
		historyPage, historySize := 1, 20
		if v, ok := i.Payload["page"].(float64); ok {
			historyPage = int(v)
		}
		if v, ok := i.Payload["pageSize"].(float64); ok {
			historySize = int(v)
		}
		item["followup_page"] = historyPage
		item["followup_page_size"] = historySize
		item["followup_total"] = int64(0)
		if e == nil {
			var count int64
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+events+" WHERE billing_schedule_id=?", i.ID).Scan(&count); e != nil {
				return nil, e
			}
			item["followup_total"] = count
			rows, e := tx.QueryContext(ctx, "SELECT code,event_type,before_json,after_json,result,CAST(promised_payment_date AS CHAR) AS promised_payment_date,CAST(promised_amount AS CHAR) AS promised_amount,CAST(next_followup_at AS CHAR) AS next_followup_at,actor_uid,CAST(created_at AS CHAR) AS created_at FROM "+events+" WHERE billing_schedule_id=? ORDER BY id DESC LIMIT ? OFFSET ?", i.ID, historySize, (historyPage-1)*historySize)
			if e != nil {
				return nil, e
			}
			cols, e := rows.Columns()
			if e != nil {
				rows.Close()
				return nil, e
			}
			history, e := readFinanceRows(rows, cols)
			if e != nil {
				return nil, e
			}
			item["followups"] = history
		}
		return item, nil
	}
	var historicalCount int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where+" AND "+historical, args...).Scan(&historicalCount); e != nil {
		return nil, e
	}
	where += " AND " + ready + " AND b.status NOT IN ('cancelled','bad_debt') AND " + remaining + ">0"
	if v := salesText(i.Payload, "agingBucket"); v != "" {
		where += " AND (" + bucket + ")=?"
		args = append(args, v)
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT b.currency_code,"+bucket+" AS aging_bucket,COUNT(*) AS item_count,CAST(SUM(b.amount) AS CHAR) AS amount,CAST(SUM(b.received_amount) AS CHAR) AS received_amount,CAST(SUM("+remaining+") AS CHAR) AS outstanding_amount FROM "+from+" WHERE "+where+" GROUP BY b.currency_code,aging_bucket ORDER BY b.currency_code,FIELD(aging_bucket,'not_due','1_30','31_60','61_90','91_180','over_180','no_due_date')", args...)
	if e != nil {
		return nil, e
	}
	totals, e := readFinanceRows(rows, []string{"currency_code", "aging_bucket", "item_count", "amount", "received_amount", "outstanding_amount"})
	if e != nil {
		return nil, e
	}
	items := []map[string]any{}
	page := int(i.Payload["page"].(float64))
	size := int(i.Payload["pageSize"].(float64))
	if op == "receivables-page" {
		rows, e := tx.QueryContext(ctx, "SELECT b.*,"+remaining+" AS unreceived_amount,c.code AS contract_code,c.name AS contract_name,c.customer_id,"+bucket+" AS aging_bucket FROM "+from+" WHERE "+where+" ORDER BY b.due_date IS NULL,b.due_date,b.id LIMIT ? OFFSET ?", append(append([]any{}, args...), size, (page-1)*size)...)
		if e != nil {
			return nil, e
		}
		cols, e := rows.Columns()
		if e != nil {
			rows.Close()
			return nil, e
		}
		values, e := readFinanceRows(rows, cols)
		if e != nil {
			return nil, e
		}
		for _, v := range values {
			items = append(items, projectReceivable(v))
		}
	}
	_, installErr := r.Table("altoc_collection_event")
	installed := installErr == nil
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "totals": totals, "query_date": currentDate, "date_basis": "due_date", "historical_not_ready_count": historicalCount, "collection_installed": installed}, nil
}
func projectReceivable(v map[string]any) map[string]any {
	out := map[string]any{}
	for _, k := range []string{"id", "code", "contract_id", "contract_code", "contract_name", "customer_id", "name", "amount", "currency_code", "due_date", "status", "received_amount", "unreceived_amount", "owner_uid", "collection_responsible_uid", "collection_due_at", "row_version", "aging_bucket", "origin_type"} {
		if x, ok := v[k]; ok {
			if t, ok := x.(time.Time); ok {
				x = t.Format("2006-01-02 15:04:05")
				if k == "due_date" {
					x = t.Format("2006-01-02")
				}
			}
			out[k] = x
		}
	}
	return out
}
