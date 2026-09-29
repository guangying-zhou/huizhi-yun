package aims

import (
	"context"
	"database/sql"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type enterpriseWriteBinding struct {
	registry         *e.Registry
	writer           e.ResolveRequest
	sourceDeployment string
	binding          e.Binding
	workerDeployment string
}

// Only server construction may inject this binding. Enterprise commands have
// no legacy DB fallback; ordinary Aims handlers retain their original behavior.
func (a *Adapter) ConfigureEnterpriseWrites(ctx context.Context, registry *e.Registry, binding e.Binding, sourceDeployment string, workerDeployments ...string) error {
	if a != nil {
		a.enterpriseWrites = nil
	}
	if a == nil || a.Adapter == nil || registry == nil || sourceDeployment == "" {
		return e.ErrBindingNotFound
	}
	domain, ok := binding.Domains["aims"]
	if !ok {
		return e.ErrBindingNotFound
	}
	names := []string{"aims_projects", "aims_project_members", "project_portfolios", "project_activity_logs", "project_lifecycle_events", "project_template_sets", "project_template_versions", "project_counters", "milestones", "deliverables", "work_items", "work_item_changelog", "aims_project_products", "product_versions", "product_version_features", "product_version_logs"}
	// Existing source validators use the adapter pool; verify it is the registered
	// store and its logical SQL names resolve to the registered physical tables.
	if err := e.VerifyCompatibilityViews(ctx, a.DB(), binding, "aims", names); err != nil {
		return err
	}
	a.enterpriseWrites = &enterpriseWriteBinding{registry: registry, writer: e.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Write}, sourceDeployment: sourceDeployment, binding: binding}
	if len(workerDeployments) == 1 {
		a.enterpriseWrites.workerDeployment = workerDeployments[0]
	}
	return nil
}

func (a *Adapter) beginEnterpriseWrite(ctx context.Context, identity EnterpriseProjectCreateIdentity) (*sql.Tx, *io.ReceiptRepository, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, nil, err
	}
	b := a.enterpriseWrites
	if identity.Tenant != b.writer.Key.Tenant || identity.SourceDeployment != b.sourceDeployment || identity.TargetDeployment != b.writer.Key.RuntimeDeployment {
		return nil, nil, e.ErrBindingMismatch
	}
	return a.beginBoundEnterpriseTransaction(ctx)
}

func (a *Adapter) beginBoundEnterpriseTransaction(ctx context.Context) (*sql.Tx, *io.ReceiptRepository, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, nil, err
	}
	b := a.enterpriseWrites
	tx, resolved, err := b.registry.BeginWriteTransaction(ctx, b.writer)
	if err != nil {
		return nil, nil, err
	}
	table, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	repo, err := io.NewReceiptRepository(resolved[0].DB, io.WithReceiptTable(table))
	if err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	return tx, repo, nil
}

func (a *Adapter) requireEnterpriseWriter() error {
	if a == nil || a.enterpriseWrites == nil {
		return httperror.New(503, "enterprise_aims_writer_unavailable", "Unified Aims writer is not configured")
	}
	return nil
}

// enterpriseOutbox resolves this adapter's registered Aims outbox tables so that
// domain code writing outbox rows outside the Repository targets the owning
// domain's physical tables. Without a configured Enterprise writer it returns an
// empty context, which leaves legacy per-application SQL byte for byte.
func (a *Adapter) enterpriseOutbox() (io.TrustedContext, error) {
	if a == nil || a.enterpriseWrites == nil {
		return io.TrustedContext{}, nil
	}
	resolved, err := a.enterpriseWrites.registry.Resolve(a.enterpriseWrites.writer)
	if err != nil {
		return io.TrustedContext{}, err
	}
	names := make([]string, 0, 4)
	for _, logical := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
		physical, err := resolved.Table(logical)
		if err != nil {
			return io.TrustedContext{}, err
		}
		names = append(names, physical)
	}
	tables, err := io.NewOutboxTables(names[0], names[1], names[2], names[3])
	if err != nil {
		return io.TrustedContext{}, err
	}
	return io.TrustedContext{OutboxTables: &tables}, nil
}
