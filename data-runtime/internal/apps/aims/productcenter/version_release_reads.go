package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type ProductReleaseDetail struct {
	ID                int64                        `json:"id"`
	BizID             string                       `json:"biz_id"`
	VersionID         int64                        `json:"version_id"`
	ReleaseSeq        uint64                       `json:"release_seq"`
	ScopeRevision     uint64                       `json:"scope_revision"`
	ReleasedBy        *string                      `json:"released_by"`
	ReleasedAt        *string                      `json:"released_at"`
	EvidenceLevel     string                       `json:"evidence_level"`
	ContentHash       string                       `json:"content_hash"`
	Current           bool                         `json:"current"`
	Withdrawn         bool                         `json:"withdrawn"`
	Superseded        bool                         `json:"superseded"`
	SnapshotAvailable bool                         `json:"snapshot_available"`
	Version           *ProductVersionRecord        `json:"version"`
	Scopes            []VersionAcceptanceScope     `json:"scopes"`
	AcceptedBy        string                       `json:"accepted_by"`
	AcceptedAt        string                       `json:"accepted_at"`
	Checks            []VersionAcceptanceCheck     `json:"checks"`
	Exceptions        []VersionAcceptanceException `json:"exceptions"`
}

// Only immutable release content is projected. Current scope/work-item content
// is never substituted into a historical release. Execution detail is omitted.
func ReadProductVersionRelease(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID, recordID int64) (ProductReleaseDetail, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return ProductReleaseDetail{}, err
	}
	defer tx.Rollback()
	out, err := ReadProductVersionReleaseInTransaction(ctx, tx, code, uid, permit, versionID, recordID)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ReadProductVersionReleaseInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, versionID, recordID int64) (ProductReleaseDetail, error) {
	out := ProductReleaseDetail{Scopes: []VersionAcceptanceScope{}, Checks: []VersionAcceptanceCheck{}, Exceptions: []VersionAcceptanceException{}}
	if versionID <= 0 || recordID <= 0 {
		return out, invalid("product_release_id_invalid", "发布记录标识无效")
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "History requires a transaction")
	}
	var err error
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	out, err = loadProductVersionRelease(ctx, tx, code, versionID, recordID)
	if err != nil {
		return out, err
	}
	return out, nil
}

func loadProductVersionRelease(ctx context.Context, tx *sql.Tx, code string, versionID, recordID int64) (ProductReleaseDetail, error) {
	out := ProductReleaseDetail{Scopes: []VersionAcceptanceScope{}, Checks: []VersionAcceptanceCheck{}, Exceptions: []VersionAcceptanceException{}}
	version, err := loadProductVersion(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	var scope, acceptance json.RawMessage
	err = tx.QueryRowContext(ctx, `SELECT r.id,r.biz_id,r.version_id,r.release_seq,r.scope_revision,r.released_by,DATE_FORMAT(r.released_at,'%Y-%m-%dT%H:%i:%s.%fZ'),r.evidence_level,r.content_hash,r.scope_snapshot,r.acceptance_snapshot,EXISTS(SELECT 1 FROM product_release_events e WHERE e.release_record_id=r.id AND e.event_type='withdrawn'),EXISTS(SELECT 1 FROM product_release_events e WHERE e.release_record_id=r.id AND e.event_type='superseded') FROM product_release_records r WHERE r.id=? AND r.version_id=?`, recordID, versionID).Scan(&out.ID, &out.BizID, &out.VersionID, &out.ReleaseSeq, &out.ScopeRevision, &out.ReleasedBy, &out.ReleasedAt, &out.EvidenceLevel, &out.ContentHash, &scope, &acceptance, &out.Withdrawn, &out.Superseded)
	if err == sql.ErrNoRows {
		return out, invalid("product_release_not_found", "发布记录不存在")
	}
	if err != nil {
		return out, err
	}
	out.Current = version.CurrentReleaseRecordID != nil && *version.CurrentReleaseRecordID == recordID && version.Status == "released" && !out.Withdrawn && !out.Superseded
	if out.EvidenceLevel == "legacy_import" {
		return out, nil
	}
	hash, err := versionReleaseContentHash(scope, acceptance)
	if err != nil {
		return out, err
	}
	if hash != out.ContentHash {
		return out, invalid("product_release_evidence_invalid", "发布快照校验失败")
	}
	var storedScope struct {
		Version         int                      `json:"version"`
		ReviewedVersion ProductVersionRecord     `json:"reviewed_version"`
		Scopes          []VersionAcceptanceScope `json:"scopes"`
	}
	var storedAcceptance struct {
		AcceptedBy string `json:"accepted_by"`
		AcceptedAt string `json:"accepted_at"`
		Checklist  struct {
			Checks []VersionAcceptanceCheck `json:"checks"`
		} `json:"checklist"`
		Exceptions []VersionAcceptanceException `json:"exceptions"`
	}
	if err = json.Unmarshal(scope, &storedScope); err != nil {
		return out, err
	}
	if err = json.Unmarshal(acceptance, &storedAcceptance); err != nil {
		return out, err
	}
	if storedScope.Version != 1 || storedScope.ReviewedVersion.ID != versionID || storedScope.ReviewedVersion.ProductCode != code {
		return out, invalid("product_release_evidence_invalid", "发布快照归属或格式无效")
	}
	out.SnapshotAvailable = true
	out.Version = &storedScope.ReviewedVersion
	out.Scopes = storedScope.Scopes
	out.AcceptedBy = storedAcceptance.AcceptedBy
	out.AcceptedAt = storedAcceptance.AcceptedAt
	out.Checks = storedAcceptance.Checklist.Checks
	out.Exceptions = storedAcceptance.Exceptions
	return out, nil
}
