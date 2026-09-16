package productcenter

import (
	"context"
	"database/sql"
)

type ProductVersionAcceptancePreview struct {
	ReviewHash           string                   `json:"review_hash"`
	Version              ProductVersionRecord     `json:"version"`
	WorkspaceRevision    uint64                   `json:"workspace_revision"`
	ScopeCount           int                      `json:"scope_count"`
	UnresolvedScopeCount int                      `json:"unresolved_scope_count"`
	DeliveredScopeCount  int                      `json:"delivered_scope_count"`
	DeferredScopeCount   int                      `json:"deferred_scope_count"`
	ProductStatus        string                   `json:"product_status"`
	Execution            VersionExecutionSnapshot `json:"execution"`
}

// A preview presents current facts; it grants no acceptance and is not an
// authorization token. AcceptProductVersion re-reads everything under locks.
func PreviewProductVersionAcceptance(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID int64) (ProductVersionAcceptancePreview, error) {
	var out ProductVersionAcceptancePreview
	if versionID <= 0 {
		return out, invalid("product_version_id_invalid", "版本标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	out.Version, err = loadProductVersion(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	scopes, err := loadVersionAcceptanceScopes(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	out.ScopeCount = len(scopes)
	for _, scope := range scopes {
		switch scope.Status {
		case "delivered":
			out.DeliveredScopeCount++
		case "deferred":
			out.DeferredScopeCount++
		default:
			out.UnresolvedScopeCount++
		}
	}
	out.Execution, err = loadVersionExecution(ctx, tx, versionID, scopes)
	if err != nil {
		return out, err
	}
	out.ReviewHash, err = versionAcceptanceReviewHash(out.Version, scopes, out.Execution)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision, out.ProductStatus = permit.Facts.Revision, permit.Facts.Status
	return out, tx.Commit()
}
