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
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type SalesInput struct {
	ID      string         `json:"id"`
	Payload map[string]any `json:"payload"`
}

var salesOps = map[string][2]string{
	"leads-create": {"lead", "edit"}, "leads-update": {"lead", "edit"}, "leads-assign": {"lead", "assign"}, "leads-disqualify": {"lead", "disqualify"}, "leads-convert": {"lead", "convert"}, "lead-activities-create": {"lead", "activity"},
	"opportunities-create": {"opportunity", "edit"}, "opportunities-update": {"opportunity", "edit"}, "opportunities-assign": {"opportunity", "assign"}, "opportunities-transition": {"opportunity", "transition"}, "opportunities-close-won": {"opportunity", "transition"}, "opportunities-close-lost": {"opportunity", "transition"}, "opportunities-pause": {"opportunity", "transition"}, "opportunities-reopen": {"opportunity", "transition"}, "opportunity-activities-create": {"opportunity", "activity"},
}

func SalesPermission(op string) (string, string, bool) {
	if p, ok := receivableOps[op]; ok {
		return p[0], p[1], true
	}
	p, ok := serviceSummaryOps[op]
	if !ok {
		p, ok = feedbackOps[op]
	}
	if !ok {
		p, ok = knowledgeOps[op]
	}
	if !ok {
		p, ok = salesOps[op]
	}
	if !ok {
		p, ok = salesSupportOps[op]
		if !ok {
			p, ok = tenderOps[op]
			if !ok {
				p, ok = serviceAgreementOps[op]
				if !ok {
					p, ok = ticketOps[op]
					if !ok {
						p, ok = renewalOps[op]
					}
				}
			}
		}
	}
	return p[0], p[1], ok
}
func SalesIntent(i SalesInput) []any {
	keys := []string{}
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := []any{}
	for _, k := range keys {
		pairs = append(pairs, []any{k, i.Payload[k]})
	}
	return []any{i.ID, pairs}
}
func salesInvalid() error {
	return httperror.New(400, "altoc_sales_input_invalid", "请检查必填项、日期与金额")
}

var salesLeadFields = map[string]int{"name": 200, "org_name": 200, "source_type": 50, "source_detail": 200, "need_summary": 1000, "project_type": 30, "budget_status": 30, "procurement_mode": 50, "source_evidence_url": 500, "contact_name": 50, "contact_mobile": 30, "contact_email": 100, "remark": 500, "next_action": 500}
var salesOpportunityFields = map[string]int{"name": 200, "source_type": 50, "source_detail": 500, "forecast_category": 20, "currency_code": 10, "next_action": 500, "risk_level": 20, "risk_reason": 500, "competitor_info": 500, "remark": 1000}

func salesFields(op string) map[string]int {
	r, a, _ := SalesPermission(op)
	fields := map[string]int{}
	if a == "edit" {
		src := salesLeadFields
		if r == "opportunity" {
			src = salesOpportunityFields
		}
		for k, v := range src {
			fields[k] = v
		}
	}
	if strings.HasSuffix(op, "-create") && !strings.Contains(op, "activities") || a == "assign" {
		fields["owner_uid"] = 50
		fields["owner_dept_code"] = 50
	}
	if a == "activity" {
		fields["activity_type"] = 20
		fields["subject"] = 200
		fields["content"] = 10000
		fields["result_summary"] = 500
		fields["next_action"] = 500
	}
	if a == "disqualify" {
		fields["invalid_reason_code"] = 50
		fields["invalid_reason"] = 500
	}
	if a == "transition" {
		for k, v := range salesOpportunityFields {
			fields[k] = v
		}
		delete(fields, "name")
		for _, x := range []string{"won", "lost", "pause"} {
			fields[x+"_reason_code"] = 50
			fields[x+"_reason"] = 500
		}
		fields["change_reason"] = 500
	}
	if a == "convert" {
		fields["customer_name"] = 200
		fields["opportunity_name"] = 200
		fields["contact_name"] = 50
		fields["contact_mobile"] = 30
		fields["contact_email"] = 100
		fields["owner_uid"] = 50
		fields["owner_dept_code"] = 50
	}
	return fields
}
func ValidateSalesInput(op string, i SalesInput) error {
	if IsReceivableOperation(op) {
		return validateReceivable(op, i)
	}
	if IsServiceSummary(op) {
		return validateServiceSummary(op, i)
	}
	if IsFeedbackOperation(op) {
		return validateFeedback(op, i)
	}
	if IsKnowledgeOperation(op) {
		return validateKnowledge(op, i)
	}
	if IsRenewalOperation(op) {
		return validateRenewal(op, i)
	}
	if IsTicketOperation(op) {
		return validateTicket(op, i)
	}
	if IsServiceAgreementOperation(op) {
		return validateServiceAgreement(op, i)
	}
	if IsTenderOperation(op) {
		return validateTender(op, i)
	}
	if IsSalesSupport(op) {
		return validateSalesSupport(op, i)
	}
	r, a, ok := SalesPermission(op)
	if !ok {
		return salesInvalid()
	}
	create := op == "leads-create" || op == "opportunities-create"
	if create {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := salesFields(op)
	for k, v := range i.Payload {
		if k == "expectedVersion" && !create {
			n, ok := v.(float64)
			if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) {
				return salesInvalid()
			}
			continue
		}
		if n, ok := fields[k]; ok {
			if !stringValue(v, n, k != "name" && k != "owner_uid") {
				return salesInvalid()
			}
			continue
		}
		if (k == "customerId" || k == "contactId") && (op == "opportunities-create" || a == "convert") || k == "stageId" && (op == "opportunities-create" || a == "convert" || op == "opportunities-transition" || op == "opportunities-reopen") {
			if !validCustomerID(fmt.Sprint(v)) {
				return salesInvalid()
			}
			continue
		}
		dates := map[string]bool{"expected_procurement_date": true, "expected_sign_date": true, "expected_payment_date": true}
		datetimes := map[string]bool{"next_action_due_at": true, "activity_at": true}
		if dates[k] && ((r == "lead" && k == "expected_procurement_date" && a == "edit") || (r == "opportunity" && k != "expected_procurement_date" && (a == "edit" || a == "transition"))) {
			if v != nil && !dateValid(fmt.Sprint(v)) {
				return salesInvalid()
			}
			continue
		}
		if datetimes[k] && (a == "edit" || a == "transition" || a == "activity") {
			if v != nil {
				if _, e := time.Parse("2006-01-02 15:04:05", fmt.Sprint(v)); e != nil {
					return salesInvalid()
				}
			}
			continue
		}
		if k == "estimated_budget" && r == "lead" && a == "edit" || k == "amount_tax_inclusive" && r == "opportunity" && (a == "edit" || a == "transition") {
			if v != nil {
				if _, ok := v.(string); !ok || !regexp.MustCompile(`^(0|[1-9]\d{0,13})(\.\d{1,2})?$`).MatchString(fmt.Sprint(v)) {
					return salesInvalid()
				}
			}
			continue
		}
		if k == "ack_similar_opportunity" && a == "convert" {
			if _, ok := v.(bool); !ok {
				return salesInvalid()
			}
			continue
		}
		return salesInvalid()
	}
	if !create {
		if _, ok := i.Payload["expectedVersion"]; !ok {
			return salesInvalid()
		}
	}
	if create {
		if !stringValue(i.Payload["name"], 200, false) || !stringValue(i.Payload["owner_uid"], 64, false) {
			return salesInvalid()
		}
		if r == "opportunity" && !validCustomerID(fmt.Sprint(i.Payload["customerId"])) {
			return salesInvalid()
		}
	}
	if a == "assign" && !stringValue(i.Payload["owner_uid"], 64, false) {
		return salesInvalid()
	}
	if a == "activity" && (!stringValue(i.Payload["subject"], 200, false) || !stringValue(i.Payload["activity_type"], 30, false) || i.Payload["activity_at"] == nil) {
		return salesInvalid()
	}
	if a == "disqualify" && (!stringValue(i.Payload["invalid_reason_code"], 50, false) || !stringValue(i.Payload["invalid_reason"], 500, false)) {
		return salesInvalid()
	}
	if (op == "opportunities-transition" || op == "opportunities-reopen") && !validCustomerID(fmt.Sprint(i.Payload["stageId"])) {
		return salesInvalid()
	}
	if a == "edit" && !create && len(i.Payload) < 2 {
		return salesInvalid()
	}
	return nil
}
func salesRow(ctx context.Context, tx *sql.Tx, table string, where string, args ...any) (map[string]any, error) {
	rows, e := tx.QueryContext(ctx, "SELECT * FROM "+table+" WHERE "+where+" LIMIT 1 FOR UPDATE", args...)
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
	if len(values) == 0 {
		return nil, httperror.New(404, "altoc_sales_not_found", "业务对象不存在")
	}
	return values[0], nil
}
func salesInsert(ctx context.Context, tx *sql.Tx, table string, fields map[string]any) (string, error) {
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	quoted, values := []string{}, []any{}
	for _, k := range keys {
		quoted = append(quoted, "`"+k+"`")
		values = append(values, fields[k])
	}
	result, e := tx.ExecContext(ctx, "INSERT INTO "+table+" ("+strings.Join(quoted, ",")+") VALUES ("+strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")+")", values...)
	if e != nil {
		return "", e
	}
	id, e := result.LastInsertId()
	return strconv.FormatInt(id, 10), e
}
func salesUpdate(ctx context.Context, tx *sql.Tx, table, id string, fields map[string]any, actor string) error {
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	sets, values := []string{}, []any{}
	for _, k := range keys {
		sets = append(sets, "`"+k+"`=?")
		values = append(values, fields[k])
	}
	sets = append(sets, "row_version=row_version+1", "updated_by=?")
	values = append(values, actor, id)
	_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE id=?", values...)
	return e
}
func salesText(row map[string]any, k string) string {
	v := row[k]
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func salesScope(scope altoc.BasicReadScope, actor string, row map[string]any) error {
	if !altocScopeAllows(scope, actor, salesText(row, "owner_uid"), salesText(row, "owner_dept_code")) {
		return httperror.New(403, "altoc_sales_scope_denied", "业务对象不在授权范围内")
	}
	return nil
}
func salesCode(prefix, oid string) string { return prefix + strings.ReplaceAll(oid, "-", "")[:26] }

// Sales owns all mutations in one caller transaction. The canonical stage gate
// serializes sales writers before customer/contact/lead/opportunity row locks;
// no generation-lock upgrade and no network call is made in this transaction.
func (s *Service) Sales(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	if IsReceivableOperation(op) {
		return s.Receivables(ctx, op, i, who, scope)
	}
	if IsRenewalOperation(op) {
		return s.Renewals(ctx, op, i, who, scope)
	}
	if IsTicketOperation(op) {
		return s.Tickets(ctx, op, i, who, scope)
	}
	if IsServiceAgreementOperation(op) {
		return s.ServiceAgreements(ctx, op, i, who, scope)
	}
	if IsTenderOperation(op) {
		return s.Tenders(ctx, op, i, who, scope)
	}
	if IsSalesSupport(op) {
		return nil, salesInvalid()
	} // support routes require their narrow Codocs dependency

	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = httperror.New(409, "altoc_sales_write_conflict", "资料已变化，请刷新后重试")
		}
	}()
	if e := ValidateSalesInput(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment || who.Key == "" {
		return nil, httperror.New(403, "altoc_sales_identity_invalid", "Verified actor required")
	}
	if !domaininstall.IsAltocSalesDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "altoc_sales_not_installed", "销售主链尚未安装")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	ownerCheck, e := s.prepareSalesOwnerCheck(ctx, op, i, who, scope)
	if e != nil {
		return nil, e
	}
	req, e := s.request("altoc", enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := resolved[0]
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	stageGate, e := salesRow(ctx, tx, table("opportunity_stage"), "1=1 ORDER BY id")
	if e != nil {
		if httperrorStatus(e) == 404 {
			return nil, httperror.New(503, "altoc_sales_stage_unavailable", "销售管道尚未配置")
		}
		return nil, e
	}
	_ = stageGate
	resource, _, _ := SalesPermission(op)
	targetTable := table(resource)
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf07|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	create := op == "leads-create" || op == "opportunities-create"
	code := salesCode("LE-", oid)
	if resource == "opportunity" {
		code = salesCode("OP-", oid)
	}
	var row map[string]any
	if create {
		row = map[string]any{"owner_uid": i.Payload["owner_uid"], "owner_dept_code": i.Payload["owner_dept_code"]}
		if e = salesScope(scope, who.Actor, row); e != nil {
			return nil, e
		}
		existing, er := salesRow(ctx, tx, targetTable, "BINARY code=BINARY ?", code)
		if er == nil {
			if existing["deleted_at"] != nil {
				return nil, httperror.New(403, "altoc_sales_scope_denied", "业务对象已不可用")
			}
			row = existing
			if e = salesScope(scope, who.Actor, row); e != nil {
				return nil, e
			}
		} else if httperrorStatus(er) != 404 {
			return nil, er
		}
	} else {
		row, e = salesRow(ctx, tx, targetTable, "id=? AND deleted_at IS NULL", i.ID)
		if e != nil {
			return nil, e
		}
		code = salesText(row, "code")
		if e = salesScope(scope, who.Actor, row); e != nil {
			return nil, e
		}
	}
	if op == "leads-convert" && salesText(row, "status") == "converted" {
		conversion, er := salesRow(ctx, tx, table("lead_conversion"), "lead_id=? AND BINARY idempotency_key=BINARY ?", row["id"], oid)
		if er != nil {
			return nil, er
		}
		if conversion["contact_id"] != nil {
			_, er = salesRow(ctx, tx, table("contact"), "id=? AND customer_id=? AND deleted_at IS NULL", conversion["contact_id"], row["converted_customer_id"])
			if er != nil {
				return nil, er
			}
		}
	}
	// Target facts are also checked before receipt replay. No new customer/owner
	// projection may be authorized merely by an old receipt.
	var customer, contact map[string]any
	customerID := salesText(i.Payload, "customerId")
	if op == "leads-convert" && salesText(row, "status") == "converted" {
		customerID = salesText(row, "converted_customer_id")
	}
	if customerID != "" {
		customer, e = salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", customerID)
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, customer); e != nil {
			return nil, e
		}
	}
	if contactID := salesText(i.Payload, "contactId"); contactID != "" {
		contact, e = salesRow(ctx, tx, table("contact"), "id=? AND customer_id=? AND deleted_at IS NULL", contactID, customerID)
		if e != nil {
			return nil, e
		}
		if customer == nil {
			return nil, salesInvalid()
		}
	}
	targetOwner := salesText(i.Payload, "owner_uid")
	if targetOwner == "" {
		targetOwner = salesText(row, "owner_uid")
	}
	targetDept := salesText(i.Payload, "owner_dept_code")
	if _, ok := i.Payload["owner_dept_code"]; !ok {
		targetDept = salesText(row, "owner_dept_code")
	}
	if e = salesScope(scope, who.Actor, map[string]any{"owner_uid": targetOwner, "owner_dept_code": targetDept}); e != nil {
		return nil, e
	}
	if op == "leads-convert" && salesText(row, "converted_opportunity_id") != "" {
		existing, e := salesRow(ctx, tx, table("opportunity"), "id=? AND deleted_at IS NULL", row["converted_opportunity_id"])
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, existing); e != nil {
			return nil, e
		}
	}
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
	receipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf07." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if !create && fmt.Sprint(row["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(httperror.New(409, "altoc_sales_version_conflict", "资料版本已变化"))
		}
		fields := map[string]any{}
		for k, v := range i.Payload {
			if k != "expectedVersion" && k != "customerId" && k != "contactId" && k != "stageId" && k != "ack_similar_opportunity" {
				fields[k] = v
			}
		}
		id := i.ID
		if create {
			if resource == "lead" {
				fields, e = altoc.EnterpriseLeadCreate(fields, who.Actor, code)
				if e != nil {
					return fail(e)
				}
			} else {
				stage, er := salesInitialStage(ctx, tx, table("opportunity_stage"), salesText(i.Payload, "stageId"))
				if er != nil {
					return fail(er)
				}
				fields["customer_id"] = customerID
				if er = altoc.EnterpriseOpportunityCreate(fields); er != nil {
					return fail(er)
				}
				fields["code"] = code
				fields["customer_id"] = customerID
				fields["stage_id"] = stage["id"]
				fields["win_rate"] = stage["win_rate"]
				fields["status"] = "active"
				fields["created_by"] = who.Actor
				fields["updated_by"] = who.Actor
			}
			id, e = salesInsert(ctx, tx, targetTable, fields)
			if e != nil {
				return fail(e)
			}
		} else {
			if resource == "lead" && (salesText(row, "status") == "converted" || salesText(row, "status") == "closed_invalid") {
				return fail(httperror.New(409, "altoc_lead_closed", "该线索已关闭"))
			}
			switch op {
			case "leads-convert":
				fields, e = s.convertSalesLeadTx(ctx, tx, r, row, i, who, scope, customer, contact, oid, ownerCheck)
				if e != nil {
					return fail(e)
				}
			case "opportunities-update":
				if e = altoc.EnterpriseOpportunityUpdate(row, fields); e != nil {
					return fail(e)
				}
			case "leads-disqualify":
				fields["status"] = "closed_invalid"
			case "lead-activities-create", "opportunity-activities-create":
				if resource == "opportunity" && salesText(row, "status") != "active" {
					return fail(httperror.New(409, "altoc_opportunity_closed", "关闭商机不能新增跟进"))
				}
				if e = ownerCheck(salesText(row, "owner_uid")); e != nil {
					return fail(e)
				}
				activity := map[string]any{}
				for k, v := range fields {
					activity[k] = v
				}
				activity["code"] = salesCode("AC-", oid)
				activity[resource+"_id"] = id
				activity["owner_uid"] = salesText(row, "owner_uid")
				activity["created_by"] = who.Actor
				activity["updated_by"] = who.Actor
				activity["status"] = "active"
				if _, e = salesInsert(ctx, tx, table("sales_activity"), activity); e != nil {
					return fail(e)
				}
				fields = map[string]any{"last_follow_up_at": i.Payload["activity_at"]}
				for _, k := range []string{"next_action", "next_action_due_at"} {
					if v, ok := i.Payload[k]; ok {
						fields[k] = v
					}
				}
			default:
				if resource == "opportunity" && strings.Contains(op, "opportunities-") && op != "opportunities-update" && op != "opportunities-assign" {
					fields, e = salesTransitionTx(ctx, tx, table, op, row, i.Payload, who)
					if e != nil {
						return fail(e)
					}
				}
			}
			if e = salesUpdate(ctx, tx, targetTable, id, fields, who.Actor); e != nil {
				return fail(e)
			}
		}
		current, e := salesRow(ctx, tx, targetTable, "id=?", id)
		if e != nil {
			return fail(e)
		}
		if e = salesTaskTx(ctx, tx, table("sales_task"), resource, current, who, oid, ownerCheck); e != nil {
			return fail(e)
		}
		snapshot, e := json.Marshal(map[string]any{"data": salesProjection(resource, current)})
		if e != nil {
			return fail(e)
		}
		audit, _ := r.Table("altoc_audit_log")
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES (?,?,?,'apf07-version',?,?,'user',?)", resource, id, code, string(snapshot), who.Actor, who.RequestID); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: resource, TargetBizCode: code + ":v" + fmt.Sprint(current["row_version"]), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_sales_idempotency_conflict", "同一操作键的内容已变化")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, salesInvalid()
	}
	audit, _ := r.Table("altoc_audit_log")
	var snapshot []byte
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE entity_type=? AND BINARY entity_code=BINARY ? AND action='apf07-version' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.data.row_version'))=?", resource, parts[0], parts[1]).Scan(&snapshot); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	var response any
	e = json.Unmarshal(snapshot, &response)
	return response, e
}
func httperrorStatus(e error) int {
	var h httperror.Error
	if errors.As(e, &h) {
		return h.Status
	}
	return 0
}
func salesProjection(resource string, row map[string]any) map[string]any {
	out := map[string]any{}
	cols := []string{"id", "code", "row_version", "status", "owner_uid", "owner_dept_code", "created_at", "updated_at"}
	if resource == "lead" {
		for k := range salesLeadFields {
			cols = append(cols, k)
		}
		cols = append(cols, "estimated_budget", "expected_procurement_date", "next_action_due_at", "converted_customer_id", "converted_opportunity_id", "score")
	} else {
		for k := range salesOpportunityFields {
			cols = append(cols, k)
		}
		cols = append(cols, "customer_id", "lead_id", "stage_id", "amount_tax_inclusive", "expected_sign_date", "expected_payment_date", "next_action_due_at", "win_rate", "won_reason_code", "won_reason", "lost_reason_code", "lost_reason", "pause_reason_code", "pause_reason")
	}
	for _, k := range cols {
		out[k] = row[k]
	}
	return out
}
