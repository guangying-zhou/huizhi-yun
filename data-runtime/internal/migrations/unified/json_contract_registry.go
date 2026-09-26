package unified

import "context"

// Registration means a field has executable validation, not that all possible
// payloads are accepted. Family-specific validators reject unknown versions.
var registeredJSONFields = map[string]bool{
	"aims.work_item_completion_requests.snapshot_json":    true,
	"aims.product_planning_cycle_items.decision_snapshot": true,
	"aims.product_version_plan_confirmations.snapshot":    true,
	"aims.product_version_acceptances.checklist":          true,
	"aims.product_version_acceptances.exceptions":         true,
	"aims.product_release_records.scope_snapshot":         true,
	"aims.product_release_records.acceptance_snapshot":    true,
	"aims.integration_operation.command_json":             true,
	"aims.project_activity_logs.changes":                  true,
	"aims.product_command_receipts.result_json":           true,
	"aims.product_activity_logs.changes":                  true,
	// Value-only families; their executable validation lives in
	// value_json_contract.go and runs over every migrated row.
	"assets.product_assets.supported_terminals":           true,
	"assets.product_assets.covered_legacy_systems":        true,
	"aims.product_planning_cycles.model_snapshot":         true,
	"aims.product_catalog_page_receipts.result_json":      true,
}

func inspectUnregisteredJSON(ctx context.Context, q querier, tables []Table) ([]MigrationConflict, error) {
	issues := []MigrationConflict{}
	for _, table := range tables {
		rows, err := q.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND DATA_TYPE='json' ORDER BY ORDINAL_POSITION", table.Source, table.Name)
		if err != nil {
			return nil, err
		}
		columns := []string{}
		for rows.Next() {
			var col string
			if err = rows.Scan(&col); err != nil {
				rows.Close()
				return nil, err
			}
			columns = append(columns, col)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		for _, col := range columns {
			identity := table.Domain + "." + table.Name + "." + col
			if registeredJSONFields[identity] {
				dependencies := []string{"product_requests", "product_document_creation_requests", "product_activity_logs", "product_workspaces"}
				// Value-only families validate their own rows (see
				// value_json_contract.go) and depend on no other table, so they
				// must not inherit the Aims planning dependency list.
				if _, valueOnly := valueOnlyJSONFields[identity]; valueOnly {
					dependencies = []string{table.Name}
				}
				if table.Name == "work_item_completion_requests" {
					dependencies = []string{"work_item_completion_requests", "work_items", "aims_projects", "project_activity_logs", "service_command_receipt", "integration_operation", "work_item_changelog"}
				}
				if table.Name == "product_planning_cycle_items" {
					dependencies = []string{"product_planning_cycle_items", "product_planning_cycles", "product_planning_items", "product_command_receipts", "product_activity_logs", "product_versions", "product_workspaces"}
				}
				if identity == "aims.project_activity_logs.changes" {
					dependencies = []string{"aims_projects", "service_command_receipt"}
				}
				if identity == "aims.product_command_receipts.result_json" || identity == "aims.product_activity_logs.changes" {
					dependencies = []string{"product_command_receipts", "product_activity_logs", "product_versions", "product_workspaces"}
				}
				if table.Name == "product_version_acceptances" || table.Name == "product_release_records" {
					dependencies = []string{"product_version_acceptances", "product_release_records", "product_versions"}
				}
				if table.Name == "product_version_plan_confirmations" {
					dependencies = []string{"product_version_plan_confirmations", "product_version_plans", "product_versions", "product_requests", "product_planning_items", "product_version_features"}
				}
				ready, err := hasTables(ctx, q, table.Source, dependencies...)
				if err != nil {
					return nil, err
				}
				if ready && table.Name == "product_planning_cycle_items" {
					for name, columns := range map[string][]string{
						"product_planning_cycle_items": {"cycle_id", "planning_item_id", "product_code", "selection_status", "decision_snapshot"},
						"product_planning_cycles":      {"id", "biz_id", "product_code", "revision", "queue_revision"},
						"product_planning_items":       {"id", "biz_id", "product_code", "revision", "scope_revision", "evidence_revision"},
					} {
						for _, column := range columns {
							exists, err := hasColumn(ctx, q, table.Source, name, column)
							if err != nil {
								return nil, err
							}
							ready = ready && exists
						}
					}
				}
				if ready && (table.Name == "product_version_acceptances" || table.Name == "product_release_records") {
					for name, columns := range map[string][]string{"product_version_acceptances": {"id", "version_id", "scope_revision", "accepted_by", "checklist", "exceptions"}, "product_release_records": {"id", "version_id", "scope_revision", "content_hash", "scope_snapshot", "acceptance_snapshot"}} {
						for _, column := range columns {
							exists, e := hasColumn(ctx, q, table.Source, name, column)
							if e != nil {
								return nil, e
							}
							ready = ready && exists
						}
					}
				}
				if ready {
					continue
				}
			}
			r, err := q.QueryContext(ctx, "SELECT COUNT(*) FROM "+qualified(table.Source, table.Name)+" WHERE "+quoted(col)+" IS NOT NULL")
			if err != nil {
				return nil, err
			}
			var count uint64
			if !r.Next() {
				err = r.Err()
				r.Close()
				if err != nil {
					return nil, err
				}
				continue
			}
			err = r.Scan(&count)
			r.Close()
			if err != nil {
				return nil, err
			}
			if count > 0 {
				issues = append(issues, MigrationConflict{Kind: "json_field_contract_unregistered", Source: table.Domain + "." + table.Name, KeySHA256: redactedBusinessKey("json-field", identity), RowCount: count})
			}
		}
	}
	return issues, nil
}
