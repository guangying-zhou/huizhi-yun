package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const WorkItemCompletionCallbackCapability = "aims:work-item-completion-callback:execute"

// The private callback is constructed only behind the same verified Workflow
// BFF boundary used by existing Aims callbacks, plus exact source-runtime scope.
type VerifiedWorkItemCompletionCallback struct {
	source                                   integrationoperation.TrustedContext
	requestID, projectID, itemID, instanceID int
	instanceNo, actor, hash, status, kind    string
	summary                                  map[string]any
	operator                                 string
	approvers, nonSelf                       []string
}

func VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query url.Values, body map[string]any) (VerifiedWorkItemCompletionCallback, error) {
	fail := func() (VerifiedWorkItemCompletionCallback, error) {
		return VerifiedWorkItemCompletionCallback{}, httperror.New(403, "work_item_completion_callback_invalid", "Completion callback binding is invalid")
	}
	if !truthyQuery(query, "workflow_callback_verified") || firstBodyText(body, "event") != "flow_completed" || firstBodyText(body, "app_code") != "aims" || firstBodyText(body, "resource_code") != "tasks" || firstBodyText(body, "action_code") != "complete" {
		return fail()
	}
	source, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil || source.ServiceClientID != "aims.runtime" {
		return fail()
	}
	form, ok := body["form_data"].(map[string]any)
	if !ok || (len(form) != 4 && len(form) != 6) {
		return fail()
	}
	kind := "target"
	if len(form) == 6 {
		if form["kind"] != "matter" || !validMatterCompletionEvidenceSummary(form["evidenceSummary"]) {
			return fail()
		}
		kind = "matter"
	}
	c := VerifiedWorkItemCompletionCallback{source: source, requestID: completionPositiveNumber(form["completionRequestId"]), projectID: completionPositiveNumber(form["projectId"]), itemID: completionPositiveNumber(form["workItemId"]), instanceID: completionPositiveNumber(body["instance_id"]), instanceNo: firstBodyText(body, "instance_no"), actor: firstBodyText(body, "initiator_uid"), hash: firstBodyText(form, "snapshotSha256"), status: firstBodyText(body, "status"), kind: kind}
	if kind == "matter" {
		c.summary = form["evidenceSummary"].(map[string]any)
	}
	if c.requestID <= 0 || c.projectID <= 0 || c.itemID <= 0 || c.instanceID <= 0 || c.instanceNo == "" || c.actor == "" || len(c.hash) != 64 || firstBodyText(body, "biz_id") != fmt.Sprint(c.itemID) || (c.status != "approved" && c.status != "rejected" && c.status != "cancelled") {
		return fail()
	}
	if firstBodyText(body, "idempotencyKey") != fmt.Sprintf("workflow:callback:%d:flow_completed:%s", c.instanceID, c.status) {
		return fail()
	}
	if c.status == "cancelled" {
		c.operator = firstBodyText(body, "cancellation_actor_uid")
		if c.operator != c.actor || body["approval_actor_uids"] != nil || body["non_self_approval_actor_uids"] != nil || firstBodyText(body, "approval_operator_uid") != "" {
			return fail()
		}
		return c, nil
	}
	c.operator = firstBodyText(body, "approval_operator_uid")
	c.approvers = completionActorEvidence(body["approval_actor_uids"])
	c.nonSelf = completionActorEvidence(body["non_self_approval_actor_uids"])
	if c.operator == "" || len(c.approvers) == 0 || !completionContains(c.approvers, c.operator) {
		return fail()
	}
	for _, uid := range c.nonSelf {
		if uid == c.actor || !completionContains(c.approvers, uid) {
			return fail()
		}
	}
	if c.status == "approved" && (len(c.nonSelf) == 0 || c.operator == c.actor) {
		return fail()
	}
	return c, nil
}

func (a *Adapter) ApplyWorkItemCompletionCallback(ctx context.Context, c VerifiedWorkItemCompletionCallback) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	if err := a.verifyEnterpriseCompletionTables(ctx); err != nil {
		return nil, err
	}
	if c.source.TenantCode != a.enterpriseWrites.writer.Key.Tenant || c.source.DeploymentCode != a.enterpriseWrites.workerDeployment || c.source.SourceApp != "aims" || c.source.ServiceClientID != "aims.runtime" {
		return nil, httperror.New(403, "work_item_completion_callback_source_mismatch", "Completion source binding does not match")
	}
	tx, _, err := a.beginBoundEnterpriseTransaction(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Project-before-item-before-request matches ordinary work-item writes and
	// serializes review callback against project/member changes.
	var exists int
	if err = tx.QueryRowContext(ctx, "SELECT 1 FROM aims_projects WHERE id=? FOR UPDATE", c.projectID).Scan(&exists); err != nil {
		return nil, err
	}
	item, version, err := enterpriseWorkItemSnapshot(ctx, tx, fmt.Sprint(c.itemID), true)
	if err != nil {
		return nil, err
	}
	var actor, hash, status, reviewVersion, instanceNo, kind string
	var instance sql.NullInt64
	var snapshotJSON []byte
	err = tx.QueryRowContext(ctx, "SELECT requested_by,snapshot_sha256,status,review_version,workflow_instance_id,COALESCE(workflow_instance_no,''),snapshot_json,kind FROM work_item_completion_requests WHERE id=? AND project_id=? AND work_item_id=? FOR UPDATE", c.requestID, c.projectID, c.itemID).Scan(&actor, &hash, &status, &reviewVersion, &instance, &instanceNo, &snapshotJSON, &kind)
	if err != nil {
		return nil, httperror.New(403, "work_item_completion_callback_object_mismatch", "Completion request binding does not match")
	}
	if actor != c.actor || hash != c.hash || kind != c.kind || fmt.Sprint(item["project_id"]) != fmt.Sprint(c.projectID) || (instance.Valid && (instance.Int64 != int64(c.instanceID) || instanceNo != c.instanceNo)) {
		return nil, httperror.New(403, "work_item_completion_callback_object_mismatch", "Completion request binding does not match")
	}
	if kind == "matter" {
		var frozen struct {
			Evidence map[string]any `json:"evidence"`
		}
		if json.Unmarshal(snapshotJSON, &frozen) != nil || frozen.Evidence == nil {
			return nil, httperror.New(409, "work_item_completion_snapshot_invalid", "Matter evidence snapshot is invalid")
		}
		expectedJSON, _ := json.Marshal(matterCompletionEvidenceSummary(map[string]any{"evidence": frozen.Evidence}))
		callbackJSON, _ := json.Marshal(c.summary)
		if string(expectedJSON) != string(callbackJSON) {
			return nil, httperror.New(403, "work_item_completion_callback_object_mismatch", "Matter snapshot summary does not match")
		}
	}
	if status == c.status {
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"requestId": c.requestID, "status": status, "alreadyApplied": true}, nil
	}
	if (status != "queued" && status != "running") || aimsMapText(item, "status") != "in_review" || version != reviewVersion {
		return nil, httperror.New(409, "work_item_completion_callback_conflict", "Work item review changed; completion cannot be applied")
	}
	// Approval only applies to the exact frozen target children or matter
	// evidence. A request can never be interpreted under the other kind.
	var snapshot struct {
		Kind     string `json:"kind"`
		Children []struct {
			ID      any    `json:"id"`
			Status  string `json:"status"`
			Version string `json:"version"`
		} `json:"children"`
	}
	if json.Unmarshal(snapshotJSON, &snapshot) != nil || (kind == "target" && len(snapshot.Children) == 0) || (kind == "matter" && snapshot.Kind != "matter") {
		return nil, httperror.New(409, "work_item_completion_snapshot_invalid", "Completion snapshot is invalid")
	}
	if c.status == "approved" {
		if kind == "matter" {
			if aimsMapText(item, "tier") != "matter" || aimsMapText(item, "type") == "requirement" {
				return nil, httperror.New(409, "matter_completion_item_changed", "Matter completion item changed")
			}
			var frozen struct {
				Evidence map[string]any `json:"evidence"`
			}
			if json.Unmarshal(snapshotJSON, &frozen) != nil || frozen.Evidence == nil {
				return nil, httperror.New(409, "work_item_completion_snapshot_invalid", "Matter evidence snapshot is invalid")
			}
			live, _, evidenceErr := matterCompletionEvidence(ctx, tx, item, true)
			if evidenceErr != nil {
				return nil, evidenceErr
			}
			frozenJSON, _ := json.Marshal(frozen.Evidence)
			liveJSON, _ := json.Marshal(live)
			if string(frozenJSON) != string(liveJSON) {
				return nil, httperror.New(409, "matter_completion_evidence_changed", "Matter evidence changed during review")
			}
		} else {
			var count int
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_items WHERE parent_id=?", c.itemID).Scan(&count); err != nil {
				return nil, err
			}
			if count != len(snapshot.Children) {
				return nil, httperror.New(409, "work_item_completion_children_changed", "Child work items changed during review")
			}
			for _, child := range snapshot.Children {
				m, v, e := enterpriseWorkItemSnapshot(ctx, tx, fmt.Sprint(child.ID), true)
				if e != nil {
					return nil, e
				}
				if v != child.Version || aimsMapText(m, "status") != "completed" || serviceBodyInt(m, "parent_id") != c.itemID {
					return nil, httperror.New(409, "work_item_completion_children_changed", "Child work items changed during review")
				}
			}
		}
	}
	next := "in_progress"
	if c.status == "approved" {
		next = "completed"
	}
	if _, err = tx.ExecContext(ctx, "UPDATE work_items SET status=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?", next, c.itemID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE work_item_completion_requests SET status=?,workflow_instance_id=?,workflow_instance_no=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?", c.status, c.instanceID, c.instanceNo, c.requestID); err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: c.source.TenantCode, TargetDeployment: c.source.DeploymentCode, ActorUID: c.actor, RequestID: c.source.RequestID}
	if _, err = a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, fmt.Sprint(c.itemID), enterpriseCompletionStatusBody(base, next)); err != nil {
		return nil, err
	}
	if err = writeCompletionAuditTx(ctx, tx, fmt.Sprint(c.projectID), fmt.Sprint(c.itemID), c.operator, fmt.Sprintf("workflow:%d:%s", c.instanceID, c.status), "completion_result", map[string]any{"requestId": c.requestID, "workflowInstanceId": c.instanceID, "status": c.status, "to": next, "approvalActorUids": c.approvers, "nonSelfApprovalActorUids": c.nonSelf}); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"requestId": c.requestID, "workItemId": c.itemID, "status": c.status, "workItemStatus": next}, nil
}

// ACK may follow an immediate approved callback. Bind the same instance in
// either order, and never reopen a terminal request when its ACK arrives late.
func completionActorEvidence(value any) []string {
	var values []any
	switch v := value.(type) {
	case []any:
		values = v
	case []string:
		for _, s := range v {
			values = append(values, s)
		}
	default:
		return nil
	}
	if len(values) > 100 {
		return nil
	}
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		uid, ok := value.(string)
		if !ok || uid == "" || strings.TrimSpace(uid) != uid || !utf8.ValidString(uid) || utf8.RuneCountInString(uid) > 50 || seen[uid] {
			return nil
		}
		for _, character := range uid {
			if character < 32 || character == 127 {
				return nil
			}
		}
		seen[uid] = true
		result = append(result, uid)
	}
	return result
}
func completionContains(values []string, uid string) bool {
	for _, value := range values {
		if value == uid {
			return true
		}
	}
	return false
}

func completeWorkItemCompletionWorkflowTx(ctx context.Context, tx *sql.Tx, command, body map[string]any) error {
	id, no := serviceBodyInt(body, "workflowInstanceId"), strings.TrimSpace(firstBodyText(body, "workflowInstanceNo"))
	if id <= 0 || no == "" {
		return httperror.New(409, "work_item_completion_receipt_instance_required", "Workflow receipt requires its instance binding")
	}
	var instance sql.NullInt64
	var existingNo, hash, actor, kind string
	err := tx.QueryRowContext(ctx, "SELECT workflow_instance_id,COALESCE(workflow_instance_no,''),snapshot_sha256,requested_by,kind FROM work_item_completion_requests WHERE id=? AND work_item_id=? AND project_id=? FOR UPDATE", command["completionRequestId"], command["workItemId"], command["projectId"]).Scan(&instance, &existingNo, &hash, &actor, &kind)
	if err != nil {
		return err
	}
	commandKind := "target"
	if command["kind"] == "matter" {
		commandKind = "matter"
	}
	if kind != commandKind || hash != command["snapshotSha256"] || actor != command["actorUid"] || (instance.Valid && (instance.Int64 != int64(id) || existingNo != no)) {
		return httperror.New(409, "work_item_completion_receipt_instance_mismatch", "Workflow receipt does not match the frozen request")
	}
	_, err = tx.ExecContext(ctx, "UPDATE work_item_completion_requests SET workflow_instance_id=?,workflow_instance_no=?,target_receipt_id=?,status=IF(status='queued','running',status),updated_at=UTC_TIMESTAMP(6) WHERE id=?", id, no, firstBodyText(body, "targetReceiptId"), command["completionRequestId"])
	return err
}
