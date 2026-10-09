package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	"sort"
	"strconv"
	"strings"
	"time"
)

var renewalOps = map[string][2]string{
	"renewals-page": {"renewal_opportunity", "view"}, "renewals-view": {"renewal_opportunity", "view"},
	"renewals-create": {"renewal_opportunity", "edit"}, "renewals-update": {"renewal_opportunity", "edit"},
}

func IsRenewalOperation(op string) bool { _, ok := renewalOps[op]; return ok }

var renewalText = map[string]int{"name": 200, "owner_uid": 50, "owner_dept_code": 50, "reason": 500, "next_action": 500}
var renewalEnums = map[string][]string{"renewal_type": {"maintenance", "upsell", "cross_sell"}, "stage": {"identified", "contacted", "proposal", "negotiation", "closed"}, "status": {"open", "won", "lost", "cancelled"}, "risk_level": {"low", "medium", "high"}}

func validateRenewal(op string, i SalesInput) error {
	if !IsRenewalOperation(op) {
		return salesInvalid()
	}
	create, page := op == "renewals-create", op == "renewals-page"
	if create || page {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	if page {
		for _, k := range []string{"page", "pageSize"} {
			fields[k] = true
			n, ok := i.Payload[k].(float64)
			max := float64(1000000)
			if k == "pageSize" {
				max = 100
			}
			if !ok || n < 1 || n > max || n != float64(int64(n)) {
				return salesInvalid()
			}
		}
		fields["search"] = true
		if v, ok := i.Payload["search"]; ok && !stringValue(v, 200, true) {
			return salesInvalid()
		}
	} else if op != "renewals-view" {
		for k, max := range renewalText {
			fields[k] = true
			if v, ok := i.Payload[k]; ok && !stringValue(v, max, k != "name" && k != "owner_uid") {
				return salesInvalid()
			}
		}
		for k, values := range renewalEnums {
			fields[k] = true
			if v, ok := i.Payload[k]; ok {
				if k == "risk_level" && (v == nil || v == "") {
					continue
				}
				s, ok := v.(string)
				if !ok || !containsSalesSupport(values, s) {
					return salesInvalid()
				}
			}
		}
		for _, k := range []string{"customer_id", "contract_id"} {
			fields[k] = true
			if v, ok := i.Payload[k]; ok {
				if k == "contract_id" && (v == nil || v == "") {
					continue
				}
				s, ok := v.(string)
				if !ok || !validCustomerID(s) {
					return salesInvalid()
				}
			}
		}
		for _, k := range []string{"expected_sign_date", "next_action_due_date"} {
			fields[k] = true
			if v, ok := i.Payload[k]; ok && v != nil && v != "" {
				s, ok := v.(string)
				_, e := time.Parse("2006-01-02", s)
				if !ok || e != nil {
					return salesInvalid()
				}
			}
		}
		fields["expected_amount"] = true
		if v, ok := i.Payload["expected_amount"]; ok && v != nil && v != "" && !validMoney(v) {
			return salesInvalid()
		}
		if create {
			if !stringValue(i.Payload["name"], 200, false) || !stringValue(i.Payload["owner_uid"], 50, false) || !validCustomerID(salesText(i.Payload, "customer_id")) {
				return salesInvalid()
			}
		} else {
			fields["expectedVersion"] = true
			n, ok := i.Payload["expectedVersion"].(float64)
			if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) || len(i.Payload) < 2 {
				return salesInvalid()
			}
		}
	}
	for k := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
	}
	return nil
}
func (s *Service) Renewals(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = httperror.New(409, "altoc_renewal_write_conflict", "资料已变化，请刷新后重试")
		}
	}()
	if e := validateRenewal(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "altoc_renewal_identity_invalid", "Verified actor required")
	}
	if !domaininstall.IsAltocRenewalsDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "altoc_renewals_not_installed", "续约功能尚未安装")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	write := renewalOps[op][1] == "edit"
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
		if who.Key == "" {
			return nil, salesInvalid()
		}
	}
	req, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	// Serialize sales writes before customer -> contract -> renewal, matching the
	// existing sales gate. Snapshot lookup selects refs only; locked row rechecked.
	if write {
		if _, e = salesRow(ctx, tx, table("opportunity_stage"), "1=1 ORDER BY id"); e != nil && httperrorStatus(e) != 404 {
			return nil, e
		}
	}
	var parent map[string]any
	if i.ID != "" {
		rows, e := queryRows(ctx, tx, "SELECT * FROM "+table("renewal_opportunity")+" WHERE id=? AND deleted_at IS NULL", i.ID)
		if e != nil {
			return nil, e
		}
		if len(rows) == 0 {
			return nil, httperror.New(404, "altoc_renewal_not_found", "续约记录不存在")
		}
		parent = rows[0]
		if e = salesScope(scope, who.Actor, parent); e != nil {
			return nil, e
		}
	}
	if !write {
		out, e = renewalRead(ctx, tx, table, op, i, who.Actor, scope)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	target := map[string]any{}
	if parent != nil {
		for k, v := range parent {
			target[k] = v
		}
	}
	for k, v := range i.Payload {
		target[k] = v
	}
	if e = salesScope(scope, who.Actor, target); e != nil {
		return nil, e
	}
	// Recheck both old and new refs before receipt; changing a reference must not
	// allow an actor to escape a now-inaccessible source object.
	customers, contracts := []string{}, []string{}
	for _, row := range []map[string]any{parent, target} {
		if row == nil {
			continue
		}
		customers = append(customers, fmt.Sprint(row["customer_id"]))
		if row["contract_id"] != nil && row["contract_id"] != "" {
			contracts = append(contracts, fmt.Sprint(row["contract_id"]))
		}
	}
	// Stable numeric ordering covers old/new rows when relinking.
	customers = renewalSortedIDs(customers)
	contracts = renewalSortedIDs(contracts)
	for _, id := range customers {
		row, e := salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", id)
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, row); e != nil {
			return nil, e
		}
	}
	for _, id := range contracts {
		row, e := salesRow(ctx, tx, table("contract"), "id=? AND deleted_at IS NULL", id)
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, row); e != nil {
			return nil, e
		}
		for _, ref := range []map[string]any{parent, target} {
			if ref != nil && fmt.Sprint(ref["contract_id"]) == id && fmt.Sprint(ref["customer_id"]) != fmt.Sprint(row["customer_id"]) {
				return nil, salesInvalid()
			}
		}
	}
	if parent != nil {
		locked, e := salesRow(ctx, tx, table("renewal_opportunity"), "id=? AND deleted_at IS NULL", i.ID)
		if e != nil {
			return nil, e
		}
		if fmt.Sprint(locked["row_version"]) != fmt.Sprint(parent["row_version"]) {
			return nil, httperror.New(409, "altoc_renewal_version_conflict", "资料版本已变化")
		}
		parent = locked
		if e = salesScope(scope, who.Actor, parent); e != nil {
			return nil, e
		}
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf16d|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	command := map[string]any{"operation": op, "intent": SalesIntent(i), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	rt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(rt))
	if e != nil {
		return nil, e
	}
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf16d." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if parent != nil && fmt.Sprint(parent["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(httperror.New(409, "altoc_renewal_version_conflict", "资料版本已变化"))
		}
		fields := map[string]any{}
		for k, v := range i.Payload {
			if k != "expectedVersion" {
				if v == "" && k != "name" && k != "owner_uid" {
					v = nil
				}
				fields[k] = v
			}
		}
		id := i.ID
		if op == "renewals-create" {
			fields["code"] = salesCode("RO-", oid)
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table("renewal_opportunity"), fields)
		} else {
			e = salesUpdate(ctx, tx, table("renewal_opportunity"), id, fields, who.Actor)
		}
		if e != nil {
			return fail(e)
		}
		audit, _ := r.Table("altoc_audit_log")
		snapshot, _ := json.Marshal(map[string]any{"operation": op, "id": id})
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,action,operator_uid,request_id,new_value) VALUES (?,?,?,?,?,?)", "renewal_opportunity", id, op, who.Actor, who.RequestID, string(snapshot)); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "renewal_opportunity", TargetBizCode: id, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_renewal_idempotency_conflict", "同一操作键的内容已变化")
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"id": result.TargetBizCode}, nil
}
func renewalRead(ctx context.Context, tx *sql.Tx, table func(string) string, op string, i SalesInput, actor string, scope altoc.BasicReadScope) (any, error) {
	w, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	w = strings.ReplaceAll(strings.ReplaceAll(w, "owner_uid", "t.owner_uid"), "owner_dept_code", "t.owner_dept_code") + " AND t.deleted_at IS NULL"
	for _, ref := range []string{"customer", "contract"} {
		rw, ra, e := scopeSQL("altoc", actor, scope)
		if e != nil {
			return nil, e
		}
		rw = strings.ReplaceAll(strings.ReplaceAll(rw, "owner_uid", "related.owner_uid"), "owner_dept_code", "related.owner_dept_code")
		w += " AND (t." + ref + "_id IS NULL OR EXISTS (SELECT 1 FROM " + table(ref) + " related WHERE related.id=t." + ref + "_id AND related.deleted_at IS NULL AND " + rw + "))"
		args = append(args, ra...)
	}
	if op == "renewals-view" {
		w += " AND t.id=?"
		args = append(args, i.ID)
		rows, e := queryRows(ctx, tx, "SELECT t.*, (SELECT name FROM "+table("customer")+" label WHERE label.id=t.customer_id) AS customer_name,(SELECT name FROM "+table("contract")+" label WHERE label.id=t.contract_id) AS contract_name FROM "+table("renewal_opportunity")+" t WHERE "+w, args...)
		if e != nil {
			return nil, e
		}
		if len(rows) == 0 {
			return nil, httperror.New(403, "altoc_renewal_scope_denied", "无权查看续约记录")
		}
		return rows[0], nil
	}
	if search := salesText(i.Payload, "search"); search != "" {
		w += " AND (t.name LIKE ? OR t.code LIKE ?)"
		args = append(args, "%"+search+"%", "%"+search+"%")
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table("renewal_opportunity")+" t WHERE "+w, args...).Scan(&total); e != nil {
		return nil, e
	}
	page, size := int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))
	rows, e := queryRows(ctx, tx, "SELECT t.*, (SELECT name FROM "+table("customer")+" label WHERE label.id=t.customer_id) AS customer_name,(SELECT name FROM "+table("contract")+" label WHERE label.id=t.contract_id) AS contract_name FROM "+table("renewal_opportunity")+" t WHERE "+w+" ORDER BY t.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	return map[string]any{"items": rows, "total": total}, e
}

func renewalSortedIDs(ids []string) []string {
	sort.Slice(ids, func(i, j int) bool {
		a, _ := strconv.ParseInt(ids[i], 10, 64)
		b, _ := strconv.ParseInt(ids[j], 10, 64)
		return a < b
	})
	out := []string{}
	for _, id := range ids {
		if len(out) == 0 || out[len(out)-1] != id {
			out = append(out, id)
		}
	}
	return out
}
