// Package lane can only be imported by the Workflow owning subtree.
package lane

import (
	"context"
	"database/sql"
	"encoding/json"
	d "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// transaction cannot be constructed or populated outside this package. It owns
// the generation fence, both resolutions, lock plan and immutable Directory facts.
type transaction struct {
	tx             *sql.Tx
	aims, workflow e.Resolved
	snapshot       d.WorkflowInitiatorSnapshot
	employees      d.WorkflowEmployees
}

func open(ctx context.Context, registry *e.Registry, binding e.Binding, locks e.CompletionLocks, required e.WorkflowTransactionRequirements, snapshot d.WorkflowInitiatorSnapshot, employees d.WorkflowEmployees) (*transaction, error) {
	if registry == nil {
		return nil, e.ErrBindingMismatch
	}
	req := func(domain string) e.ResolveRequest {
		return e.ResolveRequest{Key: binding.Key, Domain: domain, Operation: e.Write, OwnerDeployment: binding.Domains[domain].OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation}
	}
	tx, rs, err := registry.BeginWorkflowWriteTransaction(ctx, binding, req("aims"), req("workflow"), required)
	if err != nil {
		return nil, err
	}
	h := &transaction{tx: tx, aims: rs[0], workflow: rs[1], snapshot: snapshot, employees: employees}
	if err = e.LockCompletionObjects(ctx, tx, h.aims, h.workflow, locks); err != nil {
		tx.Rollback()
		return nil, err
	}
	return h, nil
}
func (t *transaction) AimsTransaction() (*sql.Tx, e.Resolved, error) {
	if t == nil || t.tx == nil {
		return nil, e.Resolved{}, e.ErrBindingMismatch
	}
	return t.tx, t.aims, nil
}
func (t *transaction) WorkflowTransaction() (*sql.Tx, e.Resolved, error) {
	if t == nil || t.tx == nil {
		return nil, e.Resolved{}, e.ErrBindingMismatch
	}
	return t.tx, t.workflow, nil
}
func (t *transaction) DirectorySnapshot() json.RawMessage { return t.snapshot.JSON() }
func (t *transaction) Employee(uid string) bool           { return t != nil && t.employees.Allows(uid) }
func (t *transaction) Commit() error                      { return t.tx.Commit() }
func (t *transaction) Rollback()                          { _ = t.tx.Rollback() }

type contextKey struct{}

func Context(ctx context.Context, t *transaction) context.Context {
	return context.WithValue(ctx, contextKey{}, t)
}
func FromContext(ctx context.Context) (*transaction, bool) {
	t, ok := ctx.Value(contextKey{}).(*transaction)
	return t, ok && t != nil
}

// Requests must carry issued Directory facts; decisions intentionally have none.
func OpenRequest(ctx context.Context, registry *e.Registry, binding e.Binding, locks e.CompletionLocks, required e.WorkflowTransactionRequirements, snapshot d.WorkflowInitiatorSnapshot, employees d.WorkflowEmployees) (*transaction, error) {
	if len(snapshot.JSON()) == 0 || snapshot.SHA256() == "" || snapshot.Context() == nil {
		return nil, httperror.New(503, "workflow_directory_snapshot_unavailable", "Workflow Directory snapshot unavailable")
	}
	return open(ctx, registry, binding, locks, required, snapshot, employees)
}

// OpenDecision issues a decision transaction without rechecking the initiator snapshot.
func OpenDecision(ctx context.Context, registry *e.Registry, binding e.Binding, locks e.CompletionLocks, required e.WorkflowTransactionRequirements, employees d.WorkflowEmployees) (*transaction, error) {
	return open(ctx, registry, binding, locks, required, d.WorkflowInitiatorSnapshot{}, employees)
}
