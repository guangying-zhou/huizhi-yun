package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func salesInitialStage(ctx context.Context, tx *sql.Tx, table, id string) (map[string]any, error) {
	where := "pipeline_code='default' AND is_enabled=1 AND COALESCE(is_closed,0)=0 AND COALESCE(stage_kind,'normal')='normal'"
	args := []any{}
	if id != "" {
		where += " AND id=?"
		args = append(args, id)
	}
	return salesRow(ctx, tx, table, where+" ORDER BY sort_no,id", args...)
}
func salesTransitionTx(ctx context.Context, tx *sql.Tx, table func(string) string, op string, row, p map[string]any, who Identity) (map[string]any, error) {
	current, e := salesRow(ctx, tx, table("opportunity_stage"), "id=?", row["stage_id"])
	if e != nil {
		return nil, e
	}
	var target map[string]any
	action := map[string]string{"opportunities-close-won": "won", "opportunities-close-lost": "lost", "opportunities-pause": "paused"}[op]
	if action != "" {
		target, e = salesRow(ctx, tx, table("opportunity_stage"), "pipeline_code=? AND is_enabled=1 AND stage_kind=? ORDER BY sort_no,id", current["pipeline_code"], action)
	} else {
		target, e = salesRow(ctx, tx, table("opportunity_stage"), "id=? AND is_enabled=1 AND pipeline_code=? AND stage_kind='normal' AND COALESCE(is_closed,0)=0", p["stageId"], current["pipeline_code"])
	}
	if e != nil {
		return nil, e
	}
	if salesText(row, "status") != "active" && op != "opportunities-reopen" {
		return nil, httperror.New(409, "altoc_opportunity_closed", "请先重新打开关闭的商机")
	}
	if op == "opportunities-reopen" && salesText(row, "status") == "active" {
		return nil, httperror.New(409, "altoc_opportunity_not_closed", "商机尚未关闭")
	}
	updates := map[string]any{}
	for k, v := range p {
		if k != "expectedVersion" && k != "stageId" && k != "change_reason" {
			updates[k] = v
		}
	}
	if e = altoc.EnterpriseOpportunityTransition(current, target, row, updates); e != nil {
		return nil, e
	}
	status := altoc.EnterpriseStageStatus(target)
	updates["stage_id"] = target["id"]
	updates["win_rate"] = target["win_rate"]
	updates["status"] = status
	updates["last_status_changed_by"] = who.Actor
	if _, e = tx.ExecContext(ctx, "UPDATE "+table("opportunity")+" SET last_status_changed_at=UTC_TIMESTAMP(3),version_no=version_no+1 WHERE id=?", row["id"]); e != nil {
		return nil, e
	}
	if salesText(row, "stage_id") != salesText(target, "id") || salesText(row, "status") != status {
		snapshot := func(k string) any {
			if v, ok := updates[k]; ok {
				return v
			}
			return row[k]
		}
		if _, e = salesInsert(ctx, tx, table("opportunity_stage_log"), map[string]any{"opportunity_id": row["id"], "from_stage_id": row["stage_id"], "to_stage_id": target["id"], "changed_by": who.Actor, "change_reason": p["change_reason"], "amount_snapshot": snapshot("amount_tax_inclusive"), "forecast_category_snapshot": snapshot("forecast_category"), "expected_sign_date_snapshot": snapshot("expected_sign_date"), "win_rate_snapshot": target["win_rate"], "version_no": salesInt(row["version_no"]) + 1}); e != nil {
			return nil, e
		}
	}
	// Terminal timestamps are authoritative and cannot be supplied by the browser.
	for _, k := range []string{"won_at", "lost_at"} {
		updates[k] = nil
	}
	if status == "won" || status == "lost" {
		if _, e = tx.ExecContext(ctx, "UPDATE "+table("opportunity")+" SET "+status+"_at=UTC_TIMESTAMP(3) WHERE id=?", row["id"]); e != nil {
			return nil, e
		}
		delete(updates, status+"_at")
	}
	return updates, nil
}
func salesInt(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case uint64:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}
func salesTaskTx(ctx context.Context, tx *sql.Tx, table, resource string, row map[string]any, who Identity, oid string, ownerCheck salesOwnerCheck) error {
	if status := salesText(row, "status"); status == "converted" || status == "closed_invalid" || status == "won" || status == "lost" || status == "paused" {
		_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET status='canceled',updated_by=?,row_version=row_version+1 WHERE related_type=? AND related_id=? AND status IN ('todo','doing','overdue') AND deleted_at IS NULL", who.Actor, resource, row["id"])
		return e
	}
	action := salesText(row, "next_action")
	if action == "" {
		return nil
	}
	due := row["next_action_due_at"]
	if due == nil {
		return salesInvalid()
	}
	var count int
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE related_type=? AND related_id=? AND BINARY content=BINARY ? AND BINARY assignee_uid=BINARY ? AND due_at=? AND status='todo' AND deleted_at IS NULL", resource, row["id"], action, row["owner_uid"], due).Scan(&count); e != nil {
		return e
	}
	if count > 0 {
		return nil
	}
	if e := ownerCheck(salesText(row, "owner_uid")); e != nil {
		return e
	}
	_, e := salesInsert(ctx, tx, table, map[string]any{"code": salesCode("ST-", oid), "name": string([]rune(action)[:min(200, len([]rune(action)))]), "content": action, "related_type": resource, "related_id": row["id"], "assignee_uid": row["owner_uid"], "due_at": due, "status": "todo", "created_by": who.Actor, "updated_by": who.Actor})
	return e
}
func (s *Service) convertSalesLeadTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, lead map[string]any, i SalesInput, who Identity, scope altoc.BasicReadScope, customer, contact map[string]any, oid string, ownerCheck salesOwnerCheck) (map[string]any, error) {
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	if e := altoc.EnterpriseLeadQualification(lead, i.Payload, who.Actor); e != nil {
		return nil, e
	}
	stage, e := salesInitialStage(ctx, tx, table("opportunity_stage"), salesText(i.Payload, "stageId"))
	if e != nil {
		return nil, e
	}
	owner := salesText(i.Payload, "owner_uid")
	if owner == "" {
		owner = salesText(lead, "owner_uid")
	}
	if e := ownerCheck(owner); e != nil {
		return nil, e
	}
	dept := salesText(lead, "owner_dept_code")
	if v, ok := i.Payload["owner_dept_code"]; ok {
		dept, _ = v.(string)
	}
	if customer == nil {
		name := salesText(i.Payload, "customer_name")
		if name == "" {
			name = salesText(lead, "org_name")
		}
		if name == "" {
			return nil, salesInvalid()
		}
		normalized := strings.ToLower(strings.Join(strings.Fields(name), ""))
		// Matching is current and locked, not a caller-provided reused flag.
		existing, er := salesRow(ctx, tx, table("customer"), "(BINARY normalized_name=BINARY ? OR BINARY name=BINARY ?) AND deleted_at IS NULL ORDER BY id", normalized, name)
		if er == nil {
			customer = existing
		} else if httperrorStatus(er) != 404 {
			return nil, er
		}
		if customer == nil {
			id, er := salesInsert(ctx, tx, table("customer"), map[string]any{"code": salesCode("CU-", oid), "name": name, "normalized_name": normalized, "source_type": lead["source_type"], "owner_uid": owner, "owner_dept_code": dept, "status": "active", "created_by": who.Actor, "updated_by": who.Actor})
			if er != nil {
				return nil, er
			}
			customer, e = salesRow(ctx, tx, table("customer"), "id=?", id)
			if e != nil {
				return nil, e
			}
		}
	}
	if e = salesScope(scope, who.Actor, customer); e != nil {
		return nil, e
	}
	if contact == nil {
		name := salesText(i.Payload, "contact_name")
		if name == "" {
			name = salesText(lead, "contact_name")
		}
		mobile := salesText(i.Payload, "contact_mobile")
		if mobile == "" {
			mobile = salesText(lead, "contact_mobile")
		}
		email := salesText(i.Payload, "contact_email")
		if email == "" {
			email = salesText(lead, "contact_email")
		}
		if name != "" || mobile != "" || email != "" {
			existing, er := salesRow(ctx, tx, table("contact"), "customer_id=? AND deleted_at IS NULL AND ((?<>'' AND BINARY mobile=BINARY ?) OR (?<>'' AND BINARY email=BINARY ?) OR (?<>'' AND BINARY name=BINARY ?)) ORDER BY id", customer["id"], mobile, mobile, email, email, name, name)
			if er == nil {
				contact = existing
			} else if httperrorStatus(er) != 404 {
				return nil, er
			}
			if contact == nil {
				if name == "" {
					name = "线索联系人"
				}
				id, er := salesInsert(ctx, tx, table("contact"), map[string]any{"code": salesCode("CN-", oid), "customer_id": customer["id"], "name": name, "mobile": mobile, "email": email, "status": "active", "created_by": who.Actor, "updated_by": who.Actor})
				if er != nil {
					return nil, er
				}
				contact, e = salesRow(ctx, tx, table("contact"), "id=?", id)
				if e != nil {
					return nil, e
				}
			}
		}
	}
	var similar int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table("opportunity")+" WHERE customer_id=? AND status='active' AND deleted_at IS NULL", customer["id"]).Scan(&similar); e != nil {
		return nil, e
	}
	if similar > 0 && i.Payload["ack_similar_opportunity"] != true {
		return nil, httperror.New(409, "altoc_similar_opportunity_confirmation_required", "客户已有进行中商机，请确认是否继续创建")
	}
	name := salesText(i.Payload, "opportunity_name")
	if name == "" {
		name = salesText(lead, "name")
	}
	opportunity := map[string]any{"code": salesCode("OP-", oid), "name": name, "customer_id": customer["id"], "lead_id": lead["id"], "stage_id": stage["id"], "status": "active", "win_rate": stage["win_rate"], "owner_uid": owner, "owner_dept_code": dept, "next_action": lead["next_action"], "next_action_due_at": lead["next_action_due_at"], "created_by": who.Actor, "updated_by": who.Actor}
	if e = salesScope(scope, who.Actor, opportunity); e != nil {
		return nil, e
	}
	oppID, e := salesInsert(ctx, tx, table("opportunity"), opportunity)
	if e != nil {
		return nil, e
	}
	var contactID any
	if contact != nil {
		contactID = contact["id"]
		if _, e = salesInsert(ctx, tx, table("opportunity_contact_role"), map[string]any{"opportunity_id": oppID, "contact_id": contactID, "role": "end_user", "is_primary": 1, "created_by": who.Actor, "updated_by": who.Actor}); e != nil {
			return nil, e
		}
	}
	snapshot, _ := json.Marshal(map[string]any{"leadId": lead["id"], "customerId": customer["id"], "contactId": contactID, "opportunityId": oppID})
	if _, e = salesInsert(ctx, tx, table("lead_conversion"), map[string]any{"lead_id": lead["id"], "customer_id": customer["id"], "contact_id": contactID, "opportunity_id": oppID, "converted_by": who.Actor, "idempotency_key": oid, "conversion_snapshot_json": string(snapshot)}); e != nil {
		return nil, e
	}
	current, e := salesRow(ctx, tx, table("opportunity"), "id=?", oppID)
	if e != nil {
		return nil, e
	}
	if e = salesTaskTx(ctx, tx, table("sales_task"), "opportunity", current, who, oid, ownerCheck); e != nil {
		return nil, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE "+table("lead")+" SET converted_at=UTC_TIMESTAMP(3) WHERE id=?", lead["id"]); e != nil {
		return nil, e
	}
	return map[string]any{"status": "converted", "converted_customer_id": customer["id"], "converted_opportunity_id": oppID}, nil
}
