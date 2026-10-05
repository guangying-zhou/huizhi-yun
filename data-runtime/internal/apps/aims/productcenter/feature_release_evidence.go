package productcenter

// FeatureReleaseEvidence describes membership in a verified immutable snapshot,
// independently of the current mutable version scope and deployment state.
type FeatureReleaseEvidence struct {
	RecordID     int64   `json:"record_id"`
	VersionID    int64   `json:"version_id"`
	Membership   string  `json:"membership"`
	ScopeID      *int64  `json:"scope_id"`
	FrozenStatus *string `json:"frozen_status"`
	Current      bool    `json:"current"`
	Withdrawn    bool    `json:"withdrawn"`
	Superseded   bool    `json:"superseded"`
}

// The caller must obtain detail through the authorized, hash-validating release
// loader. This projection is not an authorization or content-integrity boundary.
func featureReleaseEvidence(detail ProductReleaseDetail, featureBizID string) (FeatureReleaseEvidence, error) {
	out := FeatureReleaseEvidence{RecordID: detail.ID, VersionID: detail.VersionID, Membership: "unavailable", Current: detail.Current, Withdrawn: detail.Withdrawn, Superseded: detail.Superseded}
	if detail.ID <= 0 || detail.VersionID <= 0 || featureBizID == "" || (detail.Current && (detail.Withdrawn || detail.Superseded)) {
		return out, invalid("product_release_evidence_invalid", "发布证据身份或状态无效")
	}
	if detail.EvidenceLevel == "legacy_import" {
		return out, nil
	}
	if detail.EvidenceLevel != "verified" || !detail.SnapshotAvailable || detail.Version == nil || detail.Version.ID != detail.VersionID {
		return out, invalid("product_release_evidence_invalid", "缺少已校验的发布快照")
	}
	out.Membership = "absent"
	for _, scope := range detail.Scopes {
		if scope.ProductFeatureBizID == nil || *scope.ProductFeatureBizID != featureBizID {
			continue
		}
		if out.ScopeID != nil || scope.ID <= 0 || (scope.Status != "planned" && scope.Status != "delivered" && scope.Status != "deferred") {
			return out, invalid("product_release_evidence_invalid", "发布快照功能范围不一致")
		}
		id, status := scope.ID, scope.Status
		out.Membership, out.ScopeID, out.FrozenStatus = "included", &id, &status
	}
	return out, nil
}
