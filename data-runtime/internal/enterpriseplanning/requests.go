// Package enterpriseplanning coordinates existing Aims domain commands on the
// registered unified store. It does not define a second product state machine.
package enterpriseplanning

import (
	"context"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

type RequestService struct {
	registry       *enterprise.Registry
	writer         enterprise.ResolveRequest
	feedbackSource *enterprise.OutboundSource
}

// NewRequestService verifies compatibility views once during initialization;
// request handlers must never create or replace views. Runtime deployment must
// reconstruct the service after a schema or path generation change.
func NewRequestService(ctx context.Context, registry *enterprise.Registry, binding enterprise.Binding, sources ...enterprise.OutboundSource) (*RequestService, error) {
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
	views := RequestViewNames()
	if err := enterprise.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", views); err != nil {
		return nil, err
	}
	if len(sources) > 1 {
		return nil, enterprise.ErrBindingMismatch
	}
	var source *enterprise.OutboundSource
	if len(sources) == 1 {
		if err := sources[0].Validate(writer, resolved); err != nil {
			return nil, err
		}
		value := sources[0]
		source = &value
	}
	return &RequestService{registry: registry, writer: writer, feedbackSource: source}, nil
}

// Create requires the authenticated boundary to bind identity and a fresh
// Console authorization permit. The domain rechecks workspace/member facts
// under its object lock, including before returning an idempotent receipt.
func (s *RequestService) Create(ctx context.Context, identity productcenter.CommandIdentity, permit productcenter.AuthorizationPermit, input productcenter.RequestDraft) (productcenter.CommandResult, error) {
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return productcenter.CommandResult{}, err
	}
	defer tx.Rollback()
	result, err := productcenter.CreateProductRequestInTransaction(ctx, tx, identity, permit, input)
	if err != nil {
		return productcenter.CommandResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return productcenter.CommandResult{}, err
	}
	return result, nil
}

// AuthorizationFacts is an internal BFF preflight, not a browser-readable API.
// It returns only the authenticated actor's relationship facts for Console's
// permission decision; Create rechecks them under the workspace lock.
func (s *RequestService) AuthorizationFacts(ctx context.Context, productCode, actorUID string) (productcenter.AuthorizationFacts, error) {
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return productcenter.AuthorizationFacts{}, err
	}
	defer tx.Rollback()
	facts, err := productcenter.LoadAuthorizationFacts(ctx, tx, productCode, actorUID)
	if err != nil {
		return productcenter.AuthorizationFacts{}, err
	}
	if err := tx.Commit(); err != nil {
		return productcenter.AuthorizationFacts{}, err
	}
	return facts, nil
}

func (s *RequestService) List(ctx context.Context, code, uid string, permit productcenter.AuthorizationPermit, query productcenter.RequestPageQuery) (productcenter.RequestPage, error) {
	reader := s.writer
	reader.Operation = enterprise.Read
	tx, _, err := s.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return productcenter.RequestPage{}, err
	}
	defer tx.Rollback()
	out, err := productcenter.ListProductRequestsInTransaction(ctx, tx, code, uid, permit, query)
	if err != nil {
		return productcenter.RequestPage{}, err
	}
	if err := tx.Commit(); err != nil {
		return productcenter.RequestPage{}, err
	}
	return out, nil
}

func (s *RequestService) Read(ctx context.Context, code, uid, bizID string, permit productcenter.AuthorizationPermit) (productcenter.RequestRecord, error) {
	reader := s.writer
	reader.Operation = enterprise.Read
	tx, _, err := s.registry.BeginReadTransaction(ctx, reader)
	if err != nil {
		return productcenter.RequestRecord{}, err
	}
	defer tx.Rollback()
	out, err := productcenter.ReadProductRequestInTransaction(ctx, tx, code, uid, bizID, permit)
	if err != nil {
		return productcenter.RequestRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return productcenter.RequestRecord{}, err
	}
	return out, nil
}

// RequestViewNames is shared by service verification and migration candidate generation.
func RequestViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_command_receipts", "product_requests", "product_components", "product_activity_logs", "product_versions", "product_version_plans", "product_version_plan_scopes", "product_version_plan_confirmations", "product_request_sources", "product_planning_items", "product_planning_item_requests", "product_feedback_bindings", "product_request_features", "product_version_features"}
}
