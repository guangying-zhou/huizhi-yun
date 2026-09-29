package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseMilestoneRolloverViewNames lists every logical table the scheduled
// rollover reads or writes, so a missing compatibility view fails this entry
// point instead of silently reading another store.
func EnterpriseMilestoneRolloverViewNames() []string {
	return []string{"milestones", "milestone_cycle_snapshots", "aims_projects", "work_items", "work_item_service_ext", "time_entries", "project_cost_summary"}
}

// RolloverDueMilestonesInTransactions is the unified scheduler form of
// rolloverDueProjectMilestones. begin must return a generation-bound
// transaction; the scan and each milestone run in their own one, so a stale
// generation stops further rollovers without undoing committed periods.
func RolloverDueMilestonesInTransactions(ctx context.Context, begin func(context.Context) (*sql.Tx, error), binding e.Binding, limit int, carryover string) (map[string]any, error) {
	if begin == nil || limit < 1 || limit > 200 || (carryover != "auto" && carryover != "manual") {
		return nil, httperror.New(http.StatusBadRequest, "enterprise_milestone_rollover_input_invalid", "Invalid milestone rollover input")
	}
	due, err := scanDueMilestones(ctx, begin, binding, limit)
	if err != nil {
		return nil, err
	}
	results := make([]map[string]any, 0, len(due))
	pending := make([]map[string]any, 0)
	failures := make([]map[string]any, 0)
	for _, row := range due {
		projectCode := strings.TrimSpace(fmt.Sprint(row["project_code"]))
		milestoneID, err := int64MapValue(row, "milestone_id")
		if err != nil {
			failures = append(failures, map[string]any{"projectCode": projectCode, "error": err.Error()})
			continue
		}
		result, err := rolloverOneInTransaction(ctx, begin, projectCode, milestoneID, carryover)
		if err != nil {
			var domainError httperror.Error
			if !asDomainError(err, &domainError) {
				// Generation or storage failures are not per-item outcomes: stop so
				// the worker retries against the current owner.
				return nil, err
			}
			failures = append(failures, map[string]any{"projectCode": projectCode, "milestoneId": milestoneID, "error": domainError.Message})
			continue
		}
		if bodyBool(result, "pending") {
			pending = append(pending, result)
			continue
		}
		results = append(results, result)
	}
	return map[string]any{
		"scanned": len(due), "rolled_over": len(results), "pending": len(pending), "failed": len(failures),
		"items": results, "pendingItems": pending, "failures": failures,
	}, nil
}

func scanDueMilestones(ctx context.Context, begin func(context.Context) (*sql.Tx, error), binding e.Binding, limit int) ([]map[string]any, error) {
	tx, err := begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = e.VerifyCompatibilityViewsTx(ctx, tx, binding, "aims", EnterpriseMilestoneRolloverViewNames()); err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "enterprise_milestone_rollover_views_unavailable", "Milestone rollover compatibility views are not installed")
	}
	rows, err := aimsQueryMaps(ctx, tx, `
		SELECT p.project_code, m.id AS milestone_id
		FROM milestones m
		INNER JOIN aims_projects p ON p.id = m.project_id
		WHERE m.mode = 'periodic'
		  AND m.status IN ('active', 'todo')
		  AND m.end_date IS NOT NULL
		  AND m.end_date <= CURDATE()
		  AND p.lifecycle_status <> 'archived'
		ORDER BY m.end_date ASC, m.id ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit()
}

func rolloverOneInTransaction(ctx context.Context, begin func(context.Context) (*sql.Tx, error), projectCode string, milestoneID int64, carryover string) (map[string]any, error) {
	tx, err := begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// The actor is fixed: a scheduler request cannot choose who performed it.
	result, err := rolloverProjectMilestoneTx(ctx, tx, projectCode, milestoneID, map[string]any{
		"carryover": carryover, "operator_uid": "system", "review_exempted": true, "scheduled": true,
	})
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

func asDomainError(err error, target *httperror.Error) bool {
	if typed, ok := err.(httperror.Error); ok {
		*target = typed
		return typed.Status >= 400 && typed.Status < 500
	}
	return false
}
