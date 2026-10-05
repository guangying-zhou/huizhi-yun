package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Runtime construction injects the owning Workflow read, never a URL/table
// supplied by a caller. Aims deliberately does not import Workflow.
type requirementReviewCallbackContextKey struct{}

func (a *Adapter) requireRequirementReviewResultContext(ctx context.Context, batch *requirementReviewBatchRow) error {
	verified, _ := ctx.Value(requirementReviewCallbackContextKey{}).(bool)
	frozen := false
	if batch != nil {
		_, _, frozen = reviewWorkflowBinding(batch.workflowInstanceID)
	}
	if (a.enterpriseWrites != nil || frozen) && !verified {
		return httperror.New(403, "workflow_callback_verification_required", "Formal Workflow callback required")
	}
	return nil
}

func reviewWorkflowAction(batchType string) string {
	if batchType == "baseline" {
		return "requirement_baseline"
	}
	return "requirement_change"
}
func reviewWorkflowBinding(raw *string) (id, hash string, frozen bool) {
	if raw == nil {
		return
	}
	parts := strings.Split(*raw, ":")
	if len(parts) == 3 && parts[0] == "rrb" && len(parts[2]) == 64 {
		_, hashErr := hex.DecodeString(parts[2])
		n, idErr := strconv.ParseInt(parts[1], 10, 64)
		if hashErr == nil && (parts[1] == "pending" || idErr == nil && n > 0) {
			return parts[1], parts[2], true
		}
	}
	return *raw, "", false
}
func reviewWorkflowForm(batch requirementReviewBatchRow, hash string) map[string]any {
	return map[string]any{"projectId": strconv.FormatInt(batch.projectID, 10), "batchId": strconv.FormatInt(batch.id, 10), "snapshotHash": hash, "requestedBy": nullableStringValue(batch.submittedBy), "requestNo": fmt.Sprintf("RRB-%d-%s", batch.id, hash)}
}
func (a *Adapter) readRequirementReviewWorkflow(ctx context.Context, batchID string) (map[string]any, error) {
	id, err := parseReviewBatchID(batchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.workflowInstanceReader == nil {
		return nil, httperror.New(503, "requirement_workflow_unavailable", "Workflow read unavailable")
	}
	instanceID, _, _ := reviewWorkflowBinding(batch.workflowInstanceID)
	if instanceID == "pending" {
		instanceID = ""
	}
	actor := ""
	if batch.submittedBy != nil {
		actor = *batch.submittedBy
	}
	instance, err := a.workflowInstanceReader.ReadAimsRequirementReviewInstance(ctx, batchID, instanceID, actor, reviewWorkflowAction(batch.batchType))
	if err != nil {
		var h httperror.Error
		if errors.As(err, &h) && h.Status >= 400 && h.Status < 500 {
			return nil, err
		}
		return nil, httperror.New(503, "requirement_workflow_unavailable", "Workflow read unavailable")
	}
	return instance, nil
}
func validateReviewWorkflowInstance(batch requirementReviewBatchRow, hash string, instance map[string]any) error {
	form, _ := instance["form_data"].(map[string]any)
	want, _ := json.Marshal(reviewWorkflowForm(batch, hash))
	got, _ := json.Marshal(form)
	if instance == nil || firstBodyText(instance, "app_code") != "aims" || firstBodyText(instance, "resource_code") != "requirements" || firstBodyText(instance, "action_code") != reviewWorkflowAction(batch.batchType) || firstBodyText(instance, "biz_id") != strconv.FormatInt(batch.id, 10) || batch.submittedBy == nil || firstBodyText(instance, "initiator_uid") != *batch.submittedBy || string(want) != string(got) {
		return httperror.New(409, "requirement_workflow_binding_mismatch", "Workflow does not match frozen review")
	}
	id := firstBodyText(instance, "id", "instance_id")
	if _, err := parseReviewBatchID(id); err != nil {
		return httperror.New(409, "requirement_workflow_binding_mismatch", "Workflow identity invalid")
	}
	if bound, _, frozen := reviewWorkflowBinding(batch.workflowInstanceID); frozen && bound != "pending" && bound != id {
		return httperror.New(409, "requirement_workflow_binding_mismatch", "Workflow identity changed")
	}
	return nil
}
func requirementReviewSnapshotTx(ctx context.Context, tx *sql.Tx, batch requirementReviewBatchRow) (string, error) {
	if len(batch.requirementIDs) == 0 {
		return "", httperror.New(409, "review_batch_empty", "Review has no requirements")
	}
	// Include content bytes and requirement metadata. The canonical Go encoder
	// freezes all touched rows, including change parents, before Workflow creation.
	rows, err := tx.QueryContext(ctx, `SELECT r.id,r.project_id,r.title,r.type,r.priority,r.source,r.scope_note,r.milestone_id,r.work_item_id,r.item_kind,r.parent_requirement_id,r.current_version,c.id,c.project_id,c.title,c.content_md,c.content_original_id,c.version_status,ric.relation_type,r.status FROM requirement_items r LEFT JOIN requirement_item_contents ric ON ric.requirement_id=r.id LEFT JOIN requirement_contents c ON c.id=ric.content_id WHERE r.id IN (`+placeholders(len(batch.requirementIDs))+`) OR r.id IN (SELECT parent_requirement_id FROM requirement_items WHERE id IN (`+placeholders(len(batch.requirementIDs))+`)) ORDER BY r.id,c.id FOR UPDATE`, append(int64Args(batch.requirementIDs), int64Args(batch.requirementIDs)...)...)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	columns, _ := rows.Columns()
	all := []any{}
	seen := map[int64]bool{}
	selected := map[int64]bool{}
	for _, id := range batch.requirementIDs {
		selected[id] = true
	}
	for rows.Next() {
		values := make([]any, len(columns))
		ptr := make([]any, len(columns))
		for i := range values {
			ptr[i] = &values[i]
		}
		if err = rows.Scan(ptr...); err != nil {
			return "", err
		}
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				values[i] = string(b)
			}
		}
		rid, _ := strconv.ParseInt(fmt.Sprint(values[0]), 10, 64)
		seen[rid] = true
		if selected[rid] && fmt.Sprint(values[19]) != "in_review" {
			return "", httperror.New(409, "review_snapshot_changed", "Review requirement is no longer pending")
		}
		if fmt.Sprint(values[1]) != strconv.FormatInt(batch.projectID, 10) || values[13] != nil && fmt.Sprint(values[13]) != strconv.FormatInt(batch.projectID, 10) {
			return "", httperror.New(403, "requirement_project_mismatch", "Review crosses projects")
		}
		all = append(all, values)
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	missing := false
	for _, id := range batch.requirementIDs {
		missing = missing || !seen[id]
	}
	if missing {
		return "", httperror.New(409, "review_batch_references_invalid", "Review references unavailable")
	}
	raw, _ := json.Marshal([]any{batch.id, batch.projectID, batch.title, batch.batchType, batch.submittedBy, batch.requirementIDs, all})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}
func (a *Adapter) syncEnterpriseRequirementReviewTx(ctx context.Context, tx *sql.Tx, pid, bid int64, actor string, instance map[string]any) (map[string]any, error) {
	batch, err := a.loadRequirementReviewBatch(ctx, bid)
	if err != nil {
		return nil, err
	}
	if batch.projectID != pid || batch.submittedBy == nil || *batch.submittedBy != actor {
		return nil, httperror.New(403, "review_initiator_required", "Only the review initiator can submit")
	}
	id, hash, frozen := reviewWorkflowBinding(batch.workflowInstanceID)
	if !frozen && id != "" {
		return nil, httperror.New(409, "review_legacy_workflow_binding", "Historical review binding requires reconciliation")
	}
	if batch.status != "pending" {
		if !frozen || id == "pending" {
			return nil, httperror.New(409, "requirement_workflow_binding_mismatch", "Closed review lacks a formal binding")
		}
		return map[string]any{"batchId": bid, "synced": true, "workflowInstanceId": id, "status": batch.status}, nil
	}
	active, name, err := a.activeRequirementReviewMilestone(ctx, pid, "当前没有活动里程碑，暂不可提交需求评审")
	if err != nil {
		return nil, err
	}
	if err = a.validateRequirementReviewMilestone(ctx, pid, batch.requirementIDs, active, name, "该评审批次"); err != nil {
		return nil, err
	}
	current, err := requirementReviewSnapshotTx(ctx, tx, batch)
	if err != nil {
		return nil, err
	}
	if frozen && current != hash {
		return nil, httperror.New(409, "review_snapshot_changed", "Review contents changed after preparation")
	}
	if !frozen {
		hash = current
		id = "pending"
		if _, err = tx.ExecContext(ctx, "UPDATE requirement_review_batches SET workflow_instance_id=? WHERE id=? AND workflow_instance_id IS NULL", "rrb:pending:"+hash, bid); err != nil {
			return nil, err
		}
		v := "rrb:pending:" + hash
		batch.workflowInstanceID = &v
	}
	if instance != nil {
		if err = validateReviewWorkflowInstance(batch, hash, instance); err != nil {
			return nil, err
		}
		id = firstBodyText(instance, "id", "instance_id")
		if _, err = tx.ExecContext(ctx, "UPDATE requirement_review_batches SET workflow_instance_id=? WHERE id=?", "rrb:"+id+":"+hash, bid); err != nil {
			return nil, err
		}
	}
	return map[string]any{"batchId": bid, "projectId": pid, "actionCode": reviewWorkflowAction(batch.batchType), "title": batch.title, "synced": id != "pending", "workflowInstanceId": map[bool]string{true: id, false: ""}[id != "pending"], "formData": reviewWorkflowForm(batch, hash)}, nil
}
func (a *Adapter) applyRequirementReviewWorkflowCallback(ctx context.Context, q url.Values, body map[string]any) (map[string]any, error) {
	if !truthyQuery(q, "workflow_callback_verified") {
		return nil, httperror.New(403, "workflow_callback_verification_required", "Trusted callback required")
	}
	status := firstBodyText(body, "status")
	bid := firstBodyText(body, "biz_id")
	if firstBodyText(body, "event") != "flow_completed" || firstBodyText(body, "app_code") != "aims" || firstBodyText(body, "resource_code") != "requirements" || (status != "approved" && status != "rejected" && status != "cancelled") {
		return nil, httperror.New(400, "requirement_callback_invalid", "Invalid review callback")
	}
	instance, err := a.readRequirementReviewWorkflow(ctx, bid)
	if err != nil {
		return nil, err
	}
	tx, _, err := a.beginBoundEnterpriseTransaction(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ctx = context.WithValue(ctx, enterpriseRequirementTxKey{}, tx)
	batchID, err := parseReviewBatchID(bid)
	if err != nil {
		return nil, err
	}
	// Same Registry -> owning project -> review -> requirements lock order as writes.
	var pid int64
	if err = tx.QueryRowContext(ctx, "SELECT project_id FROM requirement_review_batches WHERE id=?", batchID).Scan(&pid); err != nil {
		return nil, err
	}
	var locked int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id=? FOR UPDATE", pid).Scan(&locked); err != nil {
		return nil, err
	}
	if err = validateRequirementReviewReferencesTx(ctx, tx, pid, batchID, "review-sync", nil); err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	id, hash, frozen := reviewWorkflowBinding(batch.workflowInstanceID)
	if !frozen {
		return nil, httperror.New(409, "review_not_prepared", "Review is not frozen")
	}
	if err = validateReviewWorkflowInstance(batch, hash, instance); err != nil {
		return nil, err
	}
	if firstBodyText(instance, "id", "instance_id") != firstBodyText(body, "instance_id") || firstBodyText(instance, "status") != status || firstBodyText(body, "action_code") != reviewWorkflowAction(batch.batchType) || firstBodyText(body, "initiator_uid") != *batch.submittedBy {
		return nil, httperror.New(409, "requirement_callback_mismatch", "Callback differs from Workflow result")
	}
	got, _ := json.Marshal(body["form_data"])
	want, _ := json.Marshal(reviewWorkflowForm(batch, hash))
	if string(got) != string(want) {
		return nil, httperror.New(409, "requirement_callback_mismatch", "Callback snapshot differs")
	}
	terminal := status
	if status == "cancelled" {
		terminal = "rejected"
	}
	if batch.status == terminal {
		return map[string]any{"batchId": batchID, "alreadyApplied": true}, nil
	}
	if batch.status != "pending" {
		return nil, httperror.New(409, "batch_closed", "Review already closed")
	}
	current, err := requirementReviewSnapshotTx(ctx, tx, batch)
	if err != nil {
		return nil, err
	}
	if current != hash {
		return nil, httperror.New(409, "review_snapshot_changed", "Review snapshot changed")
	}
	if err = requireRequirementConnectedObjectsTx(ctx, tx, pid, 0, "review-sync"); err != nil {
		return nil, err
	}
	// Check all parent/content/work-item ownership before applying legacy domain core.
	for _, rid := range batch.requirementIDs {
		if err = validateRequirementReviewReferencesTx(ctx, tx, pid, rid, "task-create", nil); err != nil {
			return nil, err
		}
	}
	if id == "pending" {
		id = firstBodyText(instance, "id", "instance_id")
		if _, err = tx.ExecContext(ctx, "UPDATE requirement_review_batches SET workflow_instance_id=? WHERE id=?", "rrb:"+id+":"+hash, batchID); err != nil {
			return nil, err
		}
	}
	actor := firstBodyText(instance, "approval_operator_uid")
	if status == "approved" && actor == "" {
		return nil, httperror.New(409, "requirement_callback_mismatch", "Formal approval actor required")
	}
	if supplied := firstBodyText(body, "approval_operator_uid"); supplied != "" && supplied != actor {
		return nil, httperror.New(409, "requirement_callback_mismatch", "Approval actor differs")
	}
	if actor == "" {
		actor = *batch.submittedBy
	}
	ctx = context.WithValue(ctx, requirementReviewCallbackContextKey{}, true)
	callbackQuery := url.Values{"current_user": {actor}}
	var out map[string]any
	if status == "approved" {
		out, err = a.approveRequirementReviewBatch(ctx, bid, callbackQuery, map[string]any{"workflowInstanceId": id})
	} else {
		out, err = a.rejectRequirementReviewBatch(ctx, bid, callbackQuery)
	}
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE requirement_review_batches SET workflow_instance_id=? WHERE id=?", "rrb:"+id+":"+hash, batchID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
