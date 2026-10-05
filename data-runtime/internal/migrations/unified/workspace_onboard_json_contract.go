package unified

import "context"

// Product workspace onboarding is its own receipt/audit family. The version
// contract deliberately reports every unrecognised receipt carrying result_json,
// so this family is registered here with executable validation instead of being
// excluded silently.
//
// products:onboard / products:edit freeze the workspace row itself; the
// `~line-` unified space adds products:onboard-line, whose result records the
// line code, the reserved workspace code and how many source products became
// modules. None of these payloads carries an internal auto-increment id, so the
// copy keeps them verbatim once the shape and the referenced workspace check out.
var workspaceOnboardReceiptActions = []string{"products:onboard", "products:edit", "products:onboard-line"}
var workspaceOnboardAuditActions = []string{"onboard", "edit", "onboard-line"}

func quotedList(values []string) string {
	out := ""
	for i, value := range values {
		if i > 0 {
			out += ","
		}
		out += "'" + value + "'"
	}
	return out
}

func inspectWorkspaceOnboardJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ok, err := hasTables(ctx, q, schema, "product_command_receipts", "product_activity_logs", "product_workspaces")
	if err != nil || !ok {
		return nil, err
	}
	receipt := qualified(schema, "product_command_receipts")
	workspace := qualified(schema, "product_workspaces")
	audit := qualified(schema, "product_activity_logs")
	lineWorkspaces, err := tableInPlanSchema(ctx, q, schema, "product_line_workspaces")
	if err != nil {
		return nil, err
	}
	// A line receipt must point at an existing line workspace; without the v5.37
	// table the line family cannot be validated and stays reported.
	lineProof := "FALSE"
	if lineWorkspaces {
		lineProof = "EXISTS(SELECT 1 FROM " + qualified(schema, "product_line_workspaces") + " l WHERE BINARY l.product_code=BINARY r.product_code AND BINARY l.line_code=BINARY JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.line_code')))"
	}
	query := `SELECT 'workspace_onboard_receipt_snapshot_invalid',CAST(r.id AS CHAR),1 FROM ` + receipt + ` r
 LEFT JOIN ` + workspace + ` w ON BINARY w.product_code=BINARY r.product_code
 WHERE r.result_json IS NOT NULL AND r.action IN (` + quotedList(workspaceOnboardReceiptActions) + `) AND (
 r.status<>'succeeded' OR r.request_hash NOT REGEXP '^[0-9a-f]{64}$'
 OR JSON_TYPE(r.result_json)<>'OBJECT' OR w.product_code IS NULL
 OR (r.action='products:onboard-line' AND (
   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.product_code')),'')<>r.product_code
   OR r.product_code NOT LIKE '~line-%'
   OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.line_code')),'')=''
   OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.component_count')),'')<>'INTEGER'
   OR COALESCE(JSON_EXTRACT(r.result_json,'$.component_count'),-1)<0
   OR NOT ` + lineProof + `))
 OR (r.action<>'products:onboard-line' AND (
   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.biz_id')),'')=''
   OR COALESCE(JSON_TYPE(JSON_EXTRACT(r.result_json,'$.revision')),'')<>'INTEGER'
   OR COALESCE(JSON_EXTRACT(r.result_json,'$.revision'),0)<1
   OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.status')),'') NOT IN ('active','archived')
   OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.biz_id')),'')<>w.biz_id))
 ) ORDER BY r.id`
	issues, err := appendConflictRows(ctx, q, nil, "aims.product_command_receipts", query)
	if err != nil {
		return nil, err
	}
	// Workspace audits keep an `after` snapshot of the same workspace row.
	auditQuery := `SELECT 'workspace_onboard_audit_snapshot_invalid',CAST(a.id AS CHAR),1 FROM ` + audit + ` a
 LEFT JOIN ` + workspace + ` w ON BINARY w.product_code=BINARY a.product_code
 WHERE a.changes IS NOT NULL AND a.object_type='workspace' AND a.action IN (` + quotedList(workspaceOnboardAuditActions) + `) AND (
 JSON_TYPE(a.changes)<>'OBJECT' OR w.product_code IS NULL
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.after')),'')<>'OBJECT'
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.after.biz_id')),'')=''
 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.after.biz_id')),'')<>a.object_id
 OR COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.after.revision')),'')<>'INTEGER'
 OR (a.action='onboard-line' AND (
   a.product_code NOT LIKE '~line-%'
   OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.line_code')),'')=''
   OR NOT (
     -- Current shape: the caller picks which products join the unified space.
     (COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.selected')),'')='ARRAY' AND JSON_LENGTH(JSON_EXTRACT(a.changes,'$.selected'))>=1)
     -- Frozen pre-selection shape: the whole line was taken in with a reason.
     OR (COALESCE(JSON_TYPE(JSON_EXTRACT(a.changes,'$.reason')),'')='STRING' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.reason')),'')<>'')
   )))
 ) ORDER BY a.id`
	return appendConflictRows(ctx, q, issues, "aims.product_activity_logs", auditQuery)
}
