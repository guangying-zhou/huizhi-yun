package enterprise

import (
	"context"
	"database/sql"
	"fmt"
)

// BeginWriteTransaction resolves every participating writer and locks the
// persistent generation before domain code takes object locks. The caller owns
// commit/rollback and must not perform external calls while this transaction is
// open. Domain authorization, receipts and audit remain in the owning service.
func (r *Registry) BeginWriteTransaction(ctx context.Context, requests ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	return r.beginDomainTransaction(ctx, Write, sql.LevelReadCommitted, requests...)
}

// BeginSchedulerTransaction independently resolves scheduler authority and holds
// the persistent generation fence for claim/ack mutations. A unified reader or
// writer does not implicitly become the owner of background task consumption.
// Network delivery must happen after commit, never while this transaction is open.
func (r *Registry) BeginSchedulerTransaction(ctx context.Context, requests ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	return r.beginDomainTransaction(ctx, Scheduler, sql.LevelReadCommitted, requests...)
}

// BeginReadTransaction keeps generation stable for owning-domain queries that
// also lock objects for authorization. Separate consistent reads can observe
// different committed states; use BeginSnapshotReadTransaction for pagination.
// It does not grant
// write mode; callers must use read-only domain operations and never mutate facts.
func (r *Registry) BeginReadTransaction(ctx context.Context, requests ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	return r.beginDomainTransaction(ctx, Read, sql.LevelReadCommitted, requests...)
}

// BeginSnapshotReadTransaction keeps non-locking domain reads on the snapshot
// established by the first consistent read, including scope facts, counts and
// page rows. Locking reads still observe current facts under MySQL semantics.
// The registry SHARE lock fences generation changes until commit/rollback.
// ReadOnly is intentionally unset because owning-domain authorization may lock
// objects; callers must not execute business mutations through this read path.
func (r *Registry) BeginSnapshotReadTransaction(ctx context.Context, requests ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	return r.beginDomainTransaction(ctx, Read, sql.LevelRepeatableRead, requests...)
}

func (r *Registry) beginDomainTransaction(ctx context.Context, operation Operation, isolation sql.IsolationLevel, requests ...ResolveRequest) (*sql.Tx, []Resolved, error) {
	if len(requests) == 0 {
		return nil, nil, ErrBindingMismatch
	}
	resolved := make([]Resolved, 0, len(requests))
	for _, req := range requests {
		if req.Operation != operation {
			return nil, nil, ErrBindingMismatch
		}
		item, err := r.Resolve(req)
		if err != nil {
			return nil, nil, err
		}
		if len(resolved) > 0 {
			first := resolved[0]
			if item.DB != first.DB || item.Key != first.Key || item.SchemaVersion != first.SchemaVersion || item.Generation != first.Generation {
				return nil, nil, ErrBindingMismatch
			}
		}
		resolved = append(resolved, item)
	}
	first := resolved[0]
	tx, err := first.DB.BeginTx(ctx, &sql.TxOptions{Isolation: isolation})
	if err != nil {
		return nil, nil, err
	}
	var tenant, environment, deployment, version string
	var generation uint64
	err = tx.QueryRowContext(ctx, `SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE`).Scan(&tenant, &environment, &deployment, &version, &generation)
	if err != nil || tenant != first.Key.Tenant || environment != first.Key.Environment || deployment != first.Key.RuntimeDeployment || version != first.SchemaVersion || generation != first.Generation {
		_ = tx.Rollback()
		if err != nil {
			return nil, nil, fmt.Errorf("enterprise: persistent generation unavailable: %w", err)
		}
		return nil, nil, ErrBindingMismatch
	}
	return tx, resolved, nil
}
