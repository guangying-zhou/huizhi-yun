package unified

import "context"

// Edit stores ProductVersionDetail; transition stores a five-field result.
// Current mutable code/name/status are not compared to historical snapshots.
func inspectVersionMutationJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	referenceCondition, refErr := editReferences(ctx, q, schema)
	if refErr != nil {
		return nil, refErr
	}
	r := qualified(schema, "product_command_receipts")
	v := qualified(schema, "product_versions")
	w := qualified(schema, "product_workspaces")
	a := qualified(schema, "product_activity_logs")
	query := `SELECT 'version_mutation_receipt_invalid',CAST(r.id AS CHAR),1 FROM ` + r + ` r LEFT JOIN ` + v + ` v ON v.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,IF(r.action='product_versions:edit','$.id','$.version_id'))) AS UNSIGNED) LEFT JOIN ` + w + ` w ON BINARY w.product_code=BINARY r.product_code
 WHERE r.action IN ('product_versions:edit','product_versions:transition') AND (r.result_json IS NULL OR r.status<>'succeeded' OR r.request_hash NOT REGEXP '^[0-9a-f]{64}$' OR JSON_TYPE(r.result_json)<>'OBJECT'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,IF(r.action='product_versions:edit','$.id','$.version_id'))),'')<>'INTEGER'
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.revision')),'')<>'INTEGER' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.workspace_revision')),'')<>'INTEGER'
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.product_code')),'')<>r.product_code OR (v.id IS NULL AND (r.action<>'product_versions:edit' OR NOT (` + deletedVersionEditHistory(schema) + `))) OR BINARY v.product_code<>BINARY r.product_code OR w.product_code IS NULL
 OR COALESCE(JSON_EXTRACT(r.result_json,'$.revision'),0)<2 OR JSON_EXTRACT(r.result_json,'$.revision')>v.revision OR COALESCE(JSON_EXTRACT(r.result_json,'$.workspace_revision'),0)<2 OR JSON_EXTRACT(r.result_json,'$.workspace_revision')>w.revision
 OR (r.action='product_versions:transition' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'')<>'developing' OR JSON_LENGTH(JSON_REMOVE(r.result_json,'$.version_id','$.product_code','$.status','$.revision','$.workspace_revision'))<>0))
 OR (r.action='product_versions:edit' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'') NOT IN ('planning','developing') OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.version_code')),'')='' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.scope_revision')),'')<>'INTEGER' OR COALESCE(JSON_EXTRACT(r.result_json,'$.scope_revision'),0)<1 OR JSON_EXTRACT(r.result_json,'$.scope_revision')>v.scope_revision OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.planning_mode')),'') NOT IN ('simple','cycle') OR ` + referenceCondition + ` OR JSON_LENGTH(JSON_REMOVE(r.result_json,'$.id','$.product_code','$.version_code','$.name','$.description','$.planned_release_date','$.planning_mode','$.status','$.revision','$.scope_revision','$.workspace_revision','$.owner_project_id','$.business_owner_uid','$.current_release_record_id'))<>0))) ORDER BY r.id`
	issues, err := appendConflictRows(ctx, q, nil, "aims.product_command_receipts", query)
	if err != nil {
		return nil, err
	}
	query = `SELECT 'version_mutation_audit_invalid',CAST(a.id AS CHAR),1 FROM ` + a + ` a WHERE a.action IN ('edit','transition') AND a.object_type='version' AND (JSON_TYPE(a.changes)<>'OBJECT' OR COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.reason')),'')<>'STRING' OR TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.reason')))='' OR NOT EXISTS (SELECT 1 FROM ` + r + ` r WHERE r.action=CONCAT('product_versions:',a.action) AND r.status='succeeded' AND BINARY r.product_code=BINARY a.product_code AND BINARY r.actor_uid=BINARY a.actor_uid AND BINARY r.idempotency_key=BINARY a.request_id AND JSON_EXTRACT(r.result_json,'$.revision')=a.revision AND CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,IF(a.action='edit','$.id','$.version_id'))) AS CHAR)=a.object_id
 AND ((a.action='transition' AND CAST(JSON_EXTRACT(a.changes,'$.result') AS CHAR)=CAST(r.result_json AS CHAR) AND JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.from_status'))='planning' AND JSON_LENGTH(JSON_REMOVE(a.changes,'$.result','$.reason','$.from_status'))=0)
 OR (a.action='edit' AND CAST(JSON_EXTRACT(a.changes,'$.after') AS CHAR)=CAST(JSON_REMOVE(r.result_json,'$.workspace_revision') AS CHAR) AND JSON_EXTRACT(a.changes,'$.before.id')=JSON_EXTRACT(r.result_json,'$.id') AND JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.before.product_code'))=r.product_code AND JSON_EXTRACT(a.changes,'$.before.revision')+1=JSON_EXTRACT(r.result_json,'$.revision') AND JSON_LENGTH(JSON_REMOVE(a.changes,'$.before','$.after','$.reason'))=0)))) ORDER BY a.id`
	return appendConflictRows(ctx, q, issues, "aims.product_activity_logs", query)
}
