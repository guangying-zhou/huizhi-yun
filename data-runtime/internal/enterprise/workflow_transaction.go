package enterprise

import (
	"context"
	"database/sql"
)

// WorkflowTransactionRequirements is selected by the owning lane in code,
// never from an HTTP body. Full installation is validated at adapter construction.
type WorkflowTransactionRequirements struct{ Aims, Workflow []string }

// BeginWorkflowWriteTransaction is a B2 primitive, not a public business lane.
// reqs must come from local deployment configuration. Both domains are checked
// before callers may run owning-domain code or read an idempotency receipt.
func (r *Registry) BeginWorkflowWriteTransaction(ctx context.Context, b Binding, aims, workflow ResolveRequest, required WorkflowTransactionRequirements, participants ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	if aims.Domain != "aims" || workflow.Domain != "workflow" || aims.Operation != Write || workflow.Operation != Write || len(required.Aims) == 0 || len(required.Workflow) == 0 {
		return nil, nil, ErrBindingMismatch
	}
	b, err := normalizeBinding(b)
	if err != nil {
		return nil, nil, err
	}
	reqs := []ResolveRequest{aims, workflow}
	if len(participants) > 1 {
		return nil, nil, ErrBindingMismatch
	}
	if len(participants) == 1 {
		q := participants[0]
		if q.Domain != "altoc" || q.Operation != Write || q.Key != aims.Key || q.Generation != aims.Generation {
			return nil, nil, ErrBindingMismatch
		}
		reqs = append(reqs, q)
	}
	tx, resolved, err := r.BeginWriteTransaction(ctx, reqs...)
	if err != nil {
		return nil, nil, err
	}
	fail := func(err error) (*sql.Tx, []Resolved, error) { _ = tx.Rollback(); return nil, nil, err }
	r.mu.Lock()
	registered, ok := r.bindings[aims.Key]
	r.mu.Unlock()
	if !ok || b.Key != registered.Key || b.Storage != registered.Storage || b.SchemaVersion != registered.SchemaVersion || b.Generation != registered.Generation {
		return fail(ErrBindingMismatch)
	}
	for _, item := range resolved {
		domain, ok := b.Domains[item.Domain]
		if !ok || domain.OwnerDeployment != item.OwnerDeployment || len(domain.Tables) != len(item.tables) {
			return fail(ErrBindingMismatch)
		}
		for logical, physical := range item.tables {
			if domain.Tables[logical] != physical {
				return fail(ErrBindingMismatch)
			}
			for other, d := range b.Domains {
				if other != item.Domain {
					if _, collision := d.Tables[logical]; collision && !IsSharedPhysicalName(logical) {
						return fail(ErrCompatibilityView)
					}
				}
			}
		}
		if item.Domain == "altoc" {
			continue
		}
		names := required.Aims
		if item.Domain == "workflow" {
			names = required.Workflow
		}
		// Only this lane's logical names are inspected. The verifier itself
		// checks each physical table once; do not duplicate its ENGINE query.
		for _, name := range names {
			if IsSharedPhysicalName(name) {
				return fail(ErrCompatibilityView)
			}
		}
		if err = VerifyCompatibilityViewsTx(ctx, tx, b, item.Domain, names); err != nil {
			return fail(err)
		}
	}
	return tx, resolved, nil
}
