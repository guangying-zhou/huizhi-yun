package unified

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/jsoncontract"
)

// Some migrated JSON columns carry values only: enumerated codes, display names
// or a frozen snapshot. They hold no internal auto-increment identifier, so the
// copy keeps them verbatim. Registration still demands executable validation, so
// each family below rejects an unexpected shape or an unknown snapshot version
// instead of trusting the column type.
var valueOnlyJSONFields = map[string]func(json.RawMessage) bool{
	"assets.product_assets.supported_terminals":      validStringList,
	"assets.product_assets.covered_legacy_systems":   validStringList,
	"aims.product_planning_cycles.model_snapshot":    validPlanningModelSnapshot,
	"aims.product_catalog_page_receipts.result_json": validCatalogPageReceipt,
	// Shapes shared with the writers live in internal/jsoncontract, so a
	// payload refused on write is exactly a payload this gate would block.
	"aims.aims_projects.access_whitelist":                    rawContract(jsoncontract.AccessWhitelist),
	"aims.aims_projects.module_config":                       rawContract(jsoncontract.ProjectModuleConfig),
	"aims.approval_records.snapshot_json":                    rawContract(jsoncontract.ApprovalSnapshot),
	"aims.deliverable_quality_reviews.checklist_result_json": rawContract(jsoncontract.QualityReviewResult),
	"aims.deliverable_submissions.evidence_snapshot_json":    rawContract(jsoncontract.SubmissionEvidence),
	"aims.project_template_versions.definition_json":         rawContract(jsoncontract.TemplateDefinition),
	"aims.qa_checklist_versions.items_json":                  rawContract(jsoncontract.QAChecklistItems),
	"assets.asset_events.event_data":                         rawContract(jsoncontract.EventData),
	"assets.asset_items.tags":                                validStringList,
	"assets.product_assets.customer_domain":                  validStringList,
	"assets.purchase_orders.attachments":                     rawContract(jsoncontract.Attachments),
}

func rawContract(check func([]byte) bool) func(json.RawMessage) bool {
	return func(raw json.RawMessage) bool { return check(raw) }
}

// Entries are business codes or display names; an empty or oversized entry
// means the payload is not the registered family. A JSON null literal is not
// a list.
func validStringList(raw json.RawMessage) bool { return jsoncontract.StringList(raw) }

// The planning model snapshot is frozen when a cycle opens. Only versions this
// migration understands may pass; a newer scoring model needs its own review.
func validPlanningModelSnapshot(raw json.RawMessage) bool {
	var snapshot struct {
		Version          string             `json:"version"`
		Weights          map[string]float64 `json:"weights"`
		EffortUnit       string             `json:"effort_unit"`
		ConfidenceValues []string           `json:"confidence_values"`
	}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return false
	}
	switch snapshot.Version {
	case "weighted-value-effort-v1", "rice-v1":
	default:
		return false
	}
	if len(snapshot.Weights) == 0 || snapshot.EffortUnit == "" {
		return false
	}
	for _, weight := range snapshot.Weights {
		if weight < 0 {
			return false
		}
	}
	return true
}

// The catalog page receipt records the refreshed page result. Its identifiers
// are stable business keys (refresh UUID and watermark), never internal ids.
func validCatalogPageReceipt(raw json.RawMessage) bool {
	var receipt struct {
		Total     *int64 `json:"total"`
		Status    string `json:"status"`
		Revision  *int64 `json:"revision"`
		NextPage  *int64 `json:"next_page"`
		RowCount  *int64 `json:"row_count"`
		Watermark string `json:"watermark"`
		RefreshID string `json:"refresh_id"`
	}
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return false
	}
	if receipt.Status == "" || receipt.Watermark == "" || receipt.RefreshID == "" {
		return false
	}
	for _, value := range []*int64{receipt.Total, receipt.Revision, receipt.NextPage, receipt.RowCount} {
		if value == nil || *value < 0 {
			return false
		}
	}
	return true
}

// inspectValueOnlyJSON validates every row of the registered value-only fields.
// A payload that fails its family validator is reported instead of copied.
func inspectValueOnlyJSON(ctx context.Context, q querier, tables []Table) ([]MigrationConflict, error) {
	var conflicts []MigrationConflict
	for _, table := range tables {
		for identity, valid := range valueOnlyJSONFields {
			prefix := table.Domain + "." + table.Name + "."
			if len(identity) <= len(prefix) || identity[:len(prefix)] != prefix {
				continue
			}
			column := identity[len(prefix):]
			present := false
			for _, existing := range table.Columns {
				if existing == column {
					present = true
					break
				}
			}
			if !present {
				continue
			}
			rows, err := q.QueryContext(ctx, "SELECT "+quoted(column)+" FROM "+qualified(table.Source, table.Name)+" WHERE "+quoted(column)+" IS NOT NULL")
			if err != nil {
				return nil, err
			}
			var invalid uint64
			for rows.Next() {
				var payload []byte
				if err = rows.Scan(&payload); err != nil {
					rows.Close()
					return nil, err
				}
				if !valid(payload) {
					invalid++
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return nil, err
			}
			if invalid > 0 {
				conflicts = append(conflicts, MigrationConflict{Kind: "json_value_payload_invalid", Source: table.Domain + "." + table.Name, KeySHA256: redactedBusinessKey("json-field", identity), RowCount: invalid})
			}
		}
	}
	return conflicts, nil
}

// inspectSnapshotHashes recomputes the digest the writer stored beside a frozen
// snapshot. The Aims milestone completion request binds approval to
// snapshot_sha256 (canonical compact JSON with sorted keys), so a copied row
// whose digest no longer matches its snapshot must not pass the gate. A NULL
// snapshot is the legacy flow and is not checked.
func inspectSnapshotHashes(ctx context.Context, q querier, tables []Table) ([]MigrationConflict, error) {
	var conflicts []MigrationConflict
	for _, table := range tables {
		if table.Domain != "aims" || table.Name != "approval_records" || !hasColumns(table.Columns, "snapshot_json", "snapshot_sha256") {
			continue
		}
		rows, err := q.QueryContext(ctx, "SELECT snapshot_json, snapshot_sha256 FROM "+qualified(table.Source, table.Name)+" WHERE snapshot_json IS NOT NULL")
		if err != nil {
			return nil, err
		}
		var mismatched uint64
		for rows.Next() {
			var payload []byte
			var digest sql.NullString
			if err = rows.Scan(&payload, &digest); err != nil {
				rows.Close()
				return nil, err
			}
			if computed, ok := jsoncontract.CanonicalSHA256(payload); !ok || !digest.Valid || digest.String != computed {
				mismatched++
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		if mismatched > 0 {
			conflicts = append(conflicts, MigrationConflict{Kind: "json_snapshot_hash_mismatch", Source: table.Domain + "." + table.Name, KeySHA256: redactedBusinessKey("json-field", "aims.approval_records.snapshot_json"), RowCount: mismatched})
		}
	}
	return conflicts, nil
}

func hasColumns(have []string, want ...string) bool {
	for _, column := range want {
		found := false
		for _, existing := range have {
			if existing == column {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
