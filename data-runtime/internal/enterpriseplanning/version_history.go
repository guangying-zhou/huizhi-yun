package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func versionHistory[T any](ctx context.Context, s *VersionService, read func(*sql.Tx) (T, error)) (out T, err error) {
	if s == nil || s.registry == nil {
		return out, e.ErrBindingNotFound
	}
	q := s.writer
	q.Operation = e.Read
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, q)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	out, err = read(tx)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *VersionService) ListProductVersionAcceptances(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID int64, q pc.PlanningPageQuery) (pc.VersionAcceptancePage, error) {
	return versionHistory(ctx, s, func(tx *sql.Tx) (pc.VersionAcceptancePage, error) {
		return pc.ListProductVersionAcceptancesInTransaction(ctx, tx, code, uid, permit, versionID, q)
	})
}
func (s *VersionService) ReadProductVersionAcceptance(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID, acceptanceID int64) (pc.VersionAcceptanceDetail, error) {
	return versionHistory(ctx, s, func(tx *sql.Tx) (pc.VersionAcceptanceDetail, error) {
		return pc.ReadProductVersionAcceptanceInTransaction(ctx, tx, code, uid, permit, versionID, acceptanceID)
	})
}
func (s *VersionService) ReadProductVersionRelease(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID, recordID int64) (pc.ProductReleaseDetail, error) {
	return versionHistory(ctx, s, func(tx *sql.Tx) (pc.ProductReleaseDetail, error) {
		return pc.ReadProductVersionReleaseInTransaction(ctx, tx, code, uid, permit, versionID, recordID)
	})
}
func (s *VersionService) ListProductVersionReleases(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID int64, q pc.PlanningPageQuery) (pc.ProductReleasePage, error) {
	return versionHistory(ctx, s, func(tx *sql.Tx) (pc.ProductReleasePage, error) {
		return pc.ListProductVersionReleasesInTransaction(ctx, tx, code, uid, permit, versionID, q)
	})
}

func (s *VersionService) ExecutionCoordination(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID int64) (pc.VersionExecutionCoordination, error) {
	return versionHistory(ctx, s, func(tx *sql.Tx) (pc.VersionExecutionCoordination, error) {
		return pc.ReadVersionExecutionCoordinationInTransaction(ctx, tx, code, uid, permit, versionID)
	})
}
