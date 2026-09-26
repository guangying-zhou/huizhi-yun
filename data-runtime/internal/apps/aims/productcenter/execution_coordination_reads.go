package productcenter

import (
	"context"
	"database/sql"
)

type VersionExecutionCoordination struct {
	ProductCode       string `json:"product_code"`
	VersionID         int64  `json:"version_id"`
	WorkspaceRevision uint64 `json:"workspace_revision"`
	ExecutionCoordination
}

// Reuses the authorized transaction and immutable in-memory execution snapshot
// from the preview reader. No acceptance or publication is performed. Project
// aggregates are internal facts; the BFF must authorize projects before display.
func ReadVersionExecutionCoordination(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID int64) (VersionExecutionCoordination, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return VersionExecutionCoordination{}, err
	}
	defer tx.Rollback()
	out, err := ReadVersionExecutionCoordinationInTransaction(ctx, tx, code, uid, permit, versionID)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ReadVersionExecutionCoordinationInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, versionID int64) (VersionExecutionCoordination, error) {
	out := VersionExecutionCoordination{ProductCode: code, VersionID: versionID}
	preview, err := PreviewProductVersionAcceptanceInTransaction(ctx, tx, code, uid, permit, versionID)
	if err != nil {
		return out, err
	}
	out.ExecutionCoordination, err = SummarizeExecutionCoordination(preview.Execution)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = preview.WorkspaceRevision
	return out, nil
}
