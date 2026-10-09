package altoc

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseticket"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"sort"
	"strings"
	"time"
)

// PreparedTicketResults is only produced by the owning pre-lock path. It is not
// serializable and cannot be fabricated from transport fields.
type PreparedTicketResults struct {
	tx          *sql.Tx
	altoc, aims enterprise.Resolved
	items       map[string]map[string]any
}

func PrepareEnterpriseTicketResultsTx(ctx context.Context, tx *sql.Tx, ar, ir enterprise.Resolved, ids []int64) (enterpriseticket.Prepared, error) {
	if tx == nil || ar.Domain != "altoc" || ir.Domain != "aims" || ar.Key != ir.Key || ar.Generation != ir.Generation {
		return nil, enterprise.ErrBindingMismatch
	}
	p := &PreparedTicketResults{tx: tx, altoc: ar, aims: ir, items: map[string]map[string]any{}}
	if len(ids) == 0 {
		return p, nil
	}
	names := map[string]string{}
	for _, n := range []string{"altoc_customer", "altoc_contract", "altoc_service_agreement", "altoc_service_ticket", "altoc_audit_log"} {
		v, e := ar.Table(n)
		if e != nil {
			return nil, e
		}
		names[n] = v
	}
	wi, e := ir.Table("work_items")
	if e != nil {
		return nil, e
	}
	ext, e := ir.Table("work_item_service_ext")
	if e != nil {
		return nil, e
	}
	ph := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := []any{}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, e := altocQueryMaps(ctx, tx, "SELECT t.id,t.customer_id,t.contract_id,t.service_agreement_id,w.id AS work_item_id,w.item_key FROM "+names["altoc_service_ticket"]+" t JOIN "+ext+" se ON BINARY se.source_ticket_code=BINARY t.code JOIN "+wi+" w ON w.id=se.work_item_id WHERE w.id IN ("+ph+") AND t.deleted_at IS NULL", args...)
	if e != nil {
		return nil, e
	}
	locked := map[string]map[int64]map[string]any{}
	// All Altoc rows precede Aims locks, and each table's IDs are ascending.
	for _, group := range []struct{ table, key string }{{"altoc_customer", "customer_id"}, {"altoc_contract", "contract_id"}, {"altoc_service_agreement", "service_agreement_id"}, {"altoc_service_ticket", "id"}} {
		locked[group.table] = map[int64]map[string]any{}
		keys := []int64{}
		seen := map[int64]bool{}
		for _, row := range rows {
			id := altocPositiveID(row[group.key])
			if id <= 0 {
				return nil, httperror.New(409, "service_ticket_binding_invalid", "工单归属无效")
			}
			if !seen[id] {
				keys = append(keys, id)
				seen[id] = true
			}
		}
		sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
		for _, id := range keys {
			row, e := altocQueryOneMap(ctx, tx, "SELECT * FROM "+names[group.table]+" WHERE id=? AND deleted_at IS NULL FOR UPDATE", id)
			if e != nil {
				return nil, e
			}
			if row == nil {
				return nil, httperror.New(409, "service_ticket_binding_changed", "工单归属已变化")
			}
			locked[group.table][id] = row
			if group.table == "altoc_service_ticket" {
				for _, source := range rows {
					if altocPositiveID(source["id"]) == id {
						if altocPositiveID(row["customer_id"]) != altocPositiveID(source["customer_id"]) || altocPositiveID(row["contract_id"]) != altocPositiveID(source["contract_id"]) || altocPositiveID(row["service_agreement_id"]) != altocPositiveID(source["service_agreement_id"]) {
							return nil, enterprise.ErrBindingMismatch
						}
						p.items[fmt.Sprint(source["work_item_id"])] = row
					}
				}
			}
		}
	}
	for _, row := range p.items {
		contract := locked["altoc_contract"][altocPositiveID(row["contract_id"])]
		agreement := locked["altoc_service_agreement"][altocPositiveID(row["service_agreement_id"])]
		if altocPositiveID(contract["customer_id"]) != altocPositiveID(row["customer_id"]) || altocPositiveID(agreement["contract_id"]) != altocPositiveID(row["contract_id"]) {
			return nil, enterprise.ErrBindingMismatch
		}
	}
	return p, nil
}

// ApplyEnterpriseTicketResultTx receives only facts derived by Aims owning core.
// No user permission is substituted: the Aims command's authorization already
// passed, and its Altoc source binding was locked before all Aims writes.
func (p *PreparedTicketResults) Apply(ctx context.Context, tx *sql.Tx, itemID string, facts map[string]any) (bool, error) {
	if p.tx != tx {
		return false, enterprise.ErrBindingMismatch
	}
	t, ok := p.items[itemID]
	if !ok {
		return false, httperror.New(409, "service_ticket_prelock_missing", "工单绑定已变化，请重试")
	}
	if altocMapText(t, "aims_work_item_key") != fmt.Sprint(facts["workItemKey"]) || altocMapText(t, "aims_project_code") != fmt.Sprint(facts["aimsProjectCode"]) || altocMapText(t, "code") != fmt.Sprint(facts["ticketCode"]) {
		return false, httperror.New(409, "service_ticket_delivery_binding_conflict", "工单执行归属不符")
	}
	raw, e := json.Marshal(facts)
	if e != nil {
		return false, e
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	gen := int64(numberValue(facts["deliveryGeneration"], 0))
	current := int64(numberValue(t["aims_delivery_generation"], 0))
	if gen < current {
		return true, nil
	}
	if gen == current {
		if altocMapText(t, "delivery_hash") != hash {
			return false, httperror.New(409, "service_ticket_delivery_payload_conflict", "同代结果不一致")
		}
		return true, nil
	}
	status := serviceTicketStatusFromDeliveryResult(facts)
	if status == "" {
		return false, httperror.New(400, "service_ticket_delivery_status_invalid", "执行结果状态无效")
	}
	// Terminal tickets are never reopened by a delayed or higher generation.
	if old := altocMapText(t, "status"); old == "resolved" || old == "closed" || old == "cancelled" {
		status = old
	}
	agreementTable, _ := p.altoc.Table("altoc_service_agreement")
	ticketTable, _ := p.altoc.Table("altoc_service_ticket")
	audit, _ := p.altoc.Table("altoc_audit_log")
	agreement, e := altocQueryOneMap(ctx, tx, "SELECT * FROM "+agreementTable+" WHERE id=? AND deleted_at IS NULL", t["service_agreement_id"])
	if e != nil {
		return false, e
	}
	if agreement == nil {
		return false, httperror.New(409, "service_agreement_missing", "服务协议不存在")
	}
	final := map[string]any{}
	for k, v := range t {
		final[k] = v
	}
	final["status"] = status
	delta := serviceTicketQuotaConsumption(final, agreement, facts)
	if delta > 0 {
		if _, e = tx.ExecContext(ctx, "UPDATE "+agreementTable+" SET consumed_quota=consumed_quota+?,row_version=row_version+1 WHERE id=?", fmt.Sprintf("%.2f", delta), agreement["id"]); e != nil {
			return false, e
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE "+ticketTable+" SET status=?,aims_delivery_status=?,aims_delivery_generation=?,delivery_hash=?,quota_consumed=quota_consumed+?,first_responded_at=COALESCE(first_responded_at,?),resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at,UTC_TIMESTAMP()) ELSE resolved_at END,closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,UTC_TIMESTAMP()) ELSE closed_at END,row_version=row_version+1 WHERE id=?", status, status, gen, hash, fmt.Sprintf("%.2f", delta), nullableText(serviceResultText(facts, "firstRespondedAt")), status, status, t["id"]); e != nil {
		return false, e
	}
	final["first_responded_at"] = firstNonEmptyText(serviceResultText(facts, "firstRespondedAt"), altocMapText(t, "first_responded_at"))
	if (status == "resolved" || status == "closed") && final["resolved_at"] == nil {
		final["resolved_at"] = time.Now().UTC()
	}
	sla := serviceTicketSLAStatus(final, serviceAgreementEntitlementStatus(agreement, time.Now().UTC()), t["response_due_at"], t["resolution_due_at"], time.Now().UTC())
	if _, e = tx.ExecContext(ctx, "UPDATE "+ticketTable+" SET sla_status=? WHERE id=?", sla, t["id"]); e != nil {
		return false, e
	}
	safe, _ := json.Marshal(map[string]any{"generation": gen, "status": status, "delta": fmt.Sprintf("%.2f", delta)})
	if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,action,operator_uid,new_value) VALUES ('service_ticket',?,'aims-result','enterprise.runtime',?)", t["id"], string(safe)); e != nil {
		return false, e
	}
	t["status"] = status
	t["aims_delivery_generation"] = gen
	t["delivery_hash"] = hash
	t["quota_consumed"] = moneyValue(t["quota_consumed"]) + delta
	return true, nil
}
