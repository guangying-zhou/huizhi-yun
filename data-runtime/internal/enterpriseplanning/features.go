package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

type FeatureService struct {
	registry       *e.Registry
	writer         e.ResolveRequest
	feedbackSource *e.OutboundSource
}

func NewFeatureService(ctx context.Context, registry *e.Registry, binding e.Binding, sources ...e.OutboundSource) (*FeatureService, error) {
	if registry == nil || len(sources) > 1 {
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
	views := FeatureViewNames()
	if err = e.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", views); err != nil {
		return nil, err
	}
	service := &FeatureService{registry: registry, writer: writer}
	if len(sources) == 1 {
		source := sources[0]
		if err = source.Validate(writer, resolved); err != nil {
			return nil, err
		}
		service.feedbackSource = &source
	}
	return service, nil
}
func featureTransaction[T any](ctx context.Context, s *FeatureService, write bool, apply func(*sql.Tx) (T, error)) (out T, err error) {
	if s == nil || s.registry == nil {
		return out, e.ErrBindingNotFound
	}
	q := s.writer
	var tx *sql.Tx
	if write {
		tx, _, err = s.registry.BeginWriteTransaction(ctx, q)
	} else {
		q.Operation = e.Read
		tx, _, err = s.registry.BeginReadTransaction(ctx, q)
	}
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	out, err = apply(tx)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *FeatureService) Create(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.FeatureDraft) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.CreateProductFeatureInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *FeatureService) Edit(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.FeatureEdit) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.EditProductFeatureInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *FeatureService) Delete(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.FeatureDelete) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.DeleteProductFeatureInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *FeatureService) AssignComponent(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.FeatureComponentAssignment) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.AssignProductFeatureComponentInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *FeatureService) Lifecycle(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.FeatureLifecycleChange) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ChangeFeatureLifecycleInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *FeatureService) ChangeRequest(ctx context.Context, id pc.CommandIdentity, requestPermit, featurePermit pc.AuthorizationPermit, input pc.FeatureRequestChange) (pc.CommandResult, error) {
	return featureTransaction(ctx, s, true, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ChangeFeatureRequestInTransaction(ctx, tx, id, requestPermit, featurePermit, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *FeatureService) List(ctx context.Context, code, actor string, permit pc.AuthorizationPermit, q pc.FeaturePageQuery) (pc.FeaturePage, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.FeaturePage, error) {
		return pc.ListProductFeaturesInTransaction(ctx, tx, code, actor, permit, q)
	})
}
func (s *FeatureService) Requests(ctx context.Context, code, actor string, permit, featurePermit pc.AuthorizationPermit, q pc.FeatureRequestPageQuery) (pc.RequestPage, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.RequestPage, error) {
		return pc.ListFeatureRequestsInTransaction(ctx, tx, code, actor, permit, featurePermit, q)
	})
}
func (s *FeatureService) Roadmap(ctx context.Context, code, actor string, permit, featurePermit pc.AuthorizationPermit, q pc.FeatureRoadmapQuery) (pc.FeatureRoadmapView, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.FeatureRoadmapView, error) {
		return pc.ReadFeatureRoadmapInTransaction(ctx, tx, code, actor, permit, featurePermit, q)
	})
}
func (s *FeatureService) Unscheduled(ctx context.Context, code, actor string, permit, featurePermit pc.AuthorizationPermit, q pc.FeatureUnscheduledQuery) (pc.PlanningPage, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.PlanningPage, error) {
		return pc.ListFeatureUnscheduledInTransaction(ctx, tx, code, actor, permit, featurePermit, q)
	})
}
func (s *FeatureService) Read(ctx context.Context, code, actor, bizID string, permit pc.AuthorizationPermit) (pc.FeatureRecord, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.FeatureRecord, error) {
		return pc.ReadProductFeatureInTransaction(ctx, tx, code, actor, bizID, permit)
	})
}

func (s *FeatureService) Cycles(ctx context.Context, code, actor string, permit pc.AuthorizationPermit, q pc.PlanningCyclePageQuery) (pc.PlanningCyclePage, error) {
	return featureTransaction(ctx, s, false, func(tx *sql.Tx) (pc.PlanningCyclePage, error) {
		return pc.ListPlanningCyclesInTransaction(ctx, tx, code, actor, permit, q)
	})
}

// FeatureViewNames is shared by service verification and migration candidate generation.
func FeatureViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_features", "product_components", "product_requests", "product_request_features", "product_feedback_bindings", "product_versions", "product_version_features", "product_version_plans", "product_version_plan_scopes", "product_version_plan_confirmations", "product_planning_items", "product_planning_item_requests", "product_planning_cycles", "product_planning_cycle_items", "product_release_events", "product_release_records"}
}
