package unified

import "context"

func deletedVersionProof(schema, id, product string) string {
	return `EXISTS (SELECT 1 FROM ` + qualified(schema, "product_activity_logs") + ` d JOIN ` + qualified(schema, "product_command_receipts") + ` t ON t.action='product_versions:delete' AND t.status='succeeded' AND BINARY t.actor_uid=BINARY d.actor_uid AND BINARY t.idempotency_key=BINARY d.request_id AND BINARY t.product_code=BINARY d.product_code WHERE d.object_type='version' AND d.action='delete' AND d.object_id=CAST(` + id + ` AS CHAR) AND BINARY d.product_code=BINARY ` + product + ` AND JSON_EXTRACT(d.changes,'$.before.id')=` + id + ` AND JSON_UNQUOTE(JSON_EXTRACT(d.changes,'$.before.product_code'))=` + product + ` AND JSON_UNQUOTE(JSON_EXTRACT(d.changes,'$.before.status'))='planning' AND JSON_TYPE(JSON_EXTRACT(d.changes,'$.before.current_release_record_id'))='NULL' AND JSON_EXTRACT(d.changes,'$.before.revision')+1=JSON_EXTRACT(t.result_json,'$.revision') AND JSON_EXTRACT(t.result_json,'$.deleted')=TRUE AND CAST(JSON_EXTRACT(d.changes,'$.result') AS CHAR)=CAST(t.result_json AS CHAR))`
}

func deletedVersionEditHistory(schema string) string {
	id := "JSON_EXTRACT(r.result_json,'$.id')"
	proof := deletedVersionProof(schema, id, "r.product_code")
	// Extend the same verified frozen audit, rather than trusting an unrelated
	// second event that could claim a higher revision.
	return proof[:len(proof)-1] + ` AND JSON_EXTRACT(d.changes,'$.before.revision')>=JSON_EXTRACT(r.result_json,'$.revision') AND JSON_EXTRACT(d.changes,'$.before.scope_revision')>=JSON_EXTRACT(r.result_json,'$.scope_revision') AND JSON_EXTRACT(t.result_json,'$.workspace_revision')>JSON_EXTRACT(r.result_json,'$.workspace_revision') AND EXISTS (SELECT 1 FROM ` + qualified(schema, "product_activity_logs") + ` e WHERE e.id<d.id AND e.action='edit' AND e.object_type='version' AND BINARY e.actor_uid=BINARY r.actor_uid AND BINARY e.request_id=BINARY r.idempotency_key AND BINARY e.product_code=BINARY r.product_code AND e.object_id=CAST(JSON_EXTRACT(r.result_json,'$.id') AS CHAR) AND CAST(JSON_EXTRACT(e.changes,'$.after') AS CHAR)=CAST(JSON_REMOVE(r.result_json,'$.workspace_revision') AS CHAR))) AND JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status'))='planning'`
}

func editReferences(ctx context.Context, q querier, schema string) (string, error) {
	owner := `COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.owner_project_id')),'NULL')='NULL'`
	release := `COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.current_release_record_id')),'NULL')='NULL'`
	if ok, err := hasTables(ctx, q, schema, "aims_projects"); err != nil {
		return "", err
	} else if ok {
		owner += ` OR JSON_TYPE(JSON_EXTRACT(r.result_json,'$.owner_project_id'))='INTEGER' AND EXISTS (SELECT 1 FROM ` + qualified(schema, "aims_projects") + ` p WHERE p.id=JSON_EXTRACT(r.result_json,'$.owner_project_id'))`
	}
	if ok, err := hasTables(ctx, q, schema, "product_release_records"); err != nil {
		return "", err
	} else if ok {
		release += ` OR JSON_TYPE(JSON_EXTRACT(r.result_json,'$.current_release_record_id'))='INTEGER' AND EXISTS (SELECT 1 FROM ` + qualified(schema, "product_release_records") + ` l WHERE l.id=JSON_EXTRACT(r.result_json,'$.current_release_record_id') AND l.version_id=v.id)`
	}
	return `NOT ((` + owner + `) AND (` + release + `))`, nil
}

func inspectVersionLifecycleJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	receipt := qualified(schema, "product_command_receipts")
	audit := qualified(schema, "product_activity_logs")
	version := qualified(schema, "product_versions")
	workspace := qualified(schema, "product_workspaces")
	releaseProof := "FALSE"
	if ok, err := hasTables(ctx, q, schema, "product_release_records", "product_release_events"); err != nil {
		return nil, err
	} else if ok {
		releaseProof = `EXISTS (SELECT 1 FROM ` + qualified(schema, "product_release_records") + ` l WHERE l.id=JSON_EXTRACT(r.result_json,'$.release_record_id') AND l.version_id=JSON_EXTRACT(r.result_json,'$.version_id') AND (r.action<>'product_versions:reopen' OR EXISTS (SELECT 1 FROM ` + qualified(schema, "product_release_events") + ` e WHERE e.release_record_id=l.id AND e.event_type='withdrawn' AND BINARY e.actor_uid=BINARY r.actor_uid)))`
	}
	query := `SELECT 'version_lifecycle_receipt_invalid',CAST(r.id AS CHAR),1 FROM ` + receipt + ` r LEFT JOIN ` + version + ` v ON v.id=JSON_EXTRACT(r.result_json,'$.version_id') LEFT JOIN ` + workspace + ` w ON BINARY w.product_code=BINARY r.product_code WHERE r.action IN ('product_versions:archive','product_versions:reopen','product_versions:delete') AND (r.status<>'succeeded' OR r.result_json IS NULL OR r.request_hash NOT REGEXP '^[0-9a-f]{64}$' OR JSON_TYPE(r.result_json)<>'OBJECT' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.version_id')),'')<>'INTEGER' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.revision')),'')<>'INTEGER' OR COALESCE(JSON_EXTRACT(r.result_json,'$.revision'),0)<2 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.scope_revision')),'')<>'INTEGER' OR COALESCE(JSON_EXTRACT(r.result_json,'$.scope_revision'),0)<1 OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.workspace_revision')),'')<>'INTEGER' OR w.product_code IS NULL OR COALESCE(JSON_EXTRACT(r.result_json,'$.workspace_revision'),0)<2 OR JSON_EXTRACT(r.result_json,'$.workspace_revision')>w.revision
 OR (r.action='product_versions:delete' AND (v.id IS NOT NULL OR NOT ` + deletedVersionProof(schema, "JSON_EXTRACT(r.result_json,'$.version_id')", "r.product_code") + ` OR JSON_LENGTH(JSON_REMOVE(r.result_json,'$.version_id','$.product_code','$.deleted','$.revision','$.workspace_revision','$.scope_revision','$.release_record_id'))<>0))
 OR (r.action<>'product_versions:delete' AND (v.id IS NULL OR BINARY v.product_code<>BINARY r.product_code OR JSON_EXTRACT(r.result_json,'$.revision')>v.revision OR JSON_EXTRACT(r.result_json,'$.scope_revision')>v.scope_revision OR NOT (` + releaseProof + `) OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'')<>IF(r.action='product_versions:archive','archived','developing') OR JSON_LENGTH(JSON_REMOVE(r.result_json,'$.version_id','$.product_code','$.release_record_id','$.status','$.revision','$.workspace_revision','$.scope_revision'))<>0)))`
	issues, err := appendConflictRows(ctx, q, nil, "aims.product_command_receipts", query)
	if err != nil {
		return nil, err
	}
	query = `SELECT 'version_lifecycle_audit_invalid',CAST(a.id AS CHAR),1 FROM ` + audit + ` a WHERE a.action IN ('archive','reopen','delete') AND (a.object_type<>'version' OR COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.reason')),'')<>'STRING' OR TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.reason')))='' OR NOT EXISTS (SELECT 1 FROM ` + receipt + ` r WHERE r.action=CONCAT('product_versions:',a.action) AND r.status='succeeded' AND BINARY r.product_code=BINARY a.product_code AND BINARY r.actor_uid=BINARY a.actor_uid AND BINARY r.idempotency_key=BINARY a.request_id AND JSON_EXTRACT(r.result_json,'$.revision')=a.revision AND CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.version_id')) AS CHAR)=a.object_id AND CAST(JSON_EXTRACT(a.changes,'$.result') AS CHAR)=CAST(r.result_json AS CHAR) AND (a.action<>'archive' OR JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.from_status'))='released') AND (a.action<>'delete' OR ` + deletedVersionProof(schema, "JSON_EXTRACT(r.result_json,'$.version_id')", "r.product_code") + `)))`
	return appendConflictRows(ctx, q, issues, "aims.product_activity_logs", query)
}
