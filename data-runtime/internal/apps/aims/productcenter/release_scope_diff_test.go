package productcenter

import "testing"

func TestReleaseScopeDiff(t *testing.T) {
	before := ProductReleaseDetail{SnapshotAvailable: true, EvidenceLevel: "verified", Version: &ProductVersionRecord{ProductCode: "P"}, Scopes: []VersionAcceptanceScope{{ID: 1, Title: "same"}, {ID: 2, Title: "old"}, {ID: 3, Title: "removed"}}}
	after := before
	from := int64(3)
	after.Scopes = []VersionAcceptanceScope{{ID: 4, Title: "removed", DeferredFromFeatureID: &from}, {ID: 2, Title: "new"}, {ID: 1, Title: "same"}}
	diff, err := CompareReleaseScopes(before, after)
	if err != nil || diff.Added != 1 || diff.Removed != 1 || diff.Changed != 1 || diff.Unchanged != 1 || len(diff.Changes) != 3 {
		t.Fatalf("diff %+v %v", diff, err)
	}
	if diff.Changes[0].ScopeID != 2 || diff.Changes[0].Before.Title != "old" || diff.Changes[0].After.Title != "new" || *diff.Changes[2].After.DeferredFromFeatureID != 3 {
		t.Fatalf("identity/order %+v", diff)
	}
	if before.Scopes[1].Title != "old" {
		t.Fatal("mutated source")
	}
	after.Scopes = append(after.Scopes, after.Scopes[0])
	if _, err = CompareReleaseScopes(before, after); err == nil {
		t.Fatal("duplicate accepted")
	}
	after = before
	after.SnapshotAvailable = false
	if _, err = CompareReleaseScopes(before, after); err == nil {
		t.Fatal("missing snapshot accepted")
	}
	after = before
	after.Version = &ProductVersionRecord{ProductCode: "OTHER"}
	if _, err = CompareReleaseScopes(before, after); err == nil {
		t.Fatal("cross product accepted")
	}
}
