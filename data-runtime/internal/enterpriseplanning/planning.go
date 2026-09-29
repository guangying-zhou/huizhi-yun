package enterpriseplanning

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// PlanningService coordinates the existing owning-domain operations. It has no
// fallback to legacy storage and never creates compatibility views on requests.
type PlanningService struct {
	registry       *enterprise.Registry
	writer         enterprise.ResolveRequest
	feedbackSource *enterprise.OutboundSource
}

func PlanningViewNames() []string {
	return []string{
		"product_workspaces", "product_members", "product_command_receipts", "product_activity_logs",
		"product_versions", "product_version_plans", "product_version_features", "product_version_plan_scopes", "product_version_plan_confirmations",
		"product_requests", "product_feedback_bindings", "product_request_features", "product_features", "product_components", "product_planning_items", "product_planning_item_requests", "product_planning_dependencies", "product_request_delivery_links",
		"product_documents", "product_document_creation_requests",
	}
}

func NewPlanningService(ctx context.Context, registry *enterprise.Registry, binding enterprise.Binding, sources ...enterprise.OutboundSource) (*PlanningService, error) {
	if registry == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	domain, ok := binding.Domains["aims"]
	if !ok {
		return nil, enterprise.ErrBindingNotFound
	}
	writer := enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Write}
	resolved, err := registry.Resolve(writer)
	if err != nil {
		return nil, err
	}
	if err = enterprise.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", PlanningViewNames()); err != nil {
		return nil, err
	}
	service := &PlanningService{registry: registry, writer: writer}
	if len(sources) > 1 {
		return nil, enterprise.ErrBindingMismatch
	}
	if len(sources) == 1 {
		if err := sources[0].Validate(writer, resolved); err != nil {
			return nil, err
		}
		source := sources[0]
		service.feedbackSource = &source
	}
	return service, nil
}

func (s *PlanningService) execute(ctx context.Context, apply func(*sql.Tx) (productcenter.CommandResult, error)) (productcenter.CommandResult, error) {
	if s == nil || s.registry == nil {
		return productcenter.CommandResult{}, enterprise.ErrBindingNotFound
	}
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return productcenter.CommandResult{}, err
	}
	defer tx.Rollback()
	out, err := apply(tx)
	if err != nil {
		return productcenter.CommandResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return productcenter.CommandResult{}, err
	}
	return out, nil
}
func (s *PlanningService) LinkProductDocument(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.ProductDocumentCreate) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.CreateProductDocumentInTransaction(ctx, tx, identity, permit, input)
	})
}
func (s *PlanningService) CreateProductCenterVersion(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.ProductVersionDraft) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.CreateProductCenterVersionInTransaction(ctx, tx, identity, permit, input)
	})
}
func (s *PlanningService) EditLightweightVersionPlan(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.LightweightVersionPlanEdit) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.EditLightweightVersionPlanInTransaction(ctx, tx, identity, permit, input)
	})
}
func (s *PlanningService) CreateLightweightVersionPlanItem(ctx context.Context, identity productcenter.CommandIdentity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit productcenter.AuthorizationPermit, input productcenter.LightweightVersionPlanItemCreate) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.CreateLightweightVersionPlanItemInTransaction(ctx, tx, identity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit, input, s.feedbackSource.Context(s.writer, identity.IdempotencyKey))
	})
}
func (s *PlanningService) EditLightweightVersionPlanItem(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.LightweightVersionPlanItemEdit) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.EditLightweightVersionPlanItemInTransaction(ctx, tx, identity, permit, input)
	})
}
func (s *PlanningService) DeleteLightweightVersionPlanItem(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.LightweightVersionPlanItemDelete) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.DeleteLightweightVersionPlanItemInTransaction(ctx, tx, identity, permit, input)
	})
}
func (s *PlanningService) ConfirmLightweightVersionPlan(ctx context.Context, identity productcenter.CommandIdentity, versionPermit, planningPermit productcenter.AuthorizationPermit, input productcenter.LightweightVersionPlanConfirm) (productcenter.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		return productcenter.ConfirmLightweightVersionPlanInTransaction(ctx, tx, identity, versionPermit, planningPermit, input)
	})
}
