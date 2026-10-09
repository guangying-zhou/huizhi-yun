package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// CompletionLane is consumed by Aims, implemented by Workflow's private lane
// capsule. Production transport code must never implement or construct it.
// There is no JSON/body representation and no raw Tx+Resolved pair at this boundary.
type CompletionLane interface {
	AimsTransaction() (*sql.Tx, e.Resolved, error)
	DirectorySnapshot() json.RawMessage
	Employee(string) bool
}

func (a *Adapter) RequestCompletionInLane(ctx context.Context, h CompletionLane, id EnterpriseProjectUpdateIdentity, project, item, kind string, command map[string]any) (map[string]any, error) {
	if h == nil || !h.Employee(id.ActorUID) {
		return nil, httperror.New(403, "workflow_subject_type_not_allowed", "Only employees may initiate completion")
	}
	tx, rs, err := h.AimsTransaction()
	if err != nil {
		return nil, err
	}
	if err = a.verifyCompletionResolved(rs); err != nil {
		return nil, err
	}
	table, err := rs.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	repo, err := iop.NewReceiptRepository(rs.DB, iop.WithReceiptTable(table))
	if err != nil {
		return nil, err
	}
	return a.requestEnterpriseWorkItemCompletionTx(ctx, tx, repo, completionInProcess, id, project, item, kind, command, h.DirectorySnapshot())
}

// CompletionCommandInLane derives the command exclusively from frozen source
// rows and the actual owning receipt, including on response-loss replay.
func (a *Adapter) CompletionCommandInLane(ctx context.Context, h CompletionLane, receipt string) (map[string]any, error) {
	tx, rs, err := h.AimsTransaction()
	if err != nil {
		return nil, err
	}
	if err = a.verifyCompletionResolved(rs); err != nil {
		return nil, err
	}
	table, _ := rs.Table("service_command_receipt")
	var id int64
	if err = tx.QueryRowContext(ctx, "SELECT target_biz_code FROM "+table+" WHERE receipt_id=? AND status='succeeded' AND target_biz_type='work_item_completion_request'", receipt).Scan(&id); err != nil {
		return nil, err
	}
	r, err := aimsQueryOneMap(ctx, tx, `SELECT r.* FROM work_item_completion_requests r WHERE r.id=?`, id)
	if err != nil || r == nil {
		return nil, httperror.New(409, "completion_request_missing", "Frozen completion request is missing")
	}
	var snap map[string]any
	if json.Unmarshal([]byte(firstBodyText(r, "snapshot_json")), &snap) != nil {
		return nil, httperror.New(409, "completion_snapshot_invalid", "Frozen snapshot invalid")
	}
	item, ok := snap["item"].(map[string]any)
	if !ok {
		return nil, httperror.New(409, "completion_snapshot_invalid", "Frozen item snapshot invalid")
	}
	cmd := map[string]any{"completionRequestId": id, "workItemId": serviceBodyInt(r, "work_item_id"), "workItemKey": item["item_key"], "projectId": serviceBodyInt(r, "project_id"), "actorUid": r["requested_by"], "snapshotSha256": r["snapshot_sha256"], "bizTitle": item["title"], "bizContext": map[string]any{"project_id": serviceBodyInt(r, "project_id")}, "formData": map[string]any{"completionRequestId": id, "workItemId": serviceBodyInt(r, "work_item_id"), "projectId": serviceBodyInt(r, "project_id"), "snapshotSha256": r["snapshot_sha256"]}, "idempotencyKey": r["operation_key"]}
	if firstBodyText(r, "kind") == "matter" {
		cmd["kind"] = "matter"
		form := cmd["formData"].(map[string]any)
		form["kind"] = "matter"
		form["evidenceSummary"] = matterCompletionEvidenceSummary(snap)
	}
	return cmd, nil
}
func (a *Adapter) BindCompletionInstanceInLane(ctx context.Context, h CompletionLane, cmd map[string]any, instance int64, number, receipt string) error {
	tx, rs, err := h.AimsTransaction()
	if err != nil {
		return err
	}
	if err = a.verifyCompletionResolved(rs); err != nil {
		return err
	}
	return completeWorkItemCompletionWorkflowTx(ctx, tx, cmd, map[string]any{"workflowInstanceId": instance, "workflowInstanceNo": number, "targetReceiptId": receipt})
}

// Internal decisions use owning evidence, not a fabricated service-token verdict.
func (a *Adapter) ApplyCompletionDecisionInLane(ctx context.Context, h CompletionLane, payload map[string]any) (map[string]any, error) {
	tx, rs, err := h.AimsTransaction()
	if err != nil {
		return nil, err
	}
	if err = a.verifyCompletionResolved(rs); err != nil {
		return nil, err
	}
	actor := firstBodyText(payload, "approval_operator_uid")
	if firstBodyText(payload, "status") == "cancelled" {
		actor = firstBodyText(payload, "cancellation_actor_uid")
	}
	if !h.Employee(actor) {
		return nil, httperror.New(403, "workflow_subject_type_not_allowed", "Only employees may decide completion")
	}
	source := iop.TrustedContext{TenantCode: rs.Key.Tenant, DeploymentCode: a.enterpriseWrites.workerDeployment, SourceApp: "aims", ServiceClientID: "aims.runtime"}
	c, err := completionCallbackEvidence(payload, source)
	if err != nil {
		return nil, err
	}
	for _, uid := range append(c.approvers, c.nonSelf...) {
		if !h.Employee(uid) {
			return nil, httperror.New(403, "workflow_subject_type_not_allowed", "Approval evidence must name employees")
		}
	}
	if c.status != "cancelled" && c.operator == c.actor {
		return nil, httperror.New(403, "completion_self_approval_forbidden", "Self approval is forbidden")
	}
	out, err := a.applyWorkItemCompletionCallbackTx(ctx, tx, c)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (a *Adapter) CompletionDirectoryInLane(ctx context.Context, h CompletionLane, receipt string) (map[string]any, error) {
	tx, rs, err := h.AimsTransaction()
	if err != nil {
		return nil, err
	}
	if err = a.verifyCompletionResolved(rs); err != nil {
		return nil, err
	}
	table, _ := rs.Table("service_command_receipt")
	var raw []byte
	if err = tx.QueryRowContext(ctx, "SELECT r.snapshot_json FROM work_item_completion_requests r JOIN "+table+" c ON c.target_biz_code=CAST(r.id AS CHAR) WHERE c.receipt_id=? AND c.target_biz_type='work_item_completion_request' AND c.status='succeeded'", receipt).Scan(&raw); err != nil {
		return nil, err
	}
	var snapshot struct {
		Directory json.RawMessage `json:"workflowDirectory"`
	}
	if json.Unmarshal(raw, &snapshot) != nil || len(snapshot.Directory) == 0 {
		return nil, httperror.New(503, "workflow_directory_snapshot_unavailable", "Frozen Directory snapshot unavailable")
	}
	var facts struct {
		Context map[string]any `json:"context"`
	}
	if json.Unmarshal(snapshot.Directory, &facts) != nil || facts.Context == nil {
		return nil, httperror.New(503, "workflow_directory_snapshot_unavailable", "Frozen Directory snapshot unavailable")
	}
	facts.Context["workflow_directory_snapshot"] = snapshot.Directory
	sum := sha256.Sum256(snapshot.Directory)
	facts.Context["workflow_directory_snapshot_sha256"] = hex.EncodeToString(sum[:])
	return facts.Context, nil
}
