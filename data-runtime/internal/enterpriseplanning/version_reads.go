package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func (s *PlanningService) read(ctx context.Context, apply func(*sql.Tx) (any, error)) (any, error) {
	if s == nil || s.registry == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	reader := s.writer
	reader.Operation = enterprise.Read
	tx, _, err := s.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out, err := apply(tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *PlanningService) ListVersions(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, input pc.ProductVersionPageQuery) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		return pc.ListProductCenterVersionsInTransaction(ctx, tx, code, uid, permit, input)
	})
}

func (s *PlanningService) ReadVersion(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, id int64) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		return pc.ReadProductCenterVersionInTransaction(ctx, tx, code, uid, permit, id)
	})
}

func (s *PlanningService) ReadPlan(ctx context.Context, code, uid string, versionID int64, permit, requestPermit pc.AuthorizationPermit) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		return pc.ReadLightweightVersionPlanInTransaction(ctx, tx, code, uid, versionID, permit, requestPermit)
	})
}

func (s *PlanningService) ListPlanItems(ctx context.Context, code, uid string, versionID int64, permit, requestPermit pc.AuthorizationPermit, q pc.LightweightVersionPlanItemQuery) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		return pc.ListLightweightVersionPlanItemsInTransaction(ctx, tx, code, uid, versionID, permit, requestPermit, q)
	})
}
