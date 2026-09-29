package enterpriseplanning

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// LightweightHandoffService is initialized separately because project delivery
// requires additional migrated tables. There is no synthetic or allow-all target.
type LightweightHandoffService struct{ planning *PlanningService }

func NewLightweightHandoffService(ctx context.Context, registry *enterprise.Registry, binding enterprise.Binding) (*LightweightHandoffService, error) {
	planning, err := NewPlanningService(ctx, registry, binding)
	if err != nil {
		return nil, err
	}
	resolved, err := registry.Resolve(planning.writer)
	if err != nil {
		return nil, err
	}
	views := HandoffViewNames()
	if err = enterprise.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", views); err != nil {
		return nil, err
	}
	return &LightweightHandoffService{planning: planning}, nil
}

func (s *LightweightHandoffService) HandoffPlanningItem(ctx context.Context, identity productcenter.CommandIdentity, planningPermit, requestPermit, versionPermit productcenter.AuthorizationPermit, projectPermit aims.ProductHandoffProjectPermit, input productcenter.PlanningHandoffInput) (productcenter.CommandResult, error) {
	if s == nil || s.planning == nil {
		return productcenter.CommandResult{}, enterprise.ErrBindingNotFound
	}
	return s.planning.execute(ctx, func(tx *sql.Tx) (productcenter.CommandResult, error) {
		// This service only registers the lightweight dependency closure. Reject
		// cycle paths before they can reach unregistered legacy cycle SQL.
		if input.PlannedVersionID < 1 || input.PlannedVersionFeatureID < 1 {
			return productcenter.CommandResult{}, httperror.New(409, "product_version_plan_simple_required", "轻量转交需要已确认的版本范围")
		}
		// Keep owning lock order: product root precedes version/project locks.
		if err := productcenter.AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "handoff", planningPermit); err != nil {
			return productcenter.CommandResult{}, err
		}
		var mode string
		if err := tx.QueryRowContext(ctx, "SELECT planning_mode FROM product_versions WHERE id=? AND product_code=?", input.PlannedVersionID, identity.ProductCode).Scan(&mode); err != nil {
			return productcenter.CommandResult{}, err
		}
		if mode != "simple" {
			return productcenter.CommandResult{}, httperror.New(409, "product_version_plan_simple_required", "该内部路径仅支持轻量版本")
		}
		target := aims.ProductPlanningHandoffTarget(identity.ProductCode, identity.ActorUID, input, versionPermit, projectPermit)
		return productcenter.HandoffPlanningItemInTransaction(ctx, tx, identity, planningPermit, requestPermit, input, target)
	})
}

// ProjectAuthorizationFacts is a trusted BFF preflight; Handoff rechecks these
// facts and the authenticated permission decision in its write transaction.
func (s *LightweightHandoffService) ProjectAuthorizationFacts(ctx context.Context, projectCode, actorUID string) (aims.ProductHandoffProjectFacts, error) {
	if s == nil || s.planning == nil {
		return aims.ProductHandoffProjectFacts{}, enterprise.ErrBindingNotFound
	}
	reader := s.planning.writer
	reader.Operation = enterprise.Read
	tx, _, err := s.planning.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return aims.ProductHandoffProjectFacts{}, err
	}
	defer tx.Rollback()
	facts, err := aims.LoadProductHandoffProjectFacts(ctx, tx, projectCode, actorUID)
	if err != nil {
		return aims.ProductHandoffProjectFacts{}, err
	}
	if err = tx.Commit(); err != nil {
		return aims.ProductHandoffProjectFacts{}, err
	}
	return facts, nil
}

// HandoffViewNames is shared by service verification and migration candidate generation.
func HandoffViewNames() []string {
	return []string{"product_planning_cycle_items", "aims_projects", "aims_project_members", "aims_project_products", "requirement_items", "requirement_contents", "requirement_item_contents", "project_documents", "work_items"}
}
