package enterpriseplanning

import (
	"context"
	"database/sql"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// VersionService preserves existing version lifecycle and release facts. It
// never fabricates a release or omits an owning-domain feedback side effect.
type VersionService struct {
	registry       *e.Registry
	writer         e.ResolveRequest
	feedbackSource *e.OutboundSource
}

func NewVersionService(ctx context.Context, registry *e.Registry, binding e.Binding, sources ...e.OutboundSource) (*VersionService, error) {
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
	if err = e.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", VersionViewNames()); err != nil {
		return nil, err
	}
	service := &VersionService{registry: registry, writer: writer}
	if len(sources) > 1 {
		return nil, e.ErrBindingMismatch
	}
	if len(sources) == 1 {
		if err = sources[0].Validate(writer, resolved); err != nil {
			return nil, err
		}
		source := sources[0]
		service.feedbackSource = &source
	}
	return service, nil
}
func (s *VersionService) execute(ctx context.Context, apply func(*sql.Tx) (pc.CommandResult, error)) (pc.CommandResult, error) {
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
func (s *VersionService) Edit(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionEdit) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.EditProductCenterVersionInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}

func (s *VersionService) DeliverScope(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionScopeDelivery) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ConfirmProductVersionScopeDeliveryInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}

func (s *VersionService) ReopenScope(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionScopeReopen) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ReopenProductVersionScopeInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *VersionService) EditScope(ctx context.Context, id pc.CommandIdentity, versionPermit, planningPermit pc.AuthorizationPermit, input pc.ProductVersionScopeEdit) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.EditProductVersionScopeInTransaction(ctx, tx, id, versionPermit, planningPermit, input)
	})
}
func (s *VersionService) ChangeScopeVisibility(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.ProductVersionScopeVisibility) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ChangeProductVersionScopeVisibilityInTransaction(ctx, tx, id, permit, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *VersionService) UpdateLegacyScopeCriteria(ctx context.Context, id pc.CommandIdentity, permit pc.AuthorizationPermit, input pc.LegacyProductVersionScopeCriteria) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.UpdateLegacyProductVersionScopeCriteriaInTransaction(ctx, tx, id, permit, input)
	})
}
func (s *VersionService) Delete(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionDeleteInput) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.DeleteProductCenterVersionInTransaction(ctx, tx, id, p, input)
	})
}
func (s *VersionService) Transition(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionTransitionInput) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.TransitionProductVersionInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *VersionService) Reopen(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionReopenInput) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ReopenProductVersionInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}
func (s *VersionService) Archive(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionArchiveInput) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.ArchiveProductVersionInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey))
	})
}

func (s *VersionService) Accept(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionAcceptanceInput, reviewHash string) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.AcceptProductVersionInTransaction(ctx, tx, id, p, input, reviewHash)
	})
}

func (s *VersionService) AcceptancePreview(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID int64) (pc.ProductVersionAcceptancePreview, error) {
	if s == nil || s.registry == nil {
		return pc.ProductVersionAcceptancePreview{}, e.ErrBindingNotFound
	}
	reader := s.writer
	reader.Operation = e.Read
	tx, _, err := s.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return pc.ProductVersionAcceptancePreview{}, err
	}
	defer tx.Rollback()
	out, err := pc.PreviewProductVersionAcceptanceInTransaction(ctx, tx, code, uid, permit, versionID)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s *VersionService) Publish(ctx context.Context, id pc.CommandIdentity, p pc.AuthorizationPermit, input pc.ProductVersionPublishInput, reviewHash string) (pc.CommandResult, error) {
	return s.execute(ctx, func(tx *sql.Tx) (pc.CommandResult, error) {
		return pc.PublishProductVersionInTransaction(ctx, tx, id, p, input, s.feedbackSource.Context(s.writer, id.IdempotencyKey), reviewHash)
	})
}

// ExecutionProjectAuthorization exposes only facts of a project present in the
// authorized version review. The BFF must still evaluate project permissions.
func (s *VersionService) ExecutionProjectAuthorization(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, versionID, projectID int64) (map[string]any, error) {
	if s == nil || s.registry == nil {
		return nil, e.ErrBindingNotFound
	}
	reader := s.writer
	reader.Operation = e.Read
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, reader)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	preview, err := pc.PreviewProductVersionAcceptanceInTransaction(ctx, tx, code, uid, permit, versionID)
	if err != nil {
		return nil, err
	}
	linked := false
	for _, items := range [][]pc.VersionExecutionItem{preview.Execution.Targets, preview.Execution.OpenDefects} {
		for _, item := range items {
			if item.ProjectID == projectID {
				linked = true
			}
		}
	}
	if !linked {
		return nil, httperror.New(404, "version_execution_project_not_found", "Execution project not found")
	}
	out, err := aimsapp.LoadProjectAuthorizationObject(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	return out, tx.Commit()
}

// VersionViewNames is shared by service verification and migration candidate generation.
func VersionViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_versions", "product_features", "product_version_features", "product_version_plans", "product_version_plan_confirmations", "product_version_plan_scopes", "product_planning_items", "product_planning_dependencies", "product_requests", "product_feedback_bindings", "product_request_features", "product_release_records", "product_release_events", "product_version_acceptances", "work_items", "aims_project_products", "aims_projects", "aims_project_members"}
}
