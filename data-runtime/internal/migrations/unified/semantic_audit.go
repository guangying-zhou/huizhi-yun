package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
)

// MigrationConflict is safe to include in a review artifact: the business key
// is represented only by a domain-separated hash, never by its source value.
type MigrationConflict struct {
	Kind      string `json:"kind"`
	Source    string `json:"source"`
	KeySHA256 string `json:"keySha256"`
	RowCount  uint64 `json:"rowCount"`
}

func redactedBusinessKey(kind, value string) string {
	sum := sha256.Sum256([]byte("enterprise-migration-conflict/v1\x00" + kind + "\x00" + value))
	return hex.EncodeToString(sum[:])
}

func tableInPlanSchema(ctx context.Context, q querier, schema, table string) (bool, error) {
	var n int
	rows, err := q.QueryContext(ctx, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", schema, table)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var ignored string
		if scanErr := rows.Scan(&ignored); scanErr != nil {
			return false, scanErr
		}
		n++
	}
	return n == 1, rows.Err()
}

// inspectProductMasterConflicts covers the first cross-domain logical
// reference in the pilot: Aims workspace product_code -> Assets product master.
// Binary source keys remain authoritative. Values that collapse only after
// trim/case normalization are reported because a later collation change could
// otherwise merge them silently.
func inspectProductMasterConflicts(ctx context.Context, q querier, c Config) ([]MigrationConflict, error) {
	for _, item := range []struct{ schema, table string }{{c.SourceAims, "product_workspaces"}, {c.SourceAssets, "product_assets"}} {
		ok, err := tableInPlanSchema(ctx, q, item.schema, item.table)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, nil
		}
	}
	conflicts := []MigrationConflict{}
	rows, err := q.QueryContext(ctx, "SELECT LOWER(TRIM(product_code)),COUNT(*) FROM "+qualified(c.SourceAssets, "product_assets")+" GROUP BY LOWER(TRIM(product_code)) HAVING COUNT(DISTINCT BINARY product_code)>1 ORDER BY LOWER(TRIM(product_code))")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key string
		var count uint64
		if err = rows.Scan(&key, &count); err != nil {
			rows.Close()
			return nil, err
		}
		conflicts = append(conflicts, MigrationConflict{Kind: "product_master_normalized_key_collision", Source: "assets.product_assets", KeySHA256: redactedBusinessKey("product-master", key), RowCount: count})
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	// Unified product-line spaces use the reserved `~line-` namespace and have no
	// Assets master by design; their authority is product_line_workspaces. They
	// are only a conflict when that line row is missing, so the check tightens
	// rather than exempts. Sources predating v5.37 keep the original rule.
	lineWorkspaces, err := tableInPlanSchema(ctx, q, c.SourceAims, "product_line_workspaces")
	if err != nil {
		return nil, err
	}
	missingMaster := "SELECT LOWER(TRIM(w.product_code)),COUNT(*) FROM " + qualified(c.SourceAims, "product_workspaces") + " w LEFT JOIN " + qualified(c.SourceAssets, "product_assets") + " p ON BINARY p.product_code=BINARY w.product_code WHERE p.id IS NULL"
	if lineWorkspaces {
		missingMaster += " AND NOT EXISTS(SELECT 1 FROM " + qualified(c.SourceAims, "product_line_workspaces") + " l WHERE BINARY l.product_code=BINARY w.product_code)"
	}
	missingMaster += " GROUP BY LOWER(TRIM(w.product_code)) ORDER BY LOWER(TRIM(w.product_code))"
	rows, err = q.QueryContext(ctx, missingMaster)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var count uint64
		if err = rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		conflicts = append(conflicts, MigrationConflict{Kind: "product_workspace_missing_master", Source: "aims.product_workspaces", KeySHA256: redactedBusinessKey("product-workspace", key), RowCount: count})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	semantic, err := inspectPlanningJSONAndRevisions(ctx, q, c)
	if err != nil {
		return nil, err
	}
	conflicts = append(conflicts, semantic...)
	integrity, err := inspectHistoricalAndDeliveryIntegrity(ctx, q, c)
	if err != nil {
		return nil, err
	}
	conflicts = append(conflicts, integrity...)
	for i, issue := range conflicts {
		if issue.KeySHA256 == "" || issue.RowCount == 0 {
			return nil, fmt.Errorf("invalid migration conflict at index %d", i)
		}
	}
	return conflicts, nil
}

func inspectPlanningJSONAndRevisions(ctx context.Context, q querier, c Config) ([]MigrationConflict, error) {
	needed := []string{"integration_operation", "product_requests", "product_document_creation_requests", "product_activity_logs"}
	for _, table := range needed {
		ok, err := tableInPlanSchema(ctx, q, c.SourceAims, table)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, nil
		}
	}
	conflicts := []MigrationConflict{}
	var unknownErr error
	conflicts, unknownErr = appendConflictRows(ctx, q, conflicts, "aims.integration_operation", `SELECT 'planning_command_family_unregistered',operation_id,1 FROM `+qualified(c.SourceAims, "integration_operation")+` WHERE source_app<>'aims' OR source_biz_type NOT IN ('product_request','product_document_request','work_item_completion_request') OR source_app IS NULL OR source_biz_type IS NULL`)
	if unknownErr != nil {
		return nil, unknownErr
	}
	// These are the versioned product-planning commands currently emitted by
	// productcenter. Other operation families remain outside this first batch.
	rows, err := q.QueryContext(ctx, `SELECT operation_id,
		CASE
		 WHEN JSON_VALID(command_json)=0 THEN 'planning_command_invalid_json'
		 WHEN NOT ((operation_code='aims.altoc.product-feedback.update-status.v1' AND command_schema_version='product-feedback-status.v1')
		        OR (operation_code='aims.altoc.product-feedback.update-progress.v1' AND command_schema_version='product-feedback-progress.v1')
		        OR (operation_code='aims.codocs.product-document.create.v1' AND command_schema_version='product-document-create.v1')) THEN 'planning_command_unknown_schema'
		 WHEN source_biz_type='product_request' AND NOT EXISTS (SELECT 1 FROM `+qualified(c.SourceAims, "product_requests")+` r WHERE BINARY r.biz_id=BINARY source_biz_code) THEN 'planning_command_missing_source_reference'
		 WHEN source_biz_type='product_request' AND (JSON_TYPE(JSON_EXTRACT(command_json,'$.requestBizId'))<>'STRING' OR BINARY JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.requestBizId'))<>BINARY source_biz_code) THEN 'planning_command_missing_json_reference'
		 WHEN source_biz_type='product_document_request' AND NOT EXISTS (SELECT 1 FROM `+qualified(c.SourceAims, "product_document_creation_requests")+` d WHERE BINARY d.biz_id=BINARY source_biz_code) THEN 'planning_command_missing_source_reference'
		 ELSE NULL END conflict_kind
	FROM `+qualified(c.SourceAims, "integration_operation")+`
	WHERE source_app='aims' AND source_biz_type IN ('product_request','product_document_request')
	HAVING conflict_kind IS NOT NULL ORDER BY operation_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key, kind string
		if err = rows.Scan(&key, &kind); err != nil {
			rows.Close()
			return nil, err
		}
		conflicts = append(conflicts, MigrationConflict{Kind: kind, Source: "aims.integration_operation", KeySHA256: redactedBusinessKey(kind, key), RowCount: 1})
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT object_type,object_id,COUNT(*) FROM (
		SELECT object_type,object_id,revision,LAG(revision) OVER (PARTITION BY object_type,object_id ORDER BY id) previous_revision
		FROM `+qualified(c.SourceAims, "product_activity_logs")+` WHERE revision IS NOT NULL
	) revisions WHERE previous_revision IS NOT NULL AND revision<previous_revision GROUP BY object_type,object_id ORDER BY object_type,object_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var objectType, objectID string
		var count uint64
		if err = rows.Scan(&objectType, &objectID, &count); err != nil {
			return nil, err
		}
		conflicts = append(conflicts, MigrationConflict{Kind: "product_activity_revision_regression", Source: "aims.product_activity_logs", KeySHA256: redactedBusinessKey("product-revision", objectType+"\x00"+objectID), RowCount: count})
	}
	return conflicts, rows.Err()
}

var _ querier = (*sql.Tx)(nil)
