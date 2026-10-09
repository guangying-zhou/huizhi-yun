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
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"time"
)

var ticketOps = map[string][2]string{
	"service-tickets-page": {"service_ticket", "view"}, "service-tickets-view": {"service_ticket", "view"},
	"service-tickets-create": {"service_ticket", "edit"}, "service-tickets-update": {"service_ticket", "edit"},
	"service-tickets-close": {"service_ticket", "close"}, "service-tickets-reopen": {"service_ticket", "reopen"},
	"service-ticket-dispatch": {"service_ticket", "edit"}, "service-ticket-dispatch-resume": {"service_ticket", "edit"}, "service-ticket-dispatch-view": {"service_ticket", "view"},
}

func IsTicketOperation(op string) bool { _, ok := ticketOps[op]; return ok }
func ticketError(status int, code string) error {
	return httperror.New(status, code, "工单操作未完成，请检查资料、服务额度和当前权限")
}

var ticketFields = map[string]int{"title": 200, "description": 10000, "ticket_type": 30, "priority": 20, "owner_user_id": 50, "handler_user_id": 50, "reported_by_contact": 100, "reported_by_phone": 50, "reported_by_email": 100}

func validateTicket(op string, i SalesInput) error {
	if !IsTicketOperation(op) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	page := op == "service-tickets-page"
	create := op == "service-tickets-create"
	if page || create {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	if page {
		fields = map[string]bool{"page": true, "pageSize": true, "search": true}
		for _, k := range []string{"page", "pageSize"} {
			n, ok := i.Payload[k].(float64)
			max := float64(1000000)
			if k == "pageSize" {
				max = 100
			}
			if !ok || n < 1 || n > max || n != float64(int64(n)) {
				return salesInvalid()
			}
		}
	} else if op == "service-tickets-view" || op == "service-ticket-dispatch-view" {
		if len(i.Payload) != 0 {
			return salesInvalid()
		}
	} else {
		if !create {
			fields["expectedVersion"] = true
			n, ok := i.Payload["expectedVersion"].(float64)
			if !ok || n < 1 || n != float64(int64(n)) || n > 4294967295 {
				return salesInvalid()
			}
		}
		switch op {
		case "service-tickets-create", "service-tickets-update":
			for k, m := range ticketFields {
				fields[k] = true
				if v, ok := i.Payload[k]; ok && !stringValue(v, m, k != "title" && k != "owner_user_id") {
					return salesInvalid()
				}
			}
			if create {
				fields["service_agreement_id"] = true
				if !validCustomerID(salesText(i.Payload, "service_agreement_id")) || !stringValue(i.Payload["title"], 200, false) || !stringValue(i.Payload["ticket_type"], 30, false) {
					return salesInvalid()
				}
			}
			if v, ok := i.Payload["priority"]; ok && !containsSalesSupport([]string{"low", "normal", "high", "urgent"}, fmt.Sprint(v)) {
				return salesInvalid()
			}
			if v, ok := i.Payload["ticket_type"]; ok && !containsSalesSupport([]string{"incident", "consulting", "requirement", "change"}, fmt.Sprint(v)) {
				return salesInvalid()
			}
		case "service-ticket-dispatch":
			fields["project_code"] = true
			fields["estimated_hours"] = true
			if v, ok := i.Payload["project_code"]; ok && !stringValue(v, 64, true) {
				return salesInvalid()
			}
			if v, ok := i.Payload["estimated_hours"]; ok && (!validMoney(v) || len(strings.Split(fmt.Sprint(v), ".")[0]) > 8) {
				return salesInvalid()
			}
		case "service-tickets-close", "service-tickets-reopen":
			fields["reason"] = true
			if !stringValue(i.Payload["reason"], 500, false) {
				return salesInvalid()
			}
		}
	}
	for k, v := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
		if v != nil {
			switch v.(type) {
			case string, float64, bool:
			default:
				return salesInvalid()
			}
		}
	}
	if v, ok := i.Payload["search"]; ok && !stringValue(v, 200, true) {
		return salesInvalid()
	}
	return nil
}
func (s *Service) Tickets(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = ticketError(409, "service_ticket_write_conflict")
		}
	}()
	if e := validateTicket(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, ticketError(403, "service_ticket_identity_invalid")
	}
	if !domaininstall.IsAltocTicketsDomain(s.binding.Domains["altoc"]) {
		return nil, ticketError(503, "altoc_tickets_not_installed")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	read := ticketOps[op][1] == "view"
	mode := enterprise.Write
	if read {
		mode = enterprise.Read
	} else if who.Key == "" {
		return nil, salesInvalid()
	}
	req, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	reqs := []enterprise.ResolveRequest{req}
	dispatch := op == "service-ticket-dispatch" || op == "service-ticket-dispatch-resume"
	if dispatch {
		q, e := s.request("aims", enterprise.Write)
		if e != nil {
			return nil, e
		}
		reqs = append(reqs, q)
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if read {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, reqs...)
	} else {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, reqs...)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	if read {
		w, args, e := scopeSQL("altoc", who.Actor, scope)
		if e != nil {
			return nil, e
		}
		where := strings.ReplaceAll(strings.ReplaceAll(w, "owner_uid", "t.owner_user_id"), "owner_dept_code", "c.owner_dept_code")
		cw := strings.ReplaceAll(strings.ReplaceAll(w, "owner_uid", "c.owner_uid"), "owner_dept_code", "c.owner_dept_code")
		ca := append([]any(nil), args...)
		where = "t.deleted_at IS NULL AND (" + where + ") AND (" + cw + ")"
		args = append(args, ca...)
		from := table("service_ticket") + " t JOIN " + table("customer") + " c ON c.id=t.customer_id AND c.deleted_at IS NULL"
		if i.ID != "" {
			where += " AND t.id=?"
			args = append(args, i.ID)
			rows, e := queryRows(ctx, tx, "SELECT t.* FROM "+from+" WHERE "+where, args...)
			if e != nil {
				return nil, e
			}
			if len(rows) != 1 {
				return nil, ticketError(403, "service_ticket_scope_denied")
			}
			if e = tx.Commit(); e != nil {
				return nil, e
			}
			return rows[0], nil
		}
		if search := salesText(i.Payload, "search"); search != "" {
			where += " AND (t.title LIKE ? OR t.code LIKE ?)"
			args = append(args, "%"+search+"%", "%"+search+"%")
		}
		var total int64
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		page, size := int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))
		rows, e := queryRows(ctx, tx, "SELECT t.* FROM "+from+" WHERE "+where+" ORDER BY t.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"items": rows, "total": total}, nil
	}
	agreementID := salesText(i.Payload, "service_agreement_id")
	if i.ID != "" {
		if e = tx.QueryRowContext(ctx, "SELECT service_agreement_id FROM "+table("service_ticket")+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&agreementID); e == sql.ErrNoRows {
			return nil, ticketError(404, "service_ticket_not_found")
		}
		if e != nil {
			return nil, e
		}
	}
	var customerID, contractID string
	if e = tx.QueryRowContext(ctx, "SELECT c.customer_id,a.contract_id FROM "+table("service_agreement")+" a JOIN "+table("contract")+" c ON c.id=a.contract_id AND c.deleted_at IS NULL WHERE a.id=? AND a.deleted_at IS NULL", agreementID).Scan(&customerID, &contractID); e != nil {
		if e == sql.ErrNoRows {
			return nil, ticketError(409, "service_agreement_missing")
		}
		return nil, e
	}
	customer, e := salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", customerID)
	if e != nil {
		return nil, e
	}
	if e = salesScope(scope, who.Actor, customer); e != nil {
		return nil, e
	}
	contract, e := salesRow(ctx, tx, table("contract"), "id=? AND customer_id=? AND deleted_at IS NULL", contractID, customerID)
	if e != nil {
		return nil, e
	}
	agreement, e := salesRow(ctx, tx, table("service_agreement"), "id=? AND contract_id=? AND deleted_at IS NULL", agreementID, contractID)
	if e != nil {
		return nil, e
	}
	var ticket map[string]any
	if i.ID != "" {
		ticket, e = salesRow(ctx, tx, table("service_ticket"), "id=? AND service_agreement_id=? AND customer_id=? AND deleted_at IS NULL", i.ID, agreementID, customerID)
		if e != nil {
			return nil, e
		}
		copy := map[string]any{"owner_uid": ticket["owner_user_id"], "owner_dept_code": customer["owner_dept_code"]}
		if e = salesScope(scope, who.Actor, copy); e != nil {
			return nil, e
		}
	} else if e = salesScope(scope, who.Actor, map[string]any{"owner_uid": firstTicketOwner(i.Payload, who.Actor), "owner_dept_code": customer["owner_dept_code"]}); e != nil {
		return nil, e
	}
	if proposed, ok := i.Payload["owner_user_id"]; ok {
		if e = salesScope(scope, who.Actor, map[string]any{"owner_uid": proposed, "owner_dept_code": customer["owner_dept_code"]}); e != nil {
			return nil, e
		}
	}
	project := ""
	var prepared *aims.LockedServiceDispatch
	if dispatch {
		project = salesText(i.Payload, "project_code")
		if ticket != nil && fmt.Sprint(ticket["aims_project_code"]) != "<nil>" && fmt.Sprint(ticket["aims_project_code"]) != "" {
			bound := fmt.Sprint(ticket["aims_project_code"])
			if project != "" && project != bound {
				return nil, ticketError(409, "service_ticket_binding_conflict")
			}
			project = bound
		}
		if project == "" {
			rows, e := queryRows(ctx, tx, "SELECT project_code FROM "+table("service_agreement_project_rel")+" WHERE service_agreement_id=? AND status='active' AND is_default=1 AND deleted_at IS NULL ORDER BY id FOR UPDATE", agreementID)
			if e != nil {
				return nil, e
			}
			if len(rows) != 1 {
				return nil, ticketError(409, "service_project_default_required")
			}
			project = fmt.Sprint(rows[0]["project_code"])
		}
		prepared, e = aims.PrepareServiceDispatchTx(ctx, tx, rs[1], who.Actor, project, fmt.Sprint(contract["code"]), fmt.Sprint(ticket["code"]))
		if e != nil {
			return nil, e
		}
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf16c|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
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
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf16c." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if ticket != nil && fmt.Sprint(ticket["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(ticketError(409, "service_ticket_version_conflict"))
		}
		fields := map[string]any{}
		id := i.ID
		for k, v := range i.Payload {
			if _, ok := ticketFields[k]; ok {
				if v == "" {
					v = nil
				}
				fields[k] = v
			}
		}
		terminal := ticket != nil && containsSalesSupport([]string{"resolved", "closed", "cancelled"}, fmt.Sprint(ticket["status"]))
		switch op {
		case "service-tickets-create":
			fields["code"] = salesCode("ST-", oid)
			fields["customer_id"] = customerID
			fields["contract_id"] = contractID
			fields["service_agreement_id"] = agreementID
			fields["service_agreement_code"] = agreement["code"]
			fields["owner_user_id"] = firstTicketOwner(i.Payload, who.Actor)
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			fields = altoc.EnterpriseServiceTicketSLA(fields, agreement, time.Now().UTC())
			id, e = salesInsert(ctx, tx, table("service_ticket"), fields)
		case "service-tickets-update":
			if terminal {
				return fail(ticketError(409, "service_ticket_terminal"))
			}
			e = salesUpdate(ctx, tx, table("service_ticket"), id, fields, who.Actor)
		case "service-tickets-close":
			if terminal && fmt.Sprint(ticket["status"]) != "resolved" {
				return fail(ticketError(409, "service_ticket_terminal"))
			}
			final := map[string]any{}
			for k, v := range ticket {
				final[k] = v
			}
			final["status"] = "closed"
			delta := altoc.EnterpriseTicketQuotaConsumption(final, agreement, map[string]any{})
			if delta > 0 {
				if _, e = tx.ExecContext(ctx, "UPDATE "+table("service_agreement")+" SET consumed_quota=consumed_quota+?,row_version=row_version+1 WHERE id=?", fmt.Sprintf("%.2f", delta), agreementID); e != nil {
					return fail(e)
				}
			}
			e = salesUpdate(ctx, tx, table("service_ticket"), id, map[string]any{"status": "closed", "closed_at": time.Now().UTC(), "quota_consumed": fmt.Sprintf("%.2f", altoc.EnterpriseTicketConsumedQuota(ticket)+delta)}, who.Actor)
		case "service-tickets-reopen":
			if !terminal {
				return fail(ticketError(409, "service_ticket_not_terminal"))
			}
			e = salesUpdate(ctx, tx, table("service_ticket"), id, map[string]any{"status": "open", "resolved_at": nil, "closed_at": nil}, who.Actor)
		case "service-ticket-dispatch", "service-ticket-dispatch-resume":
			if terminal {
				return fail(ticketError(409, "service_ticket_terminal"))
			}
			if e = altoc.CheckEnterpriseDispatchQuota(ticket, agreement, salesText(i.Payload, "estimated_hours"), time.Now().UTC()); e != nil {
				return fail(e)
			}
			result, err := aims.ApplyServiceDispatchTx(ctx, tx, prepared, aims.ServiceDispatchCommand{Title: fmt.Sprint(ticket["title"]), Description: ticketText(ticket, "description"), Type: fmt.Sprint(ticket["ticket_type"]), Priority: fmt.Sprint(ticket["priority"]), Actor: who.Actor, Handler: ticketText(ticket, "handler_user_id"), CustomerCode: fmt.Sprint(customer["code"]), EstimatedHours: salesText(i.Payload, "estimated_hours")})
			if err != nil {
				return fail(err)
			}
			e = salesUpdate(ctx, tx, table("service_ticket"), id, map[string]any{"aims_project_code": project, "project_code": project, "aims_work_item_key": result.ItemKey, "aims_work_item_type": result.Type, "aims_dispatch_status": "succeeded", "aims_dispatch_operation_key": "altoc:ticket:" + fmt.Sprint(ticket["code"]) + ":dispatch:v1", "status": "accepted"}, who.Actor)
		}
		if e != nil {
			return fail(e)
		}
		snapshot, _ := json.Marshal(map[string]any{"id": id, "operation": op, "reason": i.Payload["reason"]})
		auditTable, _ := r.Table("altoc_audit_log")
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+auditTable+" (entity_type,entity_id,action,operator_uid,request_id,new_value) VALUES (?,?,?,?,?,?)", "service_ticket", id, op, who.Actor, who.RequestID, string(snapshot)); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "service_ticket", TargetBizCode: id, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, ticketError(409, "service_ticket_idempotency_conflict")
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"id": result.TargetBizCode}, nil
}
func ticketText(m map[string]any, k string) string {
	if m[k] == nil {
		return ""
	}
	return fmt.Sprint(m[k])
}
func firstTicketOwner(m map[string]any, actor string) string {
	if v := salesText(m, "owner_user_id"); v != "" {
		return v
	}
	return actor
}
