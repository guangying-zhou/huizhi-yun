package unified

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const completionWorkflowOperation = "aims.work-item.completion.workflow-submit.v1"
const completionItemFields = "id project_id item_key title description priority assignee_uid start_date due_date estimated_hours status type tier milestone_id parent_id version_id feature_id"

func completionDigest(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func completionHash(value string) bool {
	return len(value) == 64 && value == strings.ToLower(value) && hexOnlySnapshot(value)
}

// The writer freezes database map values (including nullable fields), not a
// newly invented DTO. Re-marshalling this map preserves its actual hash order.
func completionFrozenSnapshot(value map[string]any, project, item int64, hash string) bool {
	if len(value) != 2 || !contractKeys(value, "item children") || completionDigest(value) != hash {
		return false
	}
	target, ok := value["item"].(map[string]any)
	if !ok || len(target) != len(strings.Fields(completionItemFields)) || !contractKeys(target, completionItemFields) || contractInt(target["id"]) != item || contractInt(target["project_id"]) != project || target["tier"] != "target" || target["type"] == "requirement" || target["status"] != "in_progress" || !contractText(target["item_key"]) || !contractText(target["title"]) {
		return false
	}
	children, ok := value["children"].([]any)
	if !ok || len(children) == 0 {
		return false
	}
	previous := int64(0)
	for _, entry := range children {
		child, ok := entry.(map[string]any)
		if !ok || len(child) != 3 || !contractKeys(child, "id status version") || contractInt(child["id"]) <= previous || contractInt(child["id"]) == item || child["status"] != "completed" {
			return false
		}
		h, ok := child["version"].(string)
		if !ok || !completionHash(h) {
			return false
		}
		previous = contractInt(child["id"])
	}
	return true
}

func inspectCompletionRequests(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ready, err := hasTables(ctx, q, schema, "work_item_completion_requests")
	if err != nil {
		return nil, err
	}
	if !ready {
		history, historyErr := inspectCompletionHistory(ctx, q, schema)
		if historyErr != nil {
			return nil, historyErr
		}
		operations, err := hasTables(ctx, q, schema, "integration_operation")
		if err != nil || !operations {
			return history, err
		}
		return appendConflictRows(ctx, q, history, "aims.integration_operation", "SELECT 'completion_request_table_missing',operation_id,1 FROM "+qualified(schema, "integration_operation")+" WHERE source_biz_type='work_item_completion_request'")
	}
	issues := []MigrationConflict{}
	block := func(kind string, id int64) {
		issues = append(issues, MigrationConflict{Kind: kind, Source: "aims.work_item_completion_requests", KeySHA256: redactedBusinessKey(kind, stringID(id)), RowCount: 1})
	}
	dependencies := []string{"work_items", "aims_projects", "project_activity_logs", "service_command_receipt", "integration_operation", "work_item_changelog"}
	ready, err = hasTables(ctx, q, schema, dependencies...)
	if err != nil {
		return nil, err
	}
	if operations, err := hasTables(ctx, q, schema, "integration_operation"); err != nil {
		return nil, err
	} else if operations {
		issues, err = appendConflictRows(ctx, q, issues, "aims.integration_operation", "SELECT 'completion_outbox_request_reference_invalid',o.operation_id,1 FROM "+qualified(schema, "integration_operation")+" o LEFT JOIN "+qualified(schema, "work_item_completion_requests")+" r ON BINARY CAST(r.id AS CHAR)=BINARY o.source_biz_code AND BINARY r.operation_key=BINARY o.operation_key WHERE o.source_biz_type='work_item_completion_request' AND (r.id IS NULL OR o.source_app<>'aims' OR o.target_app<>'workflow' OR o.operation_code<>'"+completionWorkflowOperation+"' OR o.command_schema_version<>'v1' OR BINARY o.idempotency_key<>BINARY r.operation_key)")
		if err != nil {
			return nil, err
		}
	}
	type request struct {
		id, project, item                int64
		actor, hash, review, status, key string
		instance                         *int64
		instanceNo, targetReceipt        *string
		raw                              []byte
	}
	rows, err := q.QueryContext(ctx, "SELECT id,project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,status,operation_key,workflow_instance_id,workflow_instance_no,target_receipt_id FROM "+qualified(schema, "work_item_completion_requests")+" ORDER BY id")
	if err != nil {
		return nil, err
	}
	requests := []request{}
	for rows.Next() {
		var r request
		if err = rows.Scan(&r.id, &r.project, &r.item, &r.actor, &r.raw, &r.hash, &r.review, &r.status, &r.key, &r.instance, &r.instanceNo, &r.targetReceipt); err != nil {
			rows.Close()
			return nil, err
		}
		requests = append(requests, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, r := range requests {
		frozen, e := contractObject(r.raw)
		valid := ready && e == nil && r.id > 0 && r.project > 0 && r.item > 0 && contractText(r.actor) && r.actor == strings.TrimSpace(r.actor) && contractString(r.actor, 50) && completionHash(r.hash) && completionHash(r.review) && completionFrozenSnapshot(frozen, r.project, r.item, r.hash) && r.key == fmt.Sprintf("aims:work-item-completion:%d:workflow-submit:v1", r.id)
		knownStatus := r.status == "queued" || r.status == "running" || r.status == "approved" || r.status == "rejected" || r.status == "cancelled"
		// Workflow IDs belong to Workflow. Check their paired shape, never rewrite
		// or require them to reference Aims IDs or local migration table mapping.
		valid = valid && knownStatus && ((r.instance == nil && r.instanceNo == nil) || (r.instance != nil && *r.instance > 0 && r.instanceNo != nil && contractText(*r.instanceNo)))
		if r.status != "queued" && (r.instance == nil || r.instanceNo == nil) {
			valid = false
		}
		if r.targetReceipt != nil && (!contractText(*r.targetReceipt) || !contractString(*r.targetReceipt, 64)) {
			valid = false
		}
		if !valid {
			block("completion_snapshot_contract_invalid", r.id)
			continue
		}
		review := map[string]any{}
		for key, value := range frozen["item"].(map[string]any) {
			review[key] = value
		}
		review["status"] = "in_review"
		if r.review != completionDigest(review) {
			block("completion_review_hash_invalid", r.id)
			continue
		}
		found, e := contractReference(ctx, q, schema, "work_items", "id=? AND project_id=?", r.item, r.project)
		if e != nil {
			return nil, e
		}
		if !found {
			block("completion_item_reference_invalid", r.id)
			continue
		}
		found, e = contractReference(ctx, q, schema, "aims_projects", "id=?", r.project)
		if e != nil {
			return nil, e
		}
		if !found {
			block("completion_project_reference_invalid", r.id)
			continue
		}
		// Historical children may later change. Identity/project/parent must remain
		// bound; mutable status/version is enforced by the live approval consumer.
		for _, entry := range frozen["children"].([]any) {
			child := entry.(map[string]any)
			found, e = contractReference(ctx, q, schema, "work_items", "id=? AND project_id=? AND parent_id=?", child["id"], r.project, r.item)
			if e != nil {
				return nil, e
			}
			if !found {
				block("completion_child_reference_invalid", r.id)
				valid = false
			}
		}
		if !valid {
			continue
		}
		found, e = contractReference(ctx, q, schema, "project_activity_logs", "project_id=? AND object_type='work_item' AND object_code=? AND action='completion_request' AND BINARY actor_uid=BINARY ? AND JSON_EXTRACT(changes,'$.requestId')=? AND BINARY JSON_UNQUOTE(JSON_EXTRACT(changes,'$.snapshotSha256'))=BINARY ? AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.from'))='in_progress' AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.to'))='in_review' AND EXISTS (SELECT 1 FROM "+qualified(schema, "service_command_receipt")+" receipt WHERE receipt.status='succeeded' AND receipt.operation_code='enterprise.aims.work-items.complete.v1' AND receipt.target_biz_type='work_item_completion_request' AND receipt.target_biz_code=? AND receipt.command_schema_version='work-item-complete.v1' AND BINARY receipt.command_sha256=BINARY ? AND BINARY receipt.original_actor_uid=BINARY actor_uid AND BINARY receipt.idempotency_key=BINARY request_id)", r.project, stringID(r.item), r.actor, r.id, r.hash, stringID(r.id), completionDigest(map[string]any{"projectId": stringID(r.project), "workItemId": stringID(r.item), "input": map[string]any{"expectedVersion": completionDigest(frozen["item"])}}))
		if e != nil {
			return nil, e
		}
		if !found {
			block("completion_request_receipt_audit_invalid", r.id)
		}
		commandRows, e := q.QueryContext(ctx, "SELECT command_json,command_sha256,operation_code,command_schema_version,source_app,target_app,source_biz_type,source_biz_code,idempotency_key FROM "+qualified(schema, "integration_operation")+" WHERE BINARY operation_key=BINARY ?", r.key)
		if e != nil {
			return nil, e
		}
		count := 0
		for commandRows.Next() {
			var raw []byte
			var hash, operation, version, source, target, kind, code, key string
			if e = commandRows.Scan(&raw, &hash, &operation, &version, &source, &target, &kind, &code, &key); e != nil {
				commandRows.Close()
				return nil, e
			}
			command, ce := contractObject(raw)
			digest, de := integrationoperation.ValidateAndDigestCommand(command)
			expected := map[string]any{"completionRequestId": r.id, "workItemId": r.item, "workItemKey": frozen["item"].(map[string]any)["item_key"], "projectId": r.project, "actorUid": r.actor, "snapshotSha256": r.hash, "bizTitle": frozen["item"].(map[string]any)["title"], "bizContext": map[string]any{"project_id": r.project}, "formData": map[string]any{"completionRequestId": r.id, "workItemId": r.item, "projectId": r.project, "snapshotSha256": r.hash}, "idempotencyKey": r.key}
			if ce == nil && de == nil && digest == hash && contractJSONEqual(command, expected) && operation == completionWorkflowOperation && version == "v1" && source == "aims" && target == "workflow" && kind == "work_item_completion_request" && code == stringID(r.id) && key == r.key {
				count++
			}
		}
		e = commandRows.Err()
		commandRows.Close()
		if e != nil {
			return nil, e
		}
		if count != 1 {
			block("completion_outbox_command_invalid", r.id)
		}
	}
	if audits, err := hasTables(ctx, q, schema, "project_activity_logs"); err != nil {
		return nil, err
	} else if audits {
		issues, err = appendConflictRows(ctx, q, issues, "aims.project_activity_logs", "SELECT 'completion_request_audit_reference_invalid',CAST(a.id AS CHAR),1 FROM "+qualified(schema, "project_activity_logs")+" a LEFT JOIN "+qualified(schema, "work_item_completion_requests")+" r ON r.id=JSON_EXTRACT(a.changes,'$.requestId') AND r.project_id=a.project_id AND BINARY CAST(r.work_item_id AS CHAR)=BINARY a.object_code AND BINARY r.requested_by=BINARY a.actor_uid AND BINARY r.snapshot_sha256=BINARY JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.snapshotSha256')) WHERE a.object_type='work_item' AND a.action='completion_request' AND (r.id IS NULL OR JSON_LENGTH(a.changes)<>4 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.from')),'')<>'in_progress' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.to')),'')<>'in_review')")
		if err != nil {
			return nil, err
		}
	}
	history, err := inspectCompletionHistory(ctx, q, schema)
	return append(issues, history...), err
}
