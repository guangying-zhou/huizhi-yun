// Package enterprisecontracts contains opt-in local contract services; no HTTP route is registered.
package enterprisecontracts

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ActivationIdentity struct {
	Key                                 e.BindingKey
	ActorUID, RequestID, IdempotencyKey string
}
type ActivationAuthorizationIdentity struct {
	ActivationIdentity
	ContractCode, SchemaVersion string
	Generation                  uint64
}
type ActivationGrant struct {
	Identity                            ActivationAuthorizationIdentity
	ExpiresAt                           time.Time
	AltocContractEdit, AimsProjectWrite bool
	AltocAccess                         string
	DepartmentCodes                     []string
}

// Authorize must derive both domains' current permissions using the supplied tx.
// No default grant, BFF body scope, or user-selected schema is accepted.
type ActivationAuthorizer interface {
	AuthorizeContractActivation(context.Context, *sql.Tx, ActivationAuthorizationIdentity) (ActivationGrant, error)
}
type DeploymentBinding struct{ AltocDeployment, AimsDeployment, AltocClient string }
type ActivationService struct {
	registry                           *e.Registry
	altocWriter, aimsWriter, scheduler e.ResolveRequest
	source                             io.TrustedContext
	targetDeployment                   string
	storage                            altoc.ContractStorage
	sourceRepository                   *io.Repository
	targetRepository                   *io.ReceiptRepository
	altoc                              *altoc.Adapter
	aims                               *aims.Adapter
}

func ActivationAltocViews() []string {
	return []string{"customer", "opportunity", "contract", "contract_payment_term", "contract_line", "contract_obligation", "contract_billing_schedule", "contract_project_link", "contract_project_line_rel", "contract_project_obligation_rel", "contract_delivery_asset_plan", "service_agreement", "receivable_plan", "contract_orchestration_job", "contract_orchestration_step"}
}
func ActivationAimsViews() []string {
	return []string{"aims_projects", "aims_project_members", "project_lifecycle_events", "project_counters", "milestones"}
}

func NewActivationService(ctx context.Context, registry *e.Registry, binding e.Binding, deployments DeploymentBinding, altocAdapter *altoc.Adapter, aimsAdapter *aims.Adapter) (*ActivationService, error) {
	if registry == nil || altocAdapter == nil || aimsAdapter == nil || strings.TrimSpace(deployments.AltocDeployment) == "" || strings.TrimSpace(deployments.AimsDeployment) == "" || deployments.AltocClient != "altoc.runtime" {
		return nil, e.ErrBindingMismatch
	}
	s := &ActivationService{registry: registry, altoc: altocAdapter, aims: aimsAdapter, targetDeployment: deployments.AimsDeployment}
	requests := []e.ResolveRequest{}
	for _, domain := range []string{"altoc", "aims"} {
		d, ok := binding.Domains[domain]
		if !ok {
			return nil, e.ErrBindingNotFound
		}
		requests = append(requests, e.ResolveRequest{Key: binding.Key, Domain: domain, OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Write})
	}
	s.altocWriter, s.aimsWriter = requests[0], requests[1]
	s.scheduler = s.altocWriter
	s.scheduler.Operation = e.Scheduler
	a, err := registry.Resolve(s.altocWriter)
	if err != nil {
		return nil, err
	}
	b, err := registry.Resolve(s.aimsWriter)
	if err != nil {
		return nil, err
	}
	scheduler, err := registry.Resolve(s.scheduler)
	if err != nil {
		return nil, err
	}
	if a.DB != b.DB || a.DB != scheduler.DB || a.Key != b.Key || a.Generation != b.Generation || a.SchemaVersion != b.SchemaVersion {
		return nil, e.ErrBindingMismatch
	}
	if err = e.VerifyCompatibilityViews(ctx, a.DB, binding, "altoc", ActivationAltocViews()); err != nil {
		return nil, err
	}
	if err = e.VerifyCompatibilityViews(ctx, b.DB, binding, "aims", ActivationAimsViews()); err != nil {
		return nil, err
	}
	names := []string{}
	for _, logical := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable", "audit_log", "domain_event_outbox"} {
		name, err := a.Table(logical)
		if err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	tables, err := io.NewOutboxTables(names[0], names[1], names[2], names[3])
	if err != nil {
		return nil, err
	}
	s.storage, err = altoc.NewContractStorage(names[4], names[5])
	if err != nil {
		return nil, err
	}
	s.sourceRepository, err = io.NewRepository(a.DB, io.WithOutboxTables(tables))
	if err != nil {
		return nil, err
	}
	receipt, err := b.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	if receipt == names[2] {
		return nil, e.ErrBindingMismatch
	}
	s.targetRepository, err = io.NewReceiptRepository(b.DB, io.WithReceiptTable(receipt))
	if err != nil {
		return nil, err
	}
	s.source = io.TrustedContext{TenantCode: binding.Key.Tenant, DeploymentCode: deployments.AltocDeployment, SourceApp: "altoc", ServiceClientID: deployments.AltocClient, OutboxTables: &tables}
	return s, nil
}
func (s *ActivationService) Activate(ctx context.Context, identity ActivationIdentity, contractCode string, authorizer ActivationAuthorizer) (map[string]any, error) {
	if s == nil || authorizer == nil || identity.Key != s.altocWriter.Key || strings.TrimSpace(identity.ActorUID) == "" || identity.ActorUID == "system" || strings.TrimSpace(identity.IdempotencyKey) == "" || strings.TrimSpace(contractCode) == "" {
		return nil, e.ErrBindingMismatch
	}
	// Internal consumption requires explicit scheduler registration as well as both writers.
	if _, err := s.registry.Resolve(s.scheduler); err != nil {
		return nil, err
	}
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.altocWriter, s.aimsWriter)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	expected := ActivationAuthorizationIdentity{ActivationIdentity: identity, ContractCode: contractCode, SchemaVersion: s.altocWriter.SchemaVersion, Generation: s.altocWriter.Generation}
	grant, err := authorizer.AuthorizeContractActivation(ctx, tx, expected)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if grant.Identity != expected || !grant.AltocContractEdit || !grant.AimsProjectWrite || !grant.ExpiresAt.After(now) || grant.ExpiresAt.After(now.Add(15*time.Second)) {
		return nil, fmt.Errorf("%w: missing or stale", ErrActivationAuthorization)
	}
	switch grant.AltocAccess {
	case "all", "self", "dept", "self_dept":
	default:
		return nil, ErrActivationAuthorization
	}
	scoped, err := s.storage.Context(ctx)
	if err != nil {
		return nil, err
	}
	source := s.source
	source.RequestID = identity.RequestID
	body := map[string]any{"current_user": identity.ActorUID, "current_user_scopes": []string{"altoc:contract:edit"}, "current_user_altoc_access": grant.AltocAccess, "current_user_altoc_dept_codes": append([]string(nil), grant.DepartmentCodes...), "idempotencyKey": identity.IdempotencyKey, io.TrustedTenantCodeKey: source.TenantCode, io.TrustedDeploymentCodeKey: source.DeploymentCode, io.TrustedSourceAppKey: source.SourceApp, io.TrustedServiceClientIDKey: source.ServiceClientID, io.TrustedRequestIDKey: source.RequestID}
	result, err := s.altoc.ExecuteLocalContractActivationInTransaction(scoped, tx, source, s.targetDeployment, s.sourceRepository, s.targetRepository, s.aims, contractCode, body)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
