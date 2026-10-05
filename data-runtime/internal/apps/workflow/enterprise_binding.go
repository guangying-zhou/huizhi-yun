package workflow

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"sort"
	"strings"
)

// EnterpriseViewNames excludes the shared receipt and the renamed physical
// parameter table. It never changes Assets' system_parameters view.
func EnterpriseViewNames() []string {
	out := make([]string, 0, len(requiredTables)-1)
	for _, name := range requiredTables {
		if name != "service_command_receipt" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

// NewEnterprise is selected only by the explicit workflowLane switch. It wraps the Registry
// pool without creating or owning an independent connection.
func NewEnterprise(ctx context.Context, registry *enterprise.Registry, binding enterprise.Binding, req enterprise.ResolveRequest) (*Adapter, error) {
	if registry == nil || req.Domain != "workflow" {
		return nil, enterprise.ErrBindingMismatch
	}
	resolved, err := registry.Resolve(req)
	if err != nil {
		return nil, err
	}
	if binding.Key != resolved.Key || binding.Generation != resolved.Generation || binding.SchemaVersion != resolved.SchemaVersion || binding.Domains["workflow"].OwnerDeployment != resolved.OwnerDeployment {
		return nil, enterprise.ErrBindingMismatch
	}
	for logical, physical := range binding.Domains["workflow"].Tables {
		table, err := resolved.Table(logical)
		if err != nil || table != "`"+physical+"`" {
			return nil, enterprise.ErrBindingMismatch
		}
	}
	if err = enterprise.VerifyCompatibilityViews(ctx, resolved.DB, binding, "workflow", EnterpriseViewNames()); err != nil {
		return nil, err
	}
	table, err := resolved.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	if table != "`workflow_service_command_receipt`" {
		return nil, enterprise.ErrBindingMismatch
	}
	physicalNames := []string{"service_command_receipt"}
	if _, ok := binding.Domains["workflow"].Tables["workflow_system_parameters"]; ok {
		physicalNames = append(physicalNames, "workflow_system_parameters")
	}
	for _, name := range physicalNames {
		physical, err := resolved.Table(name)
		if err != nil {
			return nil, err
		}
		var engine string
		if err = resolved.DB.QueryRowContext(ctx, `SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'`, binding.Storage.Database, strings.Trim(physical, "`")).Scan(&engine); err != nil || engine != "InnoDB" {
			return nil, enterprise.ErrCompatibilityView
		}
	}
	a := &Adapter{db: resolved.DB, dbName: binding.Storage.Database}
	return a, nil
}

func (a *Adapter) enterpriseReceiptRepository(resolved enterprise.Resolved) (*integrationoperation.ReceiptRepository, error) {
	if resolved.Domain != "workflow" || resolved.DB != a.db {
		return nil, enterprise.ErrBindingMismatch
	}
	table, err := resolved.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	return integrationoperation.NewReceiptRepository(a.db, integrationoperation.WithReceiptTable(table))
}
