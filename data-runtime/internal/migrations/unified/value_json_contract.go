package unified

import (
	"context"
	"encoding/json"
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
}

func validStringList(raw json.RawMessage) bool {
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return false
	}
	for _, value := range values {
		// Entries are business codes or display names; an empty or oversized
		// entry means the payload is not the registered family.
		if value == "" || len(value) > 255 {
			return false
		}
	}
	return true
}

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
