package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
)

// Review flags describe current differences; they never revoke or rewrite a baseline.
func roadmapCommitmentReview(ctx context.Context, tx *sql.Tx, code string, itemID int64, record RoadmapCommitmentRecord) ([]string, error) {
	var scope, evidence, window, model, decision, queue, lifecycle bool
	err := tx.QueryRowContext(ctx, `SELECT
 i.scope_revision<>b.scope_revision,
 i.evidence_revision<>b.evidence_revision,
 NOT(i.roadmap_starts_on<=>b.starts_on) OR NOT(i.roadmap_ends_on<=>b.ends_on),
 NOT(c.model_snapshot<=>b.model_snapshot),
 ci.planning_item_id IS NULL OR ci.selection_status<>'selected' OR NOT(ci.decision_snapshot<=>b.decision_snapshot) OR NOT(ci.current_assessment_id<=>JSON_EXTRACT(b.decision_snapshot,'$.assessment_id')),
 c.queue_revision<>b.queue_revision,
 NOT(i.lifecycle<=>JSON_UNQUOTE(JSON_EXTRACT(b.item_snapshot,'$.lifecycle')))
 FROM product_roadmap_commitments b JOIN product_planning_items i ON i.id=b.planning_item_id AND i.product_code=b.product_code
 JOIN product_planning_cycles c ON c.id=b.cycle_id AND c.product_code=b.product_code
 LEFT JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.cycle_id=c.id AND ci.product_code=b.product_code
 WHERE b.id=? AND i.id=? AND BINARY b.product_code=BINARY ?`, record.ID, itemID, code).Scan(&scope, &evidence, &window, &model, &decision, &queue, &lifecycle)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, change := range []struct {
		changed bool
		reason  string
	}{{scope, "scope_changed"}, {evidence, "evidence_changed"}, {window, "window_changed"}, {model, "model_changed"}, {decision, "decision_changed"}, {queue, "queue_changed"}, {lifecycle, "lifecycle_changed"}} {
		if change.changed {
			out = append(out, change.reason)
		}
	}
	var saved struct {
		Dependencies               []RoadmapCommitmentDependency `json:"dependencies"`
		CrossDependencyFingerprint string                        `json:"cross_dependency_fingerprint"`
	}
	if err = json.Unmarshal(record.ItemSnapshot, &saved); err != nil {
		return nil, err
	}
	current, err := loadRoadmapCommitmentDependencies(ctx, tx, code, record.CycleID, itemID)
	if err != nil {
		return nil, err
	}
	if saved.Dependencies == nil {
		out = append(out, "dependency_snapshot_missing")
	} else if !reflect.DeepEqual(saved.Dependencies, current) {
		out = append(out, "dependencies_changed")
	}
	fingerprint, err := crossDependencyFingerprint(ctx, tx, code, itemID)
	if err != nil {
		return nil, err
	}
	if saved.CrossDependencyFingerprint == "" {
		out = append(out, "cross_dependency_snapshot_missing")
	} else if saved.CrossDependencyFingerprint != fingerprint {
		out = append(out, "cross_dependencies_changed")
	}
	return out, nil
}
