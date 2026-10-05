package productcenter

import (
	"reflect"
	"sort"
)

type ReleaseScopeChange struct {
	ScopeID int64                   `json:"scope_id"`
	Kind    string                  `json:"kind"`
	Before  *VersionAcceptanceScope `json:"before"`
	After   *VersionAcceptanceScope `json:"after"`
}
type ReleaseScopeDiff struct {
	Changes   []ReleaseScopeChange `json:"changes"`
	Added     int                  `json:"added"`
	Removed   int                  `json:"removed"`
	Changed   int                  `json:"changed"`
	Unchanged int                  `json:"unchanged"`
}

// CompareReleaseScopes consumes verified immutable snapshots, never live scope.
// Scope row identity is intentional: a deferred successor is a distinct scope,
// with DeferredFromFeatureID retained for tracing, not silently merged by title.
func CompareReleaseScopes(before, after ProductReleaseDetail) (ReleaseScopeDiff, error) {
	out := ReleaseScopeDiff{Changes: []ReleaseScopeChange{}}
	if !before.SnapshotAvailable || !after.SnapshotAvailable || before.EvidenceLevel != "verified" || after.EvidenceLevel != "verified" || before.Version == nil || after.Version == nil {
		return out, invalid("product_release_diff_unavailable", "缺少可验证的发布快照，无法比较")
	}
	if before.Version.ProductCode == "" || before.Version.ProductCode != after.Version.ProductCode {
		return out, invalid("product_release_diff_product_mismatch", "只能比较同一产品的发布范围")
	}
	index := func(scopes []VersionAcceptanceScope) (map[int64]VersionAcceptanceScope, error) {
		values := make(map[int64]VersionAcceptanceScope, len(scopes))
		for _, scope := range scopes {
			if scope.ID < 1 {
				return nil, invalid("product_release_diff_scope_invalid", "发布范围标识无效")
			}
			if _, exists := values[scope.ID]; exists {
				return nil, invalid("product_release_diff_scope_invalid", "发布范围标识重复")
			}
			values[scope.ID] = scope
		}
		return values, nil
	}
	left, err := index(before.Scopes)
	if err != nil {
		return out, err
	}
	right, err := index(after.Scopes)
	if err != nil {
		return out, err
	}
	ids := make([]int64, 0, len(left)+len(right))
	for id := range left {
		ids = append(ids, id)
	}
	for id := range right {
		if _, exists := left[id]; !exists {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		previous, had := left[id]
		current, has := right[id]
		change := ReleaseScopeChange{ScopeID: id}
		if had {
			change.Before = &previous
		}
		if has {
			change.After = &current
		}
		switch {
		case !had:
			change.Kind = "added"
			out.Added++
		case !has:
			change.Kind = "removed"
			out.Removed++
		case !reflect.DeepEqual(previous, current):
			change.Kind = "changed"
			out.Changed++
		default:
			out.Unchanged++
			continue
		}
		out.Changes = append(out.Changes, change)
	}
	return out, nil
}
