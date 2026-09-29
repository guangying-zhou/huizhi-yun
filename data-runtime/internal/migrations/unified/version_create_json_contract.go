package unified

import "context"

// The persisted action is the legacy discriminator: versions.go emits this
// result without schemaVersion. Unknown actions or added schema markers must
// obtain a new explicit migration contract, never an unconditional allowlist.
func inspectVersionCreateJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ok, err := hasTables(ctx, q, schema, "product_command_receipts", "product_activity_logs", "product_versions", "product_workspaces")
	if err != nil || !ok {
		return nil, err
	}
	receipt := qualified(schema, "product_command_receipts")
	version := qualified(schema, "product_versions")
	workspace := qualified(schema, "product_workspaces")
	audit := qualified(schema, "product_activity_logs")
	query := `SELECT 'version_create_receipt_snapshot_invalid',CAST(r.id AS CHAR),1 FROM ` + receipt + ` r
 LEFT JOIN ` + version + ` v ON v.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.id')) AS UNSIGNED)
 LEFT JOIN ` + workspace + ` w ON BINARY w.product_code=BINARY r.product_code
 WHERE r.result_json IS NOT NULL AND r.action NOT IN ('product_versions:edit','product_versions:transition','product_versions:archive','product_versions:reopen','product_versions:delete','product_versions:accept','product_versions:publish','product_versions:plan-edit','product_versions:plan-item-create','product_versions:plan-item-edit','product_versions:plan-item-delete','product_versions:plan-confirm','product_versions:scope-create','product_versions:scope-edit','product_versions:scope-reopen','product_versions:scope-deliver','product_priorities:consumption-confirm','product_priorities:withdraw','products:onboard','products:edit','products:onboard-line') AND (
 r.action<>'product_versions:create' OR r.status<>'succeeded' OR r.request_hash NOT REGEXP '^[0-9a-f]{64}$'
 OR JSON_TYPE(r.result_json)<>'OBJECT'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.id')),'')<>'INTEGER'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.revision')),'')<>'INTEGER'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.scope_revision')),'')<>'INTEGER'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.workspace_revision')),'')<>'INTEGER'
 OR JSON_LENGTH(JSON_REMOVE(r.result_json,'$.id','$.product_code','$.version_code','$.name','$.description','$.planned_release_date','$.planning_mode','$.status','$.revision','$.scope_revision','$.workspace_revision','$.owner_project_id','$.business_owner_uid'))<>0
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.product_code')),'')<>r.product_code
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'')<>'planning'
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.planning_mode')),'') NOT IN ('simple','cycle')
 OR COALESCE(JSON_EXTRACT(r.result_json,'$.revision'),0)<>1 OR COALESCE(JSON_EXTRACT(r.result_json,'$.scope_revision'),0)<>1
 OR (v.id IS NULL AND NOT ` + deletedVersionProof(schema, "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.id')) AS UNSIGNED)", "r.product_code") + `) OR BINARY v.product_code<>BINARY r.product_code
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.version_code')),'')=''
 OR w.product_code IS NULL OR COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.workspace_revision')) AS UNSIGNED),0)<2
 OR w.revision<CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.workspace_revision')) AS UNSIGNED)) ORDER BY r.id`
	issues, err := appendConflictRows(ctx, q, nil, "aims.product_command_receipts", query)
	if err != nil {
		return nil, err
	}
	query = `SELECT 'version_create_audit_snapshot_invalid',CAST(a.id AS CHAR),1 FROM ` + audit + ` a WHERE a.changes IS NOT NULL AND a.action NOT IN ('edit','transition','archive','reopen','delete','accept','publish','plan-edit','plan-item-create','plan-item-edit','plan-item-delete','plan-confirm','scope-create','scope-edit','scope-reopen','scope-deliver','scope-defer','consumption-confirm','withdraw','onboard','onboard-line') AND (a.object_type<>'version' OR a.action<>'create' OR NOT EXISTS (
 SELECT 1 FROM ` + receipt + ` r WHERE r.action='product_versions:create' AND r.status='succeeded' AND BINARY r.product_code=BINARY a.product_code AND BINARY r.actor_uid=BINARY a.actor_uid AND BINARY r.idempotency_key=BINARY a.request_id
 AND CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.id')) AS CHAR)=a.object_id AND CAST(r.result_json AS CHAR)=CAST(a.changes AS CHAR))) ORDER BY a.id`
	issues, err = appendConflictRows(ctx, q, issues, "aims.product_activity_logs", query)
	if err != nil {
		return nil, err
	}
	mutationIssues, err := inspectVersionMutationJSON(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, mutationIssues...)
	life, err := inspectVersionLifecycleJSON(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, life...)
	snapshots, err := inspectAcceptanceReleaseSnapshots(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, snapshots...)
	receipts, err := inspectAcceptPublishReceipts(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, receipts...)
	plans, err := inspectPlanConfirmationJSON(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, plans...)
	commands, err := inspectPlanCommandJSON(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, commands...)
	scopes, err := inspectScopeCommandJSON(ctx, q, schema)
	if err != nil {
		return nil, err
	}
	issues = append(issues, scopes...)
	consumption, err := inspectConsumptionJSON(ctx, q, schema)
	return append(issues, consumption...), err
}
