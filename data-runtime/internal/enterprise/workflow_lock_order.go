package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"sort"
)

// ErrCompletionObjectMissing is mapped to 404/409 by the owning lane.
var ErrCompletionObjectMissing = errors.New("enterprise: completion object missing")

// CompletionLocks fixes the shared Aims/Workflow order. IDs are authoritative
// lookups from the owning services, never evidence of authorization by themselves.
type CompletionLocks struct {
	ProjectID               int64
	WorkItemIDs, RequestIDs []int64
	InstanceID              int64
	TaskIDs, ActionIDs      []int64
}

func LockCompletionObjects(ctx context.Context, tx *sql.Tx, aims, workflow Resolved, ids CompletionLocks) error {
	if tx == nil || aims.Domain != "aims" || workflow.Domain != "workflow" || aims.DB != workflow.DB || aims.Key != workflow.Key || aims.Generation != workflow.Generation || ids.ProjectID <= 0 || ids.InstanceID < 0 {
		return ErrBindingMismatch
	}
	groups := []struct {
		domain Resolved
		table  string
		ids    []int64
	}{{aims, "aims_projects", []int64{ids.ProjectID}}, {aims, "work_items", ids.WorkItemIDs}, {aims, "work_item_completion_requests", ids.RequestIDs}, {workflow, "flow_instances", nil}, {workflow, "flow_tasks", ids.TaskIDs}, {workflow, "flow_actions", ids.ActionIDs}}
	if ids.InstanceID > 0 {
		groups[3].ids = []int64{ids.InstanceID}
	}
	// Validate the whole plan before the first object lock. Receipt lock follows
	// these locks inside the existing owning receipt repository.
	for _, g := range groups {
		if len(g.ids) == 0 {
			continue
		}
		if _, err := g.domain.Table(g.table); err != nil {
			return err
		}
		for _, id := range g.ids {
			if id <= 0 {
				return ErrBindingMismatch
			}
		}
	}
	for _, g := range groups {
		if len(g.ids) == 0 {
			continue
		}
		table, _ := g.domain.Table(g.table)
		ordered := append([]int64(nil), g.ids...)
		sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
		var last int64
		for _, id := range ordered {
			if id == last {
				continue
			}
			last = id
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE id=? FOR UPDATE", id).Scan(&found); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return ErrCompletionObjectMissing
				}
				return err
			}
			if found != id {
				return ErrBindingMismatch
			}
		}
	}
	return nil
}
