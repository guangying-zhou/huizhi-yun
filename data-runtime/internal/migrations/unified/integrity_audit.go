package unified

import (
	"context"
	"fmt"
)

func hasTables(ctx context.Context, q querier, schema string, names ...string) (bool, error) {
	for _, name := range names {
		ok, err := tableInPlanSchema(ctx, q, schema, name)
		if err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

func appendConflictRows(ctx context.Context, q querier, conflicts []MigrationConflict, source, query string) ([]MigrationConflict, error) {
	rows, err := q.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, key string
		var count uint64
		if err = rows.Scan(&kind, &key, &count); err != nil {
			return nil, err
		}
		conflicts = append(conflicts, MigrationConflict{Kind: kind, Source: source, KeySHA256: redactedBusinessKey(kind, key), RowCount: count})
	}
	return conflicts, rows.Err()
}

func inspectHistoricalAndDeliveryIntegrity(ctx context.Context, q querier, c Config) ([]MigrationConflict, error) {
	conflicts := []MigrationConflict{}
	completionIssues, completionErr := inspectCompletionRequests(ctx, q, c.SourceAims)
	if completionErr != nil {
		return nil, completionErr
	}
	conflicts = append(conflicts, completionIssues...)
	versionIssues, versionErr := inspectVersionCreateJSON(ctx, q, c.SourceAims)
	if versionErr != nil {
		return nil, versionErr
	}
	conflicts = append(conflicts, versionIssues...)
	workspaceIssues, workspaceErr := inspectWorkspaceOnboardJSON(ctx, q, c.SourceAims)
	if workspaceErr != nil {
		return nil, workspaceErr
	}
	conflicts = append(conflicts, workspaceIssues...)
	if ok, err := hasTables(ctx, q, c.SourceAims, "project_activity_logs", "aims_projects", "service_command_receipt"); err != nil {
		return nil, err
	} else if ok {
		audit := qualified(c.SourceAims, "project_activity_logs")
		project := qualified(c.SourceAims, "aims_projects")
		receipt := qualified(c.SourceAims, "service_command_receipt")
		query := `SELECT 'project_audit_event_invalid',CAST(a.id AS CHAR),1 FROM ` + audit + ` a LEFT JOIN ` + project + ` p ON p.id=a.project_id WHERE NOT (a.object_type='work_item' AND a.action IN ('completion_request','completion_result','completion_replay')) AND (p.id IS NULL OR a.object_type<>'member' OR a.action NOT IN ('add','role','remove') OR TRIM(a.actor_uid)='' OR TRIM(a.request_id)='' OR JSON_VALID(a.changes)=0 OR COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.projectId')) AS UNSIGNED),0)<>a.project_id OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.uid')),'')<>a.object_code OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.action')),'')<>a.action OR NOT EXISTS (SELECT 1 FROM ` + receipt + ` r WHERE r.status='succeeded' AND r.operation_code=CONCAT('enterprise.aims.project-members.',a.action,'.v1') AND r.target_biz_type='project_member' AND r.target_biz_code=CONCAT(a.project_id,':',a.object_code) AND BINARY r.original_actor_uid=BINARY a.actor_uid AND BINARY r.idempotency_key=BINARY a.request_id))`
		conflicts, err = appendConflictRows(ctx, q, conflicts, "aims.project_activity_logs", query)
		if err != nil {
			return nil, err
		}
	}
	if ok, err := hasTables(ctx, q, c.SourceAims, "product_catalog_refreshes"); err != nil {
		return nil, err
	} else if ok {
		query := `SELECT 'catalog_watermark_contract_unknown',CAST(id AS CHAR),1 FROM ` + qualified(c.SourceAims, "product_catalog_refreshes") + ` WHERE source_watermark IS NOT NULL AND source_watermark NOT REGEXP '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[1-9][0-9]*$'`
		conflicts, err = appendConflictRows(ctx, q, conflicts, "aims.product_catalog_refreshes", query)
		if err != nil {
			return nil, err
		}
	}
	if ok, err := hasTables(ctx, q, c.SourceAims, "product_versions", "product_version_plan_confirmations"); err != nil {
		return nil, err
	} else if ok {
		query := `SELECT 'planning_snapshot_revision_ahead',CAST(c.id AS CHAR),1 FROM ` + qualified(c.SourceAims, "product_version_plan_confirmations") + ` c JOIN ` + qualified(c.SourceAims, "product_versions") + ` v ON v.id=c.version_id WHERE c.plan_revision>v.revision OR c.scope_revision>v.scope_revision ORDER BY c.id`
		conflicts, err = appendConflictRows(ctx, q, conflicts, "aims.product_version_plan_confirmations", query)
		if err != nil {
			return nil, err
		}
	}
	if ok, err := hasTables(ctx, q, c.SourceAims, "product_request_delivery_links", "product_planning_items"); err != nil {
		return nil, err
	} else if ok {
		query := `SELECT 'delivery_consumed_watermark_ahead',CAST(d.id AS CHAR),1 FROM ` + qualified(c.SourceAims, "product_request_delivery_links") + ` d JOIN ` + qualified(c.SourceAims, "product_planning_items") + ` p ON p.id=d.planning_item_id WHERE d.source_revision>p.revision ORDER BY d.id`
		conflicts, err = appendConflictRows(ctx, q, conflicts, "aims.product_request_delivery_links", query)
		if err != nil {
			return nil, err
		}
	}
	for _, domain := range []struct{ name, schema string }{{"aims", c.SourceAims}, {"assets", c.SourceAssets}} {
		ok, err := hasTables(ctx, q, domain.schema, "service_command_receipt")
		if err != nil {
			return nil, err
		}
		if ok {
			targetIssues, targetErr := inspectReceiptTargets(ctx, q, domain.name, domain.schema)
			if targetErr != nil {
				return nil, targetErr
			}
			conflicts = append(conflicts, targetIssues...)
			query := `SELECT 'receipt_identity_hash_conflict',MIN(receipt_id),COUNT(*) FROM ` + qualified(domain.schema, "service_command_receipt") + ` GROUP BY tenant_code,source_deployment_code,deployment_code,source_app,target_app,operation_code,idempotency_key HAVING COUNT(DISTINCT command_sha256)>1`
			conflicts, err = appendConflictRows(ctx, q, conflicts, domain.name+".service_command_receipt", query)
			if err != nil {
				return nil, err
			}
			query = `SELECT 'receipt_target_evidence_incomplete',receipt_id,1 FROM ` + qualified(domain.schema, "service_command_receipt") + ` WHERE status='succeeded' AND ((target_biz_type IS NULL)<>(target_biz_code IS NULL) OR response_summary_sha256 IS NULL OR response_summary_sha256 NOT REGEXP '^[0-9a-f]{64}$') ORDER BY receipt_id`
			conflicts, err = appendConflictRows(ctx, q, conflicts, domain.name+".service_command_receipt", query)
			if err != nil {
				return nil, err
			}
		}
		ok, err = hasTables(ctx, q, domain.schema, "integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable")
		if err != nil {
			return nil, err
		}
		if ok {
			op := qualified(domain.schema, "integration_operation")
			at := qualified(domain.schema, "integration_operation_attempt")
			dl := qualified(domain.schema, "integration_operation_dead_letter_actionable")
			queries := []struct{ source, sql string }{
				{domain.name + ".integration_operation_attempt", `SELECT 'outbox_attempt_state_sequence_unknown',attempt_id,1 FROM (SELECT attempt_id,attempt_no,result_status,finished_at,fencing_token,ROW_NUMBER() OVER (PARTITION BY operation_id ORDER BY attempt_no) expected_no,MAX(attempt_no) OVER (PARTITION BY operation_id) last_no,LAG(result_status) OVER (PARTITION BY operation_id ORDER BY attempt_no) prior_status,LAG(fencing_token) OVER (PARTITION BY operation_id ORDER BY attempt_no) prior_fence FROM ` + at + `) x WHERE result_status IS NULL OR result_status NOT IN ('processing','succeeded','retry_wait','partial_unknown','failed_permanent','dead_letter','cancelled') OR attempt_no<>expected_no OR (result_status='processing' AND (finished_at IS NOT NULL OR attempt_no<>last_no)) OR (result_status<>'processing' AND finished_at IS NULL) OR prior_status='succeeded' OR fencing_token<=prior_fence`},
				{domain.name + ".integration_operation", `SELECT 'outbox_parent_reference_invalid',o.operation_id,1 FROM ` + op + ` o LEFT JOIN ` + op + ` p ON p.operation_key=o.depends_on_operation_key AND BINARY p.tenant_code=BINARY o.tenant_code AND BINARY p.deployment_code=BINARY o.deployment_code AND BINARY p.correlation_key=BINARY o.correlation_key WHERE o.depends_on_operation_key IS NOT NULL AND (p.operation_id IS NULL OR p.operation_id=o.operation_id)`},
				{domain.name + ".integration_operation_attempt", `SELECT 'outbox_attempt_sequence_invalid',a.attempt_id,1 FROM ` + at + ` a LEFT JOIN ` + op + ` o ON o.operation_id=a.operation_id WHERE o.operation_id IS NULL OR a.attempt_no=0 OR a.attempt_no>o.attempt_count OR a.fencing_token>o.fencing_token`},
				{domain.name + ".integration_operation_dead_letter_actionable", `SELECT 'outbox_dead_letter_reference_invalid',d.operation_id,1 FROM ` + dl + ` d LEFT JOIN ` + op + ` o ON o.operation_id=d.operation_id WHERE o.operation_id IS NULL OR d.source_operation_version>o.version_no OR d.attempt_count>o.attempt_count`},
			}
			for _, item := range queries {
				conflicts, err = appendConflictRows(ctx, q, conflicts, item.source, item.sql)
				if err != nil {
					return nil, fmt.Errorf("%s: %w", item.source, err)
				}
			}
		}
	}
	return conflicts, nil
}
