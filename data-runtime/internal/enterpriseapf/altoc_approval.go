package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

type FrozenAltocApproval struct {
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
}

func ApprovalPermission(op string) (string, string, bool) {
	for _, resource := range []string{"quotation", "contract"} {
		if op == resource+"-approval-request" || op == resource+"-approval-bind" {
			return resource, "edit", true
		}
	}
	return "", "", false
}
func ValidateApprovalInput(op string, i Input) error {
	_, _, ok := ApprovalPermission(op)
	if !ok || !positiveAltocID(i.ID) || i.Code != "" || i.Name != "" || i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.RowVersion < 1 {
		return approvalError(400, "input_invalid")
	}
	return nil
}
func positiveAltocID(id string) bool {
	n, e := strconv.ParseUint(id, 10, 53)
	return e == nil && n > 0 && strconv.FormatUint(n, 10) == id
}
func approvalError(status int, code string) error {
	return httperror.New(status, "altoc_approval_"+code, "Altoc approval "+code)
}
func (s *Service) ConfigureAltocApprovalReader(reader workflowapproval.Reader) {
	s.approvalReader = reader
}
func approvalDigest(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func approvalRequestNo(resource, id, actor, key string, version int64) string {
	return "APF-" + uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("%s|%s|%s|%s|%d", resource, id, actor, key, version))).String()
}
func (s *Service) approvalTx(ctx context.Context, write bool) (*sql.Tx, enterprise.Resolved, error) {
	op := enterprise.Read
	if write {
		op = enterprise.Write
	}
	req, e := s.request("altoc", op)
	if e != nil {
		return nil, enterprise.Resolved{}, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, enterprise.Resolved{}, e
	}
	return tx, rs[0], nil
}
func approvalTable(r enterprise.Resolved, resource string) (string, error) {
	if resource != "quotation" && resource != "contract" {
		return "", approvalError(403, "business_invalid")
	}
	return r.Table("altoc_" + resource)
}
func frozenByKey(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, resource, id, key string) (*FrozenAltocApproval, error) {
	table, _ := r.Table("altoc_audit_log")
	var raw []byte
	e := tx.QueryRowContext(ctx, "SELECT new_value FROM "+table+" WHERE entity_type=? AND entity_id=? AND action='approval-request' AND BINARY request_id=BINARY ? ORDER BY id DESC LIMIT 1", resource, id, key).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var f FrozenAltocApproval
	if json.Unmarshal(raw, &f) != nil {
		return nil, approvalError(503, "snapshot_invalid")
	}
	return &f, nil
}
func frozenByNo(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, no string) (*FrozenAltocApproval, error) {
	table, _ := r.Table("altoc_audit_log")
	var raw []byte
	e := tx.QueryRowContext(ctx, "SELECT new_value FROM "+table+" WHERE action='approval-request' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.requestNo'))=? ORDER BY id DESC LIMIT 1", no).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, approvalError(409, "request_mismatch")
	}
	if e != nil {
		return nil, e
	}
	var f FrozenAltocApproval
	if json.Unmarshal(raw, &f) != nil {
		return nil, approvalError(503, "snapshot_invalid")
	}
	return &f, nil
}
func readApprovalObject(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, resource, id string, lock bool) (map[string]any, error) {
	table, e := approvalTable(r, resource)
	if e != nil {
		return nil, e
	}
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	// queryRows is the owning scalar snapshot reader used by APF read services.
	rows, e := queryRows(ctx, tx, "SELECT * FROM "+table+" WHERE id=? AND deleted_at IS NULL"+suffix, id)
	if e != nil {
		return nil, e
	}
	if len(rows) != 1 {
		return nil, approvalError(404, "object_unavailable")
	}
	return rows[0], nil
}
func approvalText(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func approvalVersion(row map[string]any) int64 {
	n, _ := strconv.ParseInt(approvalText(row["row_version"]), 10, 64)
	return n
}
func approvalAudit(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenAltocApproval, action string, value any, actor, channel, key string) error {
	table, _ := r.Table("altoc_audit_log")
	raw, e := json.Marshal(value)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+table+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES(?,?,?,?,?,?,?,?)", f.Resource, f.BizID, f.Code, action, string(raw), actor, channel, key)
	return e
}
func (s *Service) AltocApproval(ctx context.Context, op string, i Input, who Identity, scope altoc.BasicReadScope) (any, error) {
	if e := ValidateApprovalInput(op, i); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment || who.Key == "" {
		return nil, approvalError(403, "identity_invalid")
	}
	resource, _, _ := ApprovalPermission(op)
	if s.approvalReader == nil {
		return nil, approvalError(503, "workflow_unavailable")
	}
	var instance *workflowapproval.Instance
	if strings.HasSuffix(op, "-bind") {
		tx, r, e := s.approvalTx(ctx, false)
		if e != nil {
			return nil, e
		}
		f, e := frozenByKey(ctx, tx, r, resource, i.ID, who.Key)
		_ = tx.Rollback()
		if e != nil {
			return nil, e
		}
		if f == nil || f.Actor != who.Actor || f.ExpectedVersion != i.RowVersion {
			return nil, approvalError(409, "request_mismatch")
		}
		instance, e = s.approvalReader.ReadAltocApprovalInstance(ctx, resource, i.ID, f.RequestNo)
		if e != nil {
			return nil, e
		}
		if instance == nil {
			return nil, approvalError(503, "instance_pending")
		}
	}
	tx, r, e := s.approvalTx(ctx, true)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	row, e := readApprovalObject(ctx, tx, r, resource, i.ID, true)
	if e != nil {
		return nil, e
	}
	if !altocScopeAllows(scope, who.Actor, approvalText(row["owner_uid"]), approvalText(row["owner_dept_code"])) {
		return nil, approvalError(403, "scope_denied")
	}
	f, e := frozenByKey(ctx, tx, r, resource, i.ID, who.Key)
	if e != nil {
		return nil, e
	}
	if f != nil && (f.Actor != who.Actor || f.ExpectedVersion != i.RowVersion) {
		return nil, approvalError(409, "intent_changed")
	}
	if strings.HasSuffix(op, "-bind") {
		if e = matchApprovalInstance(*f, instance); e != nil {
			return nil, e
		}
		if e = approvalReceipt(ctx, tx, r, *f, who, "bind", who.Key+":bind", map[string]any{"instanceId": instance.ID, "instanceNo": instance.No}, func() error { return bindApproval(ctx, tx, r, *f, row, instance) }); e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"request": f, "instanceId": instance.ID, "bound": true}, nil
	}
	if f != nil {
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return f, nil
	}
	if approvalVersion(row) != i.RowVersion {
		return nil, approvalError(409, "version_conflict")
	}
	if status := approvalText(row["status"]); status != "draft" && status != "rejected" {
		return nil, approvalError(409, "state_conflict")
	}
	snapshot := map[string]any{"object": row}
	if resource == "quotation" {
		table, _ := r.Table("altoc_quotation_item")
		lines, e := queryRows(ctx, tx, "SELECT * FROM "+table+" WHERE quotation_id=? ORDER BY id", i.ID)
		if e != nil {
			return nil, e
		}
		if len(lines) == 0 {
			return nil, approvalError(409, "empty_quotation")
		}
		snapshot["items"] = lines
	} else {
		for _, suffix := range []string{"line", "payment_term", "obligation"} {
			table, _ := r.Table("altoc_contract_" + suffix)
			rows, e := queryRows(ctx, tx, "SELECT * FROM "+table+" WHERE contract_id=? ORDER BY id", i.ID)
			if e != nil {
				return nil, e
			}
			snapshot[suffix] = rows
		}
	}
	f = &FrozenAltocApproval{OperationID: uuid.NewString(), BindOperationID: uuid.NewString(), ResultOperationID: uuid.NewString(), Resource: resource, BizID: i.ID, Code: approvalText(row["code"]), Actor: who.Actor, Title: approvalText(row["name"]), Key: who.Key, ExpectedVersion: i.RowVersion, SnapshotHash: approvalDigest(snapshot), RequestNo: approvalRequestNo(resource, i.ID, who.Actor, who.Key, i.RowVersion)}
	if f.Title == "" {
		f.Title = f.Code
	}
	f.Form = map[string]any{"requestNo": f.RequestNo, "resource": resource, "bizId": i.ID, "requestedBy": who.Actor, "snapshotHash": f.SnapshotHash, "expectedVersion": strconv.FormatInt(i.RowVersion, 10)}
	receipt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	command, _ := json.Marshal(map[string]any{"resource": resource, "id": i.ID, "version": i.RowVersion, "actor": who.Actor})
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: f.OperationID, OperationCode: "altoc.approval." + resource + ".request.v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: approvalDigest(json.RawMessage(command)), Command: command, OriginalActorUID: who.Actor}
	_, e = repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		table, _ := approvalTable(r, resource)
		legal := ""
		if resource == "contract" {
			legal = "legal_status='pending_approval',"
		}
		if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+legal+"status='pending_approval',workflow_instance_id=NULL,row_version=row_version+1,updated_by=? WHERE id=?", who.Actor, i.ID); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e := enqueueApproval(ctx, tx, r, *f, who); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e := approvalAudit(ctx, tx, r, *f, "approval-request", f, who.Actor, "user", who.Key); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: resource, TargetBizCode: f.RequestNo, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(f)}, nil
	})
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return f, nil
}
func matchApprovalInstance(f FrozenAltocApproval, v *workflowapproval.Instance) error {
	if v == nil || !positiveAltocID(v.ID) || v.No == "" || !workflowapproval.Registered(v.App, v.Resource, v.Action) || v.Resource != f.Resource || v.BizID != f.BizID || v.Initiator != f.Actor || v.CallbackPath != workflowapproval.CallbackPath || approvalDigest(v.Form) != approvalDigest(f.Form) {
		return approvalError(409, "instance_mismatch")
	}
	return nil
}
func bindApproval(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenAltocApproval, row map[string]any, v *workflowapproval.Instance) error {
	bound := approvalText(row["workflow_instance_id"])
	if bound == v.ID {
		return nil
	}
	if bound != "" || approvalText(row["status"]) != "pending_approval" || approvalVersion(row) != f.ExpectedVersion+1 {
		return approvalError(409, "round_changed")
	}
	table, _ := approvalTable(r, f.Resource)
	_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET workflow_instance_id=?,row_version=row_version+1 WHERE id=?", v.ID, f.BizID)
	if e != nil {
		return e
	}
	if e = settleApproval(ctx, tx, r, f); e != nil {
		return e
	}
	return approvalAudit(ctx, tx, r, f, "approval-bind", map[string]any{"requestNo": f.RequestNo, "instanceId": v.ID, "instanceNo": v.No}, f.Actor, "system", f.Key)
}

// Queue reads the existing owning integration ledger. Parallel/restarted
// executors replay the same immutable Workflow requestNo.
func (s *Service) PendingAltocApprovals(ctx context.Context) ([]FrozenAltocApproval, error) {
	tx, r, e := s.approvalSchedulerTx(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	out := []FrozenAltocApproval{}
	audit, _ := r.Table("altoc_audit_log")
	ledger, _ := r.Table("integration_operation")
	for _, resource := range []string{"quotation", "contract"} {
		table, _ := approvalTable(r, resource)
		rows, e := queryRows(ctx, tx, "SELECT a.new_value FROM "+audit+" a JOIN "+table+" b ON b.id=a.entity_id JOIN "+ledger+" o ON o.operation_key=JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.requestNo')) AND o.operation_code='altoc.approval.create.v1' AND o.status='pending' WHERE a.entity_type=? AND a.action='approval-request' AND b.status='pending_approval' AND b.workflow_instance_id IS NULL AND b.row_version=CAST(JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.expectedVersion')) AS UNSIGNED)+1 ORDER BY a.id LIMIT 20", resource)
		if e != nil {
			return nil, e
		}
		for _, row := range rows {
			var f FrozenAltocApproval
			if json.Unmarshal([]byte(approvalText(row["new_value"])), &f) != nil {
				return nil, approvalError(503, "snapshot_invalid")
			}
			out = append(out, f)
		}
	}
	return out, tx.Commit()
}
func (s *Service) BindAltocApprovalSystem(ctx context.Context, no string) (any, error) {
	tx, r, e := s.approvalSchedulerTx(ctx)
	if e != nil {
		return nil, e
	}
	f, e := frozenByNo(ctx, tx, r, no)
	_ = tx.Rollback()
	if e != nil {
		return nil, e
	}
	// Authority is the persisted original submit, never an input actor/scope.
	return s.AltocApproval(ctx, f.Resource+"-approval-bind", Input{ID: f.BizID, RowVersion: f.ExpectedVersion}, Identity{Actor: f.Actor, Key: f.Key, Tenant: s.binding.Key.Tenant, Deployment: s.binding.Domains["altoc"].OwnerDeployment, Client: "enterprise.runtime"}, altoc.BasicReadScope{Access: "all"})
}
func queryRows(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]map[string]any, error) {
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	return readFinanceRows(rows, cols)
}

// Callback is callable only from the separately authenticated fixed system route.
// A verified callback payload alone is insufficient: re-read owning Workflow facts.
func (s *Service) AltocApprovalCallback(ctx context.Context, body map[string]any, who Identity) (any, error) {
	if who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, approvalError(403, "identity_invalid")
	}
	allowed := map[string]bool{}
	for _, k := range []string{"event", "instance_id", "instance_no", "app_code", "resource_code", "action_code", "biz_id", "status", "completed_at", "initiator_uid", "form_data", "approval_actor_uids", "non_self_approval_actor_uids", "approval_operator_uid", "idempotencyKey"} {
		allowed[k] = true
	}
	for k := range body {
		if !allowed[k] {
			return nil, approvalError(400, "callback_invalid")
		}
	}
	if !workflowapproval.Registered(approvalText(body["app_code"]), approvalText(body["resource_code"]), approvalText(body["action_code"])) || body["event"] != "flow_completed" {
		return nil, approvalError(403, "callback_business_invalid")
	}
	form, ok := body["form_data"].(map[string]any)
	if !ok {
		return nil, approvalError(400, "callback_invalid")
	}
	no := approvalText(form["requestNo"])
	tx, r, e := s.approvalTx(ctx, false)
	if e != nil {
		return nil, e
	}
	f, e := frozenByNo(ctx, tx, r, no)
	_ = tx.Rollback()
	if e != nil {
		return nil, e
	}
	if s.approvalReader == nil {
		return nil, approvalError(503, "workflow_unavailable")
	}
	v, e := s.approvalReader.ReadAltocApprovalInstance(ctx, f.Resource, f.BizID, no)
	if e != nil {
		return nil, e
	}
	if e = matchApprovalInstance(*f, v); e != nil {
		return nil, e
	}
	key := "workflow:callback:" + v.ID + ":flow_completed:" + v.Status
	if body["resource_code"] != v.Resource || body["action_code"] != v.Action || (v.Status != "approved" && v.Status != "rejected") || v.Operator == "" || v.Operator == v.Initiator || len(v.NonSelf) == 0 || approvalText(body["instance_id"]) != v.ID || body["instance_no"] != v.No || approvalText(body["biz_id"]) != v.BizID || body["initiator_uid"] != v.Initiator || body["status"] != v.Status || body["approval_operator_uid"] != v.Operator || body["idempotencyKey"] != key || approvalDigest(form) != approvalDigest(f.Form) {
		return nil, approvalError(409, "callback_evidence_invalid")
	}
	tx, r, e = s.approvalTx(ctx, true)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	row, e := readApprovalObject(ctx, tx, r, f.Resource, f.BizID, true)
	if e != nil {
		return nil, e
	}
	audit, _ := r.Table("altoc_audit_log")
	var raw []byte
	e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE entity_type=? AND entity_id=? AND action='approval-result' AND BINARY request_id=BINARY ? ORDER BY id DESC LIMIT 1", f.Resource, f.BizID, key).Scan(&raw)
	result := map[string]any{"requestNo": no, "instanceId": v.ID, "status": v.Status, "operator": v.Operator}
	if e == nil {
		var old any
		if json.Unmarshal(raw, &old) != nil || approvalDigest(old) != approvalDigest(result) {
			return nil, approvalError(409, "callback_conflict")
		}
		return result, tx.Commit()
	}
	if e != sql.ErrNoRows {
		return nil, e
	}
	bound := approvalText(row["workflow_instance_id"])
	expected := f.ExpectedVersion + 1
	if bound != "" {
		expected++
	}
	if approvalText(row["status"]) != "pending_approval" || approvalVersion(row) != expected || (bound != "" && bound != v.ID) {
		return nil, approvalError(409, "round_changed")
	}
	table, _ := approvalTable(r, f.Resource)
	approvedBy, approvedAt := any(nil), "NULL"
	if v.Status == "approved" {
		approvedBy = v.Operator
		approvedAt = "UTC_TIMESTAMP(3)"
	}
	who.Actor = v.Operator
	e = approvalReceipt(ctx, tx, r, *f, who, "callback", key, result, func() error {
		legal := ""
		if f.Resource == "contract" {
			legal = "legal_status='" + v.Status + "',"
		}
		_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+legal+"status=?,workflow_instance_id=?,approved_by=?,approved_at="+approvedAt+",row_version=row_version+1,updated_by=? WHERE id=?", v.Status, v.ID, approvedBy, v.Operator, f.BizID)
		if e != nil {
			return e
		}
		if e = settleApproval(ctx, tx, r, *f); e != nil {
			return e
		}
		return approvalAudit(ctx, tx, r, *f, "approval-result", result, v.Operator, "system", key)
	})
	if e != nil {
		return nil, e
	}
	return result, tx.Commit()
}

func enqueueApproval(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenAltocApproval, who Identity) error {
	table, _ := r.Table("integration_operation")
	command, _ := json.Marshal(f)
	_, e := tx.ExecContext(ctx, "INSERT INTO "+table+" (operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,next_attempt_at) VALUES (?,?,?,1,?,?,'altoc','workflow','altoc.approval.create.v1','workflow:proxy',?,? ,?,'v1',?,?,'pending',?,?,?,?,?,UTC_TIMESTAMP(3))", f.OperationID, f.RequestNo, f.RequestNo, who.Tenant, who.Deployment, f.Resource, f.BizID, f.RequestNo, string(command), approvalDigest(f), who.RequestID, f.Actor, who.Client, f.Actor, f.Actor)
	return e
}
func settleApproval(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenAltocApproval) error {
	table, _ := r.Table("integration_operation")
	_, e := tx.ExecContext(ctx, "UPDATE "+table+" SET status='succeeded',version_no=version_no+1,updated_by='enterprise.runtime',updated_at=UTC_TIMESTAMP(3) WHERE operation_key=? AND operation_code='altoc.approval.create.v1' AND status='pending'", f.RequestNo)
	return e
}
func approvalReceipt(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, f FrozenAltocApproval, who Identity, action, key string, command any, apply func() error) error {
	table, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(table))
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(command)
	capability := "altoc:enterprise-host:execute"
	if action == "callback" {
		capability = "altoc:scheduler:execute"
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: func() string {
		if action == "bind" {
			return f.BindOperationID
		}
		return f.ResultOperationID
	}(), OperationCode: "altoc.approval." + f.Resource + "." + action + ".v1", RequiredCapability: capability, IdempotencyKey: key, CommandSchemaVersion: "v1", CommandSHA256: approvalDigest(command), Command: raw, OriginalActorUID: who.Actor}
	_, e = repo.ExecuteInTransaction(ctx, tx, in, func(context.Context, *sql.Tx, json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if e := apply(); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: f.Resource, TargetBizCode: f.RequestNo, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(command)}, nil
	})
	return e
}

func (s *Service) approvalSchedulerTx(ctx context.Context) (*sql.Tx, enterprise.Resolved, error) {
	req, e := s.request("altoc", enterprise.Scheduler)
	if e != nil {
		return nil, enterprise.Resolved{}, e
	}
	tx, rs, e := s.registry.BeginSchedulerTransaction(ctx, req)
	if e != nil {
		return nil, enterprise.Resolved{}, e
	}
	return tx, rs[0], nil
}
