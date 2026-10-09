package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

// Same immutable request/receipt protocol as APF-12a; no new mutable schema.
type FrozenFinanceApproval struct {
	OperationID       string         `json:"operationId"`
	BindOperationID   string         `json:"bindOperationId"`
	ResultOperationID string         `json:"resultOperationId"`
	Resource          string         `json:"resource"`
	BizID             string         `json:"bizId"`
	Code              string         `json:"code"`
	Actor             string         `json:"actor"`
	Title             string         `json:"title"`
	RequestNo         string         `json:"requestNo"`
	Key               string         `json:"key"`
	ExpectedVersion   int64          `json:"expectedVersion"`
	SnapshotHash      string         `json:"snapshotHash"`
	Form              map[string]any `json:"formData"`
	Action            string         `json:"action,omitempty"`
}

func FinanceApprovalPermission(op string) (string, string, bool) {
	if op == "claims-submit" || op == "project-requests-submit" || op == "payment-requests-submit" {
		return "expenses", "edit", true
	}
	if op == "invoice-approval-request" || op == "invoice-approval-bind" || op == "invoice-requests-from-altoc" {
		return "invoices", "edit", true
	}
	return "", "", false
}
func ValidateFinanceApprovalInput(op string, i FinanceInput) error {
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" || i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if op == "invoice-requests-from-altoc" {
		return validateFinanceSourceInput(i)
	}
	_, _, registered := FinanceApprovalPermission(op)
	allowedCount := 1
	if op == "invoice-approval-request" || op == "claims-submit" || op == "project-requests-submit" || op == "payment-requests-submit" {
		if phase, ok := i.Payload["phase"]; ok {
			if phase != "recover" && (phase != "bind" || op == "invoice-approval-request") {
				return financeInvalid()
			}
			allowedCount = 2
		}
	}
	if !registered || !financeCode.MatchString(i.Code) || len(i.Payload) != allowedCount || ledgerVersion(i.Payload["expectedVersion"]) < 1 {
		return financeInvalid()
	}
	if n, ok := i.Payload["expectedVersion"].(float64); !ok || n != float64(int64(n)) || n > 9007199254740991 {
		return financeInvalid()
	}
	return nil
}
func (s *Service) ConfigureFinanceApprovalReader(r workflowapproval.FinanceReader) {
	s.financeApprovalReader = r
}
func (s *Service) financeApprovalTx(ctx context.Context, op enterprise.Operation) (*sql.Tx, enterprise.Resolved, error) {
	if !domaininstall.IsFinanceB3Domain(s.binding.Domains["finance"]) {
		return nil, enterprise.Resolved{}, ledgerError(503, "b3_unavailable")
	}
	req, err := s.request("finance", op)
	if err != nil {
		return nil, enterprise.Resolved{}, err
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	switch op {
	case enterprise.Write:
		ar, e := s.request("altoc", enterprise.Write)
		if e != nil {
			return nil, enterprise.Resolved{}, e
		}
		tx, rs, err = s.registry.BeginWriteTransaction(ctx, ar, req)
	case enterprise.Scheduler:
		tx, rs, err = s.registry.BeginSchedulerTransaction(ctx, req)
	default:
		tx, rs, err = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if err != nil {
		return nil, enterprise.Resolved{}, err
	}
	return tx, rs[len(rs)-1], nil
}
func financeFrozen(ctx context.Context, tx *sql.Tx, no, code, key string) (*FrozenFinanceApproval, error) {
	query := "SELECT new_value FROM finance_audit_log WHERE entity_type IN ('finance_invoice_request','finance_expense_claim','finance_project_expense_request','finance_payment_request') AND action='invoice-approval-request'"
	args := []any{}
	if no != "" {
		query += " AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.requestNo'))=?"
		args = append(args, no)
	} else {
		query += " AND BINARY entity_code=BINARY ? AND BINARY request_id=BINARY ?"
		args = append(args, code, key)
	}
	var raw []byte
	err := tx.QueryRowContext(ctx, query+" ORDER BY id DESC LIMIT 1", args...).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var f FrozenFinanceApproval
	if json.Unmarshal(raw, &f) != nil || !workflowapproval.FinanceRegistered("finance", f.Resource, financeApprovalAction(f)) || !financeCode.MatchString(f.BizID) || !strings.HasPrefix(f.RequestNo, "APF-FIN-") || len(f.Form) != 6 || f.ExpectedVersion < 1 {
		return nil, ledgerError(503, "approval_snapshot_invalid")
	}
	return &f, nil
}
func financeApprovalAudit(ctx context.Context, tx *sql.Tx, f FrozenFinanceApproval, action, key, actor, channel string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO finance_audit_log(entity_type,entity_code,action,new_value,operator_uid,channel,request_id) VALUES(?,?,?,?,?,?,?)", financeApprovalTable(f), f.BizID, action, string(raw), actor, channel, key)
	return err
}
func financeApprovalScope(row map[string]any, who Identity, scope altoc.BasicReadScope) bool {
	return (scope.Access == "all" || scope.Access == "self") && len(scope.DepartmentCodes) == 0 && (ledgerText(row["requested_by"]) == who.Actor || ledgerText(row["applicant_uid"]) == who.Actor)
}
func (s *Service) FinanceApproval(ctx context.Context, op string, i FinanceInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if err := ValidateFinanceApprovalInput(op, i); err != nil {
		return nil, err
	}
	if op == "invoice-requests-from-altoc" {
		return s.FinanceFromAltoc(ctx, i, who, scope)
	}
	if op == "payment-requests-submit" && !domaininstall.IsFinance13bDomain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "13b_unavailable")
	}
	if financeApprovalInputTable(op, i.Payload) != "finance_invoice_request" && !domaininstall.IsFinance13aDomain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "13a_unavailable")
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || who.Key == "" {
		return nil, ledgerError(403, "approval_identity_invalid")
	}
	if s.financeApprovalReader == nil {
		return nil, ledgerError(503, "workflow_unavailable")
	}
	var instance *workflowapproval.Instance
	if op == "invoice-approval-bind" || i.Payload["phase"] == "bind" {
		tx, _, err := s.financeApprovalTx(ctx, enterprise.Read)
		if err != nil {
			return nil, err
		}
		f, err := financeFrozen(ctx, tx, "", i.Code, who.Key)
		tx.Rollback()
		if err != nil {
			return nil, err
		}
		if f == nil || financeApprovalTable(*f) != financeApprovalInputTable(op, i.Payload) || f.Actor != who.Actor || f.ExpectedVersion != ledgerVersion(i.Payload["expectedVersion"]) {
			return nil, ledgerError(409, "approval_request_mismatch")
		}
		instance, err = s.financeApprovalReader.ReadFinanceApprovalInstance(ctx, f.BizID, f.RequestNo)
		if err != nil {
			return nil, err
		}
		if instance == nil {
			return nil, ledgerError(503, "approval_instance_pending")
		}
	}
	tx, r, err := s.financeApprovalTx(ctx, enterprise.Write)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	table, resource, action := financeApprovalBusiness(op, i.Payload)
	locked, err := financeApprovalBusinessLock(ctx, tx, table, i.Code, who, domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"]))
	row := locked[table]
	if err != nil {
		return nil, err
	}
	if !financeApprovalScope(row, who, scope) {
		return nil, ledgerError(403, "approval_scope_denied")
	}
	// Recover the server-frozen command for this locked row, never browser facts.
	if i.Payload["phase"] == "recover" {
		if err = ledgerVersionCheck(row, i.Payload["expectedVersion"]); err != nil {
			return nil, err
		}
		if row["status"] != "pending_approval" || ledgerText(row["workflow_instance_id"]) != "" {
			return nil, ledgerError(409, "approval_state_conflict")
		}
		var originalKey string
		err = tx.QueryRowContext(ctx, "SELECT request_id FROM finance_audit_log WHERE entity_type=? AND BINARY entity_code=BINARY ? AND action='invoice-approval-request' ORDER BY id DESC LIMIT 1", table, i.Code).Scan(&originalKey)
		if err == sql.ErrNoRows {
			return nil, ledgerError(409, "approval_request_mismatch")
		}
		if err != nil {
			return nil, err
		}
		f, e := financeFrozen(ctx, tx, "", i.Code, originalKey)
		if e != nil {
			return nil, e
		}
		if f == nil || financeApprovalTable(*f) != table || f.BizID != i.Code || f.Actor != who.Actor || f.Key != originalKey || f.ExpectedVersion+1 != ledgerVersion(row["row_version"]) {
			return nil, ledgerError(409, "approval_request_mismatch")
		}
		return f, tx.Commit()
	}
	f, err := financeFrozen(ctx, tx, "", i.Code, who.Key)
	if err != nil {
		return nil, err
	}
	if f != nil && (financeApprovalTable(*f) != table || f.Actor != who.Actor || f.ExpectedVersion != ledgerVersion(i.Payload["expectedVersion"])) {
		return nil, ledgerError(409, "approval_intent_changed")
	}
	if op == "invoice-approval-bind" || i.Payload["phase"] == "bind" {
		if f == nil {
			return nil, ledgerError(409, "approval_request_mismatch")
		}
		if err = matchFinanceApprovalInstance(*f, instance); err != nil {
			return nil, err
		}
		if err = financeApprovalReceipt(ctx, tx, r, *f, who, "bind", who.Key+":bind", map[string]any{"instanceId": instance.ID, "instanceNo": instance.No}, func() error { return financeBind(ctx, tx, r, *f, row, instance) }); err != nil {
			return nil, err
		}
		return map[string]any{"bound": true, "instanceId": instance.ID, "requestNo": f.RequestNo}, tx.Commit()
	}
	if f != nil {
		return f, tx.Commit()
	}
	if err = ledgerVersionCheck(row, i.Payload["expectedVersion"]); err != nil {
		return nil, err
	}
	if row["status"] != "draft" && row["status"] != "rejected" {
		return nil, ledgerError(409, "approval_state_conflict")
	}
	if c := locked["altoc_contract"]; c != nil && c["legal_status"] != "effective" {
		return nil, ledgerError(409, "source_contract_not_effective")
	}
	if bs := locked["altoc_billing_schedule"]; bs != nil {
		if bs["status"] != "billable" && bs["status"] != "invoicing" {
			return nil, ledgerError(409, "schedule_not_billable")
		}
		var used string
		if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(requested_amount),0) AS CHAR) FROM finance_invoice_request WHERE billing_schedule_code=? AND code<>? AND status NOT IN ('canceled','rejected') AND deleted_at IS NULL", bs["code"], i.Code).Scan(&used); e != nil {
			return nil, e
		}
		if new(big.Int).Add(moneyCents(used), moneyCents(ledgerText(row["requested_amount"]))).Cmp(moneyCents(ledgerText(bs["amount"]))) > 0 {
			return nil, ledgerError(409, "amount_exceeded")
		}
	}
	f = &FrozenFinanceApproval{OperationID: uuid.NewString(), BindOperationID: uuid.NewString(), ResultOperationID: uuid.NewString(), Resource: resource, Action: action, BizID: i.Code, Code: i.Code, Actor: who.Actor, Title: i.Code, Key: who.Key, ExpectedVersion: ledgerVersion(i.Payload["expectedVersion"]), SnapshotHash: approvalDigest(row), RequestNo: "APF-FIN-" + uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("%s|%s|%s|%s|%s|%d", who.Tenant, who.Deployment, i.Code, who.Actor, who.Key, ledgerVersion(i.Payload["expectedVersion"])))).String()}
	f.Form = map[string]any{"requestNo": f.RequestNo, "resource": resource, "bizId": i.Code, "requestedBy": who.Actor, "snapshotHash": f.SnapshotHash, "expectedVersion": strconv.FormatInt(f.ExpectedVersion, 10)}
	if err = financeApprovalReceipt(ctx, tx, r, *f, who, "request", who.Key, map[string]any{"code": i.Code, "version": f.ExpectedVersion, "actor": who.Actor}, func() error {
		if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET status='pending_approval',workflow_instance_id=NULL,submitted_at=UTC_TIMESTAMP(3),approved_at=NULL,rejected_at=NULL,reject_reason=NULL,row_version=row_version+1,updated_by=? WHERE code=?", who.Actor, i.Code); e != nil {
			return e
		}
		command, _ := json.Marshal(f)
		queue, _ := r.Table("integration_operation")
		if _, e := tx.ExecContext(ctx, "INSERT INTO "+queue+"(operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,next_attempt_at) VALUES(?,?,?,1,?,?,'finance','workflow','finance.approval.create.v1','workflow:proxy',?,?,?,'v1',?,?,'pending',?,?,?,?,?,UTC_TIMESTAMP(3))", f.OperationID, f.RequestNo, f.RequestNo, who.Tenant, who.Deployment, strings.TrimPrefix(table, "finance_"), i.Code, f.RequestNo, string(command), approvalDigest(f), who.RequestID, who.Actor, who.Client, who.Actor, who.Actor); e != nil {
			return e
		}
		return financeApprovalAudit(ctx, tx, *f, "invoice-approval-request", who.Key, who.Actor, "user", f)
	}); err != nil {
		return nil, err
	}
	return f, tx.Commit()
}
func matchFinanceApprovalInstance(f FrozenFinanceApproval, v *workflowapproval.Instance) error {
	if v == nil || v.Resource != f.Resource || v.Action != financeApprovalAction(f) || !positiveAltocID(v.ID) || v.No == "" || !workflowapproval.FinanceRegistered(v.App, v.Resource, v.Action) || v.BizID != f.BizID || v.Initiator != f.Actor || !workflowapproval.FinanceCallbackPath(v.CallbackPath) || approvalDigest(v.Form) != approvalDigest(f.Form) {
		return ledgerError(409, "approval_instance_mismatch")
	}
	return nil
}
func financeSettle(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenFinanceApproval) error {
	queue, _ := r.Table("integration_operation")
	_, err := tx.ExecContext(ctx, "UPDATE "+queue+" SET status='succeeded',version_no=version_no+1,updated_by='enterprise.runtime' WHERE operation_key=? AND operation_code='finance.approval.create.v1' AND status='pending'", f.RequestNo)
	return err
}
func financeBind(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenFinanceApproval, row map[string]any, v *workflowapproval.Instance) error {
	if ledgerText(row["workflow_instance_id"]) == v.ID {
		return financeSettle(ctx, tx, r, f)
	}
	if ledgerText(row["workflow_instance_id"]) != "" || row["status"] != "pending_approval" || ledgerVersion(row["row_version"]) != f.ExpectedVersion+1 {
		return ledgerError(409, "approval_round_changed")
	}
	if _, err := tx.ExecContext(ctx, "UPDATE "+financeApprovalTable(f)+" SET workflow_instance_id=?,row_version=row_version+1 WHERE code=?", v.ID, f.BizID); err != nil {
		return err
	}
	if err := financeSettle(ctx, tx, r, f); err != nil {
		return err
	}
	return financeApprovalAudit(ctx, tx, f, "invoice-approval-bind", f.Key, f.Actor, "system", map[string]any{"requestNo": f.RequestNo, "instanceId": v.ID, "instanceNo": v.No})
}
func financeApprovalReceipt(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenFinanceApproval, who Identity, action, key string, command any, apply func() error) error {
	table, _ := r.Table("service_command_receipt")
	repo, err := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(table))
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(command)
	oid := f.OperationID
	capability := "finance:enterprise-host:execute"
	if action == "bind" {
		oid = f.BindOperationID
	}
	if action == "callback" {
		oid = f.ResultOperationID
		capability = "finance:scheduler:execute"
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.approval." + action + ".v1", RequiredCapability: capability, IdempotencyKey: key, CommandSchemaVersion: "v1", CommandSHA256: approvalDigest(command), Command: raw, OriginalActorUID: who.Actor}
	_, err = repo.ExecuteInTransaction(ctx, tx, in, func(context.Context, *sql.Tx, json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if e := apply(); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: strings.TrimPrefix(financeApprovalTable(f), "finance_"), TargetBizCode: f.RequestNo, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(command)}, nil
	})
	return err
}
func (s *Service) PendingFinanceApprovals(ctx context.Context) ([]FrozenFinanceApproval, error) {
	tx, r, err := s.financeApprovalTx(ctx, enterprise.Scheduler)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	queue, _ := r.Table("integration_operation")
	parts := []string{}
	for _, table := range []string{"finance_invoice_request", "finance_expense_claim", "finance_project_expense_request", "finance_payment_request"} {
		if table == "finance_payment_request" && !domaininstall.IsFinance13bDomain(s.binding.Domains["finance"]) {
			continue
		}
		if table != "finance_invoice_request" && !domaininstall.IsFinance13aDomain(s.binding.Domains["finance"]) {
			continue
		}
		parts = append(parts, "SELECT a.id,a.new_value FROM finance_audit_log a JOIN "+table+" b ON b.code=a.entity_code JOIN "+queue+" o ON o.operation_key=JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.requestNo')) AND o.operation_code='finance.approval.create.v1' AND o.status='pending' WHERE a.entity_type='"+table+"' AND a.action='invoice-approval-request' AND b.status='pending_approval' AND b.workflow_instance_id IS NULL AND b.row_version=CAST(JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.expectedVersion')) AS UNSIGNED)+1")
	}
	rows, err := queryRows(ctx, tx, "SELECT new_value FROM ("+strings.Join(parts, " UNION ALL ")+") pending ORDER BY id LIMIT 40")
	if err != nil {
		return nil, err
	}
	out := []FrozenFinanceApproval{}
	for _, row := range rows {
		var f FrozenFinanceApproval
		if json.Unmarshal([]byte(ledgerText(row["new_value"])), &f) != nil {
			return nil, ledgerError(503, "approval_snapshot_invalid")
		}
		out = append(out, f)
	}
	return out, tx.Commit()
}
func (s *Service) BindFinanceApprovalSystem(ctx context.Context, no string) (any, error) {
	tx, _, err := s.financeApprovalTx(ctx, enterprise.Scheduler)
	if err != nil {
		return nil, err
	}
	f, err := financeFrozen(ctx, tx, no, "", "")
	tx.Rollback()
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, ledgerError(409, "approval_request_mismatch")
	}
	payload := map[string]any{"expectedVersion": float64(f.ExpectedVersion)}
	if f.Resource == "expenses" {
		payload["phase"] = "bind"
	}
	op := "invoice-approval-bind"
	if f.Action == "claim" {
		op = "claims-submit"
	}
	if f.Action == "payment" {
		op = "payment-requests-submit"
	}
	if f.Action == "project_expense" {
		op = "project-requests-submit"
	}
	return s.FinanceApproval(ctx, op, FinanceInput{Code: f.BizID, Payload: payload}, Identity{Actor: f.Actor, Key: f.Key, Tenant: s.binding.Key.Tenant, Deployment: s.binding.Domains["finance"].OwnerDeployment, Client: "enterprise.runtime"}, altoc.BasicReadScope{Access: "self"})
}
func (s *Service) FinanceApprovalCallback(ctx context.Context, body map[string]any, who Identity) (any, error) {
	if who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment {
		return nil, ledgerError(403, "approval_identity_invalid")
	}
	allowed := map[string]bool{}
	for _, k := range strings.Fields("event instance_id instance_no app_code resource_code action_code biz_id status completed_at initiator_uid form_data approval_actor_uids non_self_approval_actor_uids approval_operator_uid idempotencyKey") {
		allowed[k] = true
	}
	for k := range body {
		if !allowed[k] {
			return nil, financeInvalid()
		}
	}
	if !workflowapproval.FinanceRegistered(ledgerText(body["app_code"]), ledgerText(body["resource_code"]), ledgerText(body["action_code"])) || body["event"] != "flow_completed" {
		return nil, ledgerError(403, "approval_business_invalid")
	}
	form, ok := body["form_data"].(map[string]any)
	if !ok {
		return nil, financeInvalid()
	}
	tx, _, err := s.financeApprovalTx(ctx, enterprise.Read)
	if err != nil {
		return nil, err
	}
	f, err := financeFrozen(ctx, tx, ledgerText(form["requestNo"]), "", "")
	tx.Rollback()
	if err != nil {
		return nil, err
	}
	if f == nil || body["resource_code"] != f.Resource || body["action_code"] != financeApprovalAction(*f) {
		return nil, ledgerError(409, "approval_request_mismatch")
	}
	if s.financeApprovalReader == nil {
		return nil, ledgerError(503, "workflow_unavailable")
	}
	v, err := s.financeApprovalReader.ReadFinanceApprovalInstance(ctx, f.BizID, f.RequestNo)
	if err != nil {
		return nil, err
	}
	if err = matchFinanceApprovalInstance(*f, v); err != nil {
		return nil, err
	}
	key := "workflow:callback:" + v.ID + ":flow_completed:" + v.Status
	nonSelf := false
	for _, actor := range v.NonSelf {
		if actor == v.Operator && actor != f.Actor && actor != "" {
			nonSelf = true
		}
	}
	if (v.Status != "approved" && v.Status != "rejected") || !nonSelf || v.Operator == "" || v.Operator == f.Actor || ledgerText(body["instance_id"]) != v.ID || body["instance_no"] != v.No || body["biz_id"] != v.BizID || body["initiator_uid"] != v.Initiator || body["status"] != v.Status || body["approval_operator_uid"] != v.Operator || body["idempotencyKey"] != key || approvalDigest(form) != approvalDigest(f.Form) {
		return nil, ledgerError(409, "approval_evidence_invalid")
	}
	tx, r, err := s.financeApprovalTx(ctx, enterprise.Write)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	table := financeApprovalTable(*f)
	locked, err := financeApprovalBusinessLock(ctx, tx, table, f.BizID, who, domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"]))
	row := locked[table]
	if err != nil {
		return nil, err
	}
	result := map[string]any{"requestNo": f.RequestNo, "instanceId": v.ID, "status": v.Status, "operator": v.Operator}
	var raw []byte
	err = tx.QueryRowContext(ctx, "SELECT new_value FROM finance_audit_log WHERE entity_type=? AND entity_code=? AND action='invoice-approval-result' AND BINARY request_id=BINARY ? ORDER BY id DESC LIMIT 1", table, f.BizID, key).Scan(&raw)
	if err == nil {
		var old any
		if json.Unmarshal(raw, &old) != nil || approvalDigest(old) != approvalDigest(result) {
			return nil, ledgerError(409, "approval_callback_conflict")
		}
		return result, tx.Commit()
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	bound := ledgerText(row["workflow_instance_id"])
	expected := f.ExpectedVersion + 1
	if bound != "" {
		expected++
	}
	if row["status"] != "pending_approval" || ledgerVersion(row["row_version"]) != expected || bound != "" && bound != v.ID {
		return nil, ledgerError(409, "approval_round_changed")
	}
	who.Actor = v.Operator
	err = financeApprovalReceipt(ctx, tx, r, *f, who, "callback", key, result, func() error {
		approved, rejected := "NULL", "NULL"
		amount := ""
		if table != "finance_invoice_request" && v.Status == "approved" {
			amount = ",approved_amount=total_amount"
			if table == "finance_payment_request" {
				amount = ",approved_amount=requested_amount"
			}
		}
		if v.Status == "approved" {
			approved = "UTC_TIMESTAMP(3)"
		} else {
			rejected = "UTC_TIMESTAMP(3)"
		}
		if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET status=?,workflow_instance_id=?,approved_at="+approved+",rejected_at="+rejected+amount+",row_version=row_version+1,updated_by=? WHERE code=?", v.Status, v.ID, v.Operator, f.BizID); e != nil {
			return e
		}
		if e := financeSettle(ctx, tx, r, *f); e != nil {
			return e
		}
		return financeApprovalAudit(ctx, tx, *f, "invoice-approval-result", key, v.Operator, "system", result)
	})
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

// Scope is checked by FinanceApproval on the freshly locked row. The all value
// here selects the canonical locking primitive only; it is not an authorization
// decision, and no mutation occurs until applicant/evidence checks succeed.
func financeApprovalLock(ctx context.Context, tx *sql.Tx, code string, who Identity, continuation ...bool) (map[string]map[string]any, error) {
	return ledgerLock(ctx, tx, financeLedgerOps["invoice-requests-update"], FinanceInput{Code: code, Payload: map[string]any{}}, who, altoc.BasicReadScope{Access: "all"}, continuation...)
}

func financeApprovalAction(f FrozenFinanceApproval) string {
	if f.Resource == "invoices" {
		return "request"
	}
	return f.Action
}
func financeApprovalTable(f FrozenFinanceApproval) string {
	if f.Resource == "invoices" && financeApprovalAction(f) == "request" {
		return "finance_invoice_request"
	}
	if f.Resource == "expenses" && f.Action == "payment" {
		return "finance_payment_request"
	}
	if f.Resource == "expenses" && f.Action == "claim" {
		return "finance_expense_claim"
	}
	if f.Resource == "expenses" && f.Action == "project_expense" {
		return "finance_project_expense_request"
	}
	return ""
}
func financeApprovalBusiness(op string, p map[string]any) (string, string, string) {
	if op == "payment-requests-submit" {
		return "finance_payment_request", "expenses", "payment"
	}
	if op == "claims-submit" {
		return "finance_expense_claim", "expenses", "claim"
	}
	if op == "project-requests-submit" {
		return "finance_project_expense_request", "expenses", "project_expense"
	}
	return "finance_invoice_request", "invoices", "request"
}
func financeApprovalInputTable(op string, p map[string]any) string {
	t, _, _ := financeApprovalBusiness(op, p)
	return t
}
func financeApprovalBusinessLock(ctx context.Context, tx *sql.Tx, table, code string, who Identity, continuation ...bool) (map[string]map[string]any, error) {
	if table == "finance_invoice_request" {
		return financeApprovalLock(ctx, tx, code, who, continuation...)
	}
	if table != "finance_expense_claim" && table != "finance_project_expense_request" && table != "finance_payment_request" {
		return nil, financeInvalid()
	}
	return spendLock(ctx, tx, ledgerSpec{table, "expenses", "edit", "update", true}, FinanceInput{Code: code}, who, altoc.BasicReadScope{Access: "all"})
}
