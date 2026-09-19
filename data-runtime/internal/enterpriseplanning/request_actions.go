package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func (s *RequestService) execute(ctx context.Context, apply func(*sql.Tx) (pc.CommandResult, error)) (pc.CommandResult, error) {
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return pc.CommandResult{}, err
	}
	defer tx.Rollback()
	out, err := apply(tx)
	if err != nil {
		return pc.CommandResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.CommandResult{}, err
	}
	return out, nil
}
func (s *RequestService) Edit(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, v pc.RequestEdit) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.EditProductRequestInTransaction(ctx, tx, id, p, v)
	})
}
func (s *RequestService) Decide(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, v pc.RequestDecision) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.DecideProductRequestInTransaction(ctx, tx, id, p, v, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *RequestService) AddSource(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, v pc.ManualRequestSource) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.AddManualRequestSourceInTransaction(ctx, tx, id, p, v)
	})
}
func (s *RequestService) DeleteSource(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, v pc.RequestSourceDelete) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.DeleteManualRequestSourceInTransaction(ctx, tx, id, p, v)
	})
}
func (s *RequestService) ListSources(ctx context.Context, code, uid string, p pc.AuthorizationPermit, v pc.RequestSourcePageQuery) (pc.RequestSourcePage, error) {
	reader := s.writer
	reader.Operation = enterprise.Read
	tx, _, err := s.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return pc.RequestSourcePage{}, err
	}
	defer tx.Rollback()
	out, err := pc.ListRequestSourcesInTransaction(ctx, tx, code, uid, p, v)
	if err != nil {
		return pc.RequestSourcePage{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.RequestSourcePage{}, err
	}
	return out, nil
}

func (s *RequestService) Merge(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, v pc.RequestMerge) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.MergeProductRequestInTransaction(ctx, tx, id, p, v, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
