package productcenter

import (
	"context"
	"database/sql"
)

type ProductVersionScopeDeferralSource struct {
	VersionID               int64  `json:"version_id"`
	ScopeID                 int64  `json:"scope_id"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
}

func prepareVersionScopeDeferral(ctx context.Context, tx *sql.Tx, code string, source *ProductVersionScopeDeferralSource) error {
	original, err := loadProductVersion(ctx, tx, code, source.VersionID)
	if err != nil {
		return err
	}
	if original.Revision != source.ExpectedVersionRevision || original.ScopeRevision != source.ExpectedScopeRevision {
		return invalid("product_version_revision_conflict", "延期来源版本已变化")
	}
	if (original.Status != "planning" && original.Status != "developing") || original.CurrentReleaseRecordID != nil {
		return invalid("product_version_locked", "已发布或归档范围不能延期")
	}
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM product_version_features WHERE id=? AND version_id=? FOR UPDATE`, source.ScopeID, source.VersionID).Scan(&status); err != nil {
		return err
	}
	if status != "planned" {
		return invalid("product_version_scope_locked", "仅计划中的范围可以延期")
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_features WHERE deferred_from_feature_id=?`, source.ScopeID).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return invalid("product_version_scope_conflict", "原范围已存在后续范围")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE product_version_features SET status='deferred',updated_at=UTC_TIMESTAMP(3) WHERE id=?`, source.ScopeID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, source.VersionID)
	return err
}
