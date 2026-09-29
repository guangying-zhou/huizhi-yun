package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// ComponentService preserves the Aims owning tree and reference constraints.
// These commands do not acquire an Assets identity or modify source ownership.
type ComponentService struct {
	registry *e.Registry
	writer   e.ResolveRequest
}

func NewComponentService(ctx context.Context, registry *e.Registry, binding e.Binding) (*ComponentService, error) {
	if registry == nil {
		return nil, e.ErrBindingNotFound
	}
	d, ok := binding.Domains["aims"]
	if !ok {
		return nil, e.ErrBindingNotFound
	}
	writer := e.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Write}
	resolved, err := registry.Resolve(writer)
	if err != nil {
		return nil, err
	}
	if err = e.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", ComponentViewNames()); err != nil {
		return nil, err
	}
	return &ComponentService{registry, writer}, nil
}
func (s *ComponentService) execute(ctx context.Context, apply func(*sql.Tx) (pc.CommandResult, error)) (pc.CommandResult, error) {
	if s == nil || s.registry == nil {
		return pc.CommandResult{}, e.ErrBindingNotFound
	}
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return pc.CommandResult{}, err
	}
	defer tx.Rollback()
	result, err := apply(tx)
	if err != nil {
		return pc.CommandResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.CommandResult{}, err
	}
	return result, nil
}
func (s *ComponentService) Create(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.ProductComponentDraft) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.CreateProductComponentInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *ComponentService) Edit(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.ProductComponentEdit) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.EditProductComponentInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *ComponentService) Move(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.ProductComponentMove) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.MoveProductComponentInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *ComponentService) Delete(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.ProductComponentDelete) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.DeleteProductComponentInTransaction(ctx, tx, id, permit, input)
	})
}

// ComponentViewNames is shared by service verification and migration candidate generation.
func ComponentViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_components", "product_component_sources", "product_features", "product_requests"}
}
