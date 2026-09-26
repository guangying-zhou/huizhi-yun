package unified

import "context"

func hasColumn(ctx context.Context, q querier, schema, table, column string) (bool, error) {
	rows, e := q.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?", schema, table, column)
	if e != nil {
		return false, e
	}
	defer rows.Close()
	ok := rows.Next()
	return ok, rows.Err()
}
func inspectAcceptPublishReceipts(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	ready, e := hasColumn(ctx, q, schema, "product_release_records", "biz_id")
	if e != nil {
		return nil, e
	}
	accepted, e := hasTables(ctx, q, schema, "product_version_acceptances")
	if e != nil {
		return nil, e
	}
	if !ready || !accepted {
		return appendConflictRows(ctx, q, nil, "aims.product_command_receipts", `SELECT 'accept_publish_contract_unregistered',CAST(id AS CHAR),1 FROM `+r+` WHERE action IN ('product_versions:accept','product_versions:publish')`)
	}
	v := qualified(schema, "product_versions")
	w := qualified(schema, "product_workspaces")
	acceptance := qualified(schema, "product_version_acceptances")
	release := qualified(schema, "product_release_records")
	query := `SELECT 'accept_publish_receipt_invalid',CAST(r.id AS CHAR),1 FROM ` + r + ` r LEFT JOIN ` + v + ` v ON v.id=JSON_EXTRACT(r.result_json,'$.version_id') LEFT JOIN ` + w + ` w ON BINARY w.product_code=BINARY r.product_code WHERE r.action IN ('product_versions:accept','product_versions:publish') AND (r.status<>'succeeded' OR r.result_json IS NULL OR r.request_hash NOT REGEXP '^[0-9a-f]{64}$' OR JSON_TYPE(r.result_json)<>'OBJECT' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.version_id')),'')<>'INTEGER' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.revision')),'')<>'INTEGER' OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.workspace_revision')),'')<>'INTEGER' OR v.id IS NULL OR BINARY v.product_code<>BINARY r.product_code OR w.product_code IS NULL OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.product_code')),'')<>r.product_code OR COALESCE(JSON_EXTRACT(r.result_json,'$.revision'),0)<2 OR JSON_EXTRACT(r.result_json,'$.revision')>v.revision OR COALESCE(JSON_EXTRACT(r.result_json,'$.workspace_revision'),0)<2 OR JSON_EXTRACT(r.result_json,'$.workspace_revision')>w.revision
 OR (r.action='product_versions:accept' AND (JSON_LENGTH(JSON_REMOVE(r.result_json,'$.acceptance_id','$.version_id','$.product_code','$.accepted_by','$.scope_revision','$.revision','$.workspace_revision'))<>0 OR NOT EXISTS (SELECT 1 FROM ` + acceptance + ` ac WHERE ac.id=JSON_EXTRACT(r.result_json,'$.acceptance_id') AND ac.version_id=v.id AND ac.scope_revision=JSON_EXTRACT(r.result_json,'$.scope_revision') AND BINARY ac.accepted_by=BINARY r.actor_uid AND JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.accepted_by'))=r.actor_uid)))
 OR (r.action='product_versions:publish' AND (JSON_LENGTH(JSON_REMOVE(r.result_json,'$.release_record_id','$.release_biz_id','$.version_id','$.product_code','$.status','$.content_hash','$.revision','$.workspace_revision'))<>0 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'')<>'released' OR NOT EXISTS (SELECT 1 FROM ` + release + ` l WHERE l.id=JSON_EXTRACT(r.result_json,'$.release_record_id') AND l.version_id=v.id AND l.biz_id=JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.release_biz_id')) AND l.content_hash=JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.content_hash'))))))`
	issues, e := appendConflictRows(ctx, q, nil, "aims.product_command_receipts", query)
	if e != nil {
		return nil, e
	}
	query = `SELECT 'accept_publish_audit_invalid',CAST(a.id AS CHAR),1 FROM ` + a + ` a WHERE a.action IN ('accept','publish') AND (a.object_type<>'version' OR NOT EXISTS (SELECT 1 FROM ` + r + ` r WHERE r.action=CONCAT('product_versions:',a.action) AND r.status='succeeded' AND BINARY r.product_code=BINARY a.product_code AND BINARY r.actor_uid=BINARY a.actor_uid AND BINARY r.idempotency_key=BINARY a.request_id AND CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.version_id')) AS CHAR)=a.object_id AND JSON_EXTRACT(r.result_json,'$.revision')=a.revision AND ((a.action='accept' AND CAST(a.changes AS CHAR)=CAST(r.result_json AS CHAR)) OR (a.action='publish' AND CAST(JSON_EXTRACT(a.changes,'$.result') AS CHAR)=CAST(r.result_json AS CHAR) AND COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.reason')),'')='STRING' AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.reason')))<>'' AND JSON_LENGTH(JSON_REMOVE(a.changes,'$.result','$.reason','$.acceptance_id'))=0 AND EXISTS (SELECT 1 FROM ` + release + ` l WHERE l.id=JSON_EXTRACT(r.result_json,'$.release_record_id') AND JSON_EXTRACT(l.acceptance_snapshot,'$.acceptance_id')=JSON_EXTRACT(a.changes,'$.acceptance_id'))))))`
	return appendConflictRows(ctx, q, issues, "aims.product_activity_logs", query)
}
