package unified

import (
	"context"
	"fmt"
	"strings"
)

type completionResultChange struct {
	RequestID          int64    `json:"requestId"`
	WorkflowInstanceID int64    `json:"workflowInstanceId"`
	Status             string   `json:"status"`
	To                 string   `json:"to"`
	Approvers          []string `json:"approvalActorUids"`
	NonSelf            []string `json:"nonSelfApprovalActorUids"`
}
type completionReplayChange struct {
	RequestID   int64  `json:"requestId"`
	OperationID string `json:"operationId"`
	Reason      string `json:"reason"`
	Version     uint64 `json:"operationVersion"`
}

func completionActorList(list []string) bool {
	seen := map[string]bool{}
	for _, uid := range list {
		if !contractText(uid) || uid != strings.TrimSpace(uid) || !contractString(uid, 50) || seen[uid] {
			return false
		}
		for _, ch := range uid {
			if ch < 32 || ch == 127 {
				return false
			}
		}
		seen[uid] = true
	}
	return true
}
func completionHasActor(list []string, uid string) bool {
	for _, v := range list {
		if v == uid {
			return true
		}
	}
	return false
}

func inspectCompletionHistory(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ready, err := hasTables(ctx, q, schema, "work_item_completion_requests", "project_activity_logs", "service_command_receipt", "integration_operation", "work_item_changelog")
	if err != nil {
		return nil, err
	}
	if !ready {
		audits, err := hasTables(ctx, q, schema, "project_activity_logs")
		if err != nil || !audits {
			return nil, err
		}
		return appendConflictRows(ctx, q, nil, "aims.project_activity_logs", "SELECT 'completion_history_dependency_missing',CAST(id AS CHAR),1 FROM "+qualified(schema, "project_activity_logs")+" WHERE object_type='work_item' AND action IN ('completion_result','completion_replay')")
	}
	type audit struct {
		id, project              int64
		item, action, actor, key string
		raw                      []byte
	}
	rows, err := q.QueryContext(ctx, "SELECT id,project_id,object_code,action,actor_uid,request_id,changes FROM "+qualified(schema, "project_activity_logs")+" WHERE object_type='work_item' AND action IN ('completion_result','completion_replay') ORDER BY id")
	if err != nil {
		return nil, err
	}
	audits := []audit{}
	for rows.Next() {
		var a audit
		if err = rows.Scan(&a.id, &a.project, &a.item, &a.action, &a.actor, &a.key, &a.raw); err != nil {
			rows.Close()
			return nil, err
		}
		audits = append(audits, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	issues := []MigrationConflict{}
	terminalProof := map[int64]int{}
	replayVersions := map[int64]uint64{}
	block := func(kind string, id int64) {
		issues = append(issues, MigrationConflict{Kind: kind, Source: "aims.project_activity_logs", KeySHA256: redactedBusinessKey(kind, stringID(id)), RowCount: 1})
	}
	for _, a := range audits {
		change, e := contractObject(a.raw)
		valid := e == nil && contractText(a.actor) && contractText(a.key)
		var requestID int64
		var result completionResultChange
		var replay completionReplayChange
		if a.action == "completion_result" {
			valid = valid && consumptionShape(change, &result)
			requestID = result.RequestID
		} else {
			valid = valid && consumptionShape(change, &replay)
			requestID = replay.RequestID
		}
		if !valid || requestID <= 0 {
			block("completion_history_shape_invalid", a.id)
			continue
		}
		refRows, e := q.QueryContext(ctx, "SELECT requested_by,status,workflow_instance_id,operation_key FROM "+qualified(schema, "work_item_completion_requests")+" WHERE id=? AND project_id=? AND CAST(work_item_id AS CHAR)=?", requestID, a.project, a.item)
		if e != nil {
			return nil, e
		}
		var initiator, status, operationKey string
		var instance *int64
		found := refRows.Next()
		if found {
			e = refRows.Scan(&initiator, &status, &instance, &operationKey)
		}
		if e == nil {
			e = refRows.Err()
		}
		refRows.Close()
		if e != nil {
			return nil, e
		}
		if !found {
			block("completion_history_request_invalid", a.id)
			continue
		}
		paired, e := contractReference(ctx, q, schema, "work_item_changelog", "CAST(work_item_id AS CHAR)=? AND field_name='completion_workflow' AND BINARY changed_by=BINARY ? AND JSON_VALID(new_value)=1 AND CAST(new_value AS JSON)=CAST(? AS JSON)", a.item, a.actor, a.raw)
		if e != nil {
			return nil, e
		}
		valid = valid && paired
		if a.action == "completion_result" {
			valid = valid && result.Status == status && instance != nil && result.WorkflowInstanceID == *instance && a.key == fmt.Sprintf("workflow:%d:%s", result.WorkflowInstanceID, result.Status) && completionActorList(result.Approvers) && completionActorList(result.NonSelf)
			if result.Status == "cancelled" {
				valid = valid && a.actor == initiator && result.To == "in_progress" && result.Approvers == nil && result.NonSelf == nil
			} else {
				valid = valid && (result.Status == "approved" || result.Status == "rejected") && len(result.Approvers) > 0 && completionHasActor(result.Approvers, a.actor)
				for _, uid := range result.NonSelf {
					if uid == initiator || !completionHasActor(result.Approvers, uid) {
						valid = false
					}
				}
				if result.Status == "approved" {
					valid = valid && result.To == "completed" && a.actor != initiator && len(result.NonSelf) > 0
				} else {
					valid = valid && result.To == "in_progress"
				}
			}
			if valid {
				terminalProof[requestID]++
			}
		} else {
			valid = valid && terminalProof[requestID] == 0 && replay.Version >= 2 && replay.Version > replayVersions[requestID] && contractText(replay.Reason) && contractText(replay.OperationID)
			if valid {
				valid, e = contractReference(ctx, q, schema, "integration_operation", "operation_id=? AND BINARY operation_key=BINARY ? AND source_biz_type='work_item_completion_request' AND source_biz_code=? AND operation_code=? AND version_no>=?", replay.OperationID, operationKey, stringID(requestID), completionWorkflowOperation, replay.Version)
				if e != nil {
					return nil, e
				}
			}
			if valid {
				input := map[string]any{"projectId": stringID(a.project), "workItemId": a.item, "input": map[string]any{"expectedOperationVersion": replay.Version - 1, "reason": replay.Reason}}
				valid, e = contractReference(ctx, q, schema, "service_command_receipt", "operation_code='enterprise.aims.work-items.completion-replay.v1' AND command_schema_version='completion-replay.v1' AND status='succeeded' AND target_biz_type='work_item_completion_request' AND target_biz_code=? AND BINARY original_actor_uid=BINARY ? AND BINARY idempotency_key=BINARY ? AND BINARY command_sha256=BINARY ?", stringID(requestID), a.actor, a.key, completionDigest(input))
				if e != nil {
					return nil, e
				}
			}
			if valid {
				replayVersions[requestID] = replay.Version
			}
		}
		if !valid {
			block("completion_history_evidence_invalid", a.id)
		}
	}
	terminalRows, err := q.QueryContext(ctx, "SELECT id FROM "+qualified(schema, "work_item_completion_requests")+" WHERE status IN ('approved','rejected','cancelled') ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer terminalRows.Close()
	for terminalRows.Next() {
		var id int64
		if err = terminalRows.Scan(&id); err != nil {
			return nil, err
		}
		if terminalProof[id] != 1 {
			issues = append(issues, MigrationConflict{Kind: "completion_terminal_audit_missing_or_duplicate", Source: "aims.work_item_completion_requests", KeySHA256: redactedBusinessKey("completion-terminal", stringID(id)), RowCount: 1})
		}
	}
	return issues, terminalRows.Err()
}
