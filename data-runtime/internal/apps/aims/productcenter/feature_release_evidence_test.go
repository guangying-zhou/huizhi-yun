package productcenter

import "testing"

func TestFeatureReleaseEvidencePreservesFrozenMembership(t *testing.T) {
	biz := "00000000-0000-4000-8000-000000000001"
	detail := ProductReleaseDetail{ID: 8, VersionID: 2, EvidenceLevel: "verified", SnapshotAvailable: true, Version: &ProductVersionRecord{ID: 2}, Current: true, Scopes: []VersionAcceptanceScope{{ID: 3, Status: "delivered", ProductFeatureBizID: &biz}}}
	evidence, err := featureReleaseEvidence(detail, biz)
	if err != nil || evidence.Membership != "included" || evidence.ScopeID == nil || *evidence.ScopeID != 3 || evidence.FrozenStatus == nil || *evidence.FrozenStatus != "delivered" || !evidence.Current {
		t.Fatalf("included: %+v %v", evidence, err)
	}
	detail.Scopes[0].Status = "deferred"
	if *evidence.FrozenStatus != "delivered" {
		t.Fatal("projection aliases mutable input")
	}
	detail.Current, detail.Withdrawn = false, true
	evidence, err = featureReleaseEvidence(detail, biz)
	if err != nil || evidence.Membership != "included" || !evidence.Withdrawn || evidence.Current || *evidence.FrozenStatus != "deferred" {
		t.Fatalf("withdrawal erases history: %+v %v", evidence, err)
	}
	evidence, err = featureReleaseEvidence(detail, "another-feature")
	if err != nil || evidence.Membership != "absent" || evidence.ScopeID != nil || evidence.FrozenStatus != nil {
		t.Fatalf("absent: %+v %v", evidence, err)
	}
	detail.EvidenceLevel, detail.SnapshotAvailable, detail.Version = "legacy_import", false, nil
	evidence, err = featureReleaseEvidence(detail, biz)
	if err != nil || evidence.Membership != "unavailable" || evidence.ScopeID != nil {
		t.Fatalf("legacy is unknown: %+v %v", evidence, err)
	}
}

func TestFeatureReleaseEvidenceRejectsUnverifiedOrAmbiguousScopes(t *testing.T) {
	biz := "feature"
	base := ProductReleaseDetail{ID: 8, VersionID: 2, EvidenceLevel: "verified", SnapshotAvailable: true, Version: &ProductVersionRecord{ID: 2}, Scopes: []VersionAcceptanceScope{{ID: 3, Status: "planned", ProductFeatureBizID: &biz}}}
	cases := []ProductReleaseDetail{base, base, base, base, base}
	cases[0].SnapshotAvailable = false
	cases[1].EvidenceLevel = "unknown"
	cases[2].Scopes = append(append([]VersionAcceptanceScope{}, base.Scopes...), base.Scopes[0])
	cases[3].Current, cases[3].Superseded = true, true
	cases[4].Version = &ProductVersionRecord{ID: 9}
	for i, detail := range cases {
		if _, err := featureReleaseEvidence(detail, biz); err == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
}
