package unified

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Field order and types match VersionExecutionSnapshot/Item: that writer hashes
// the typed value with content_hash empty, not MySQL's JSON text rendering.
type executionContractItem struct {
	ItemKey     string  `json:"item_key"`
	Title       string  `json:"title"`
	ParentID    *int64  `json:"parent_id"`
	VersionID   *int64  `json:"version_id"`
	FeatureID   *int64  `json:"feature_id"`
	ContentHash string  `json:"content_hash"`
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"project_id"`
	Status      string  `json:"status"`
	Weight      uint64  `json:"weight"`
	Priority    string  `json:"priority"`
	Severity    *string `json:"severity"`
}
type executionContractSnapshot struct {
	Targets         []executionContractItem `json:"targets"`
	OpenDefects     []executionContractItem `json:"open_defects"`
	TotalWeight     uint64                  `json:"total_weight"`
	CompletedWeight uint64                  `json:"completed_weight"`
	NoExecutionPlan bool                    `json:"no_execution_plan"`
	DefectCoverage  string                  `json:"defect_coverage"`
	ContentHash     string                  `json:"content_hash"`
}

func executionSnapshotContractValid(ctx context.Context, q querier, schema string, value any, version int64, scopes any, historicalProof bool) (bool, error) {
	raw, e := json.Marshal(value)
	if e != nil {
		return false, nil
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var snapshot executionContractSnapshot
	if e = d.Decode(&snapshot); e != nil {
		return false, nil
	}
	if snapshot.Targets == nil || snapshot.OpenDefects == nil || snapshot.DefectCoverage != "linked-descendants-only" {
		return false, nil
	}
	expected := snapshot.ContentHash
	snapshot.ContentHash = ""
	encoded, e := json.Marshal(snapshot)
	if e != nil {
		return false, e
	}
	hash := sha256.Sum256(encoded)
	if expected != hex.EncodeToString(hash[:]) {
		return false, nil
	}
	var total, completed uint64
	seen := map[int64]bool{}
	allowedScopes := map[int64]bool{}
	if frozen, ok := scopes.([]any); ok {
		for _, value := range frozen {
			if scope, ok := value.(map[string]any); ok {
				allowedScopes[contractInt(scope["id"])] = true
			}
		}
	}
	for _, item := range snapshot.Targets {
		if seen[item.ID] || item.VersionID == nil || *item.VersionID != version || (item.FeatureID != nil && !allowedScopes[*item.FeatureID]) {
			return false, nil
		}
		seen[item.ID] = true
		total += item.Weight
		if item.Status == "completed" {
			completed += item.Weight
		}
	}
	if total != snapshot.TotalWeight || completed != snapshot.CompletedWeight || snapshot.NoExecutionPlan != (total == 0) {
		return false, nil
	}
	for _, item := range append(snapshot.Targets, snapshot.OpenDefects...) {
		if item.ID < 1 || item.ProjectID < 1 || len(item.ContentHash) != 64 || !hexOnlySnapshot(item.ContentHash) {
			return false, nil
		}
		found, e := contractReference(ctx, q, schema, "work_items", "id=? AND project_id=?", item.ID, item.ProjectID)
		if e != nil {
			return false, e
		}
		if !found && historicalProof {
			live, err := contractReference(ctx, q, schema, "work_items", "id=?", item.ID)
			if err != nil {
				return false, err
			}
			found = !live
		}
		if !found {
			return false, e
		}
		if item.VersionID != nil {
			found, e = contractReference(ctx, q, schema, "product_versions", "id=?", *item.VersionID)
			if e != nil || !found {
				return false, e
			}
		}
		if item.FeatureID != nil {
			condition := "id=?"
			args := []any{*item.FeatureID}
			if item.VersionID != nil {
				condition += " AND version_id=?"
				args = append(args, *item.VersionID)
			}
			found, e = contractReference(ctx, q, schema, "product_version_features", condition, args...)
			if e == nil && !found && historicalProof {
				live, err := contractReference(ctx, q, schema, "product_version_features", "id=?", *item.FeatureID)
				if err != nil {
					return false, err
				}
				found = !live
			}
			if e != nil || !found {
				return false, e
			}
		}
	}
	return true, nil
}
func hexOnlySnapshot(s string) bool { _, e := hex.DecodeString(s); return e == nil }
