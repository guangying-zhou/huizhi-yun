package people

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func performanceCycleServiceAction(path string, action string) (string, bool) {
	prefix := "/v1/people/service/performance-cycles/"
	suffix := ":" + action
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	cycleCode := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if !singleSegment(cycleCode) {
		return "", false
	}
	return cycleCode, true
}

func (a *Adapter) confirmPerformanceCycle(ctx context.Context, cycleCode string, query url.Values, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	status, err := lockPerformanceCycleStatus(ctx, tx, cycleCode)
	if err != nil {
		return nil, err
	}
	if status == "cancelled" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_cancelled", "Cancelled performance cycle cannot be confirmed")
	}
	if status == "closed" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_closed", "Closed performance cycle cannot be confirmed again")
	}

	contributionCount, err := performanceCycleContributionCountTx(ctx, tx, cycleCode)
	if err != nil {
		return nil, err
	}
	if contributionCount == 0 {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_empty", "Performance cycle has no contribution snapshots to confirm")
	}

	operator := peopleRuntimeActorFromRequest(query, body)
	changed := status != "confirmed"
	if changed {
		workflowInstanceID := cleanBodyString(body, "workflow_instance_id", "workflowInstanceId")
		if _, err := tx.ExecContext(ctx, `
			UPDATE people_performance_cycles
			SET status = 'confirmed',
			    workflow_instance_id = COALESCE(NULLIF(?, ''), workflow_instance_id),
			    confirmed_at = COALESCE(confirmed_at, NOW()),
			    updated_by = COALESCE(NULLIF(?, ''), updated_by),
			    updated_at = NOW()
			WHERE cycle_code = ?
			  AND status = ?
		`, workflowInstanceID, operator, cycleCode, status); err != nil {
			return nil, err
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE people_contribution_snapshots
			SET confirmed_at = COALESCE(confirmed_at, NOW()),
			    updated_by = COALESCE(NULLIF(?, ''), updated_by),
			    updated_at = NOW()
			WHERE cycle_code = ?
		`, operator, cycleCode); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updatedCycle, err := a.performanceCycleForAction(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"cycle":              updatedCycle,
		"cycle_code":         cycleCode,
		"status":             cleanAnyString(updatedCycle["status"]),
		"contribution_count": contributionCount,
		"changed":            changed,
		"idempotent":         !changed,
	}, nil
}

func (a *Adapter) closePerformanceCycle(ctx context.Context, cycleCode string, query url.Values, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	status, err := lockPerformanceCycleStatus(ctx, tx, cycleCode)
	if err != nil {
		return nil, err
	}
	if status == "cancelled" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_cancelled", "Cancelled performance cycle cannot be closed")
	}
	if status != "confirmed" && status != "closed" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_not_confirmed", "Only confirmed performance cycle can be closed")
	}

	operator := peopleRuntimeActorFromRequest(query, body)
	changed := status != "closed"
	if changed {
		if _, err := tx.ExecContext(ctx, `
			UPDATE people_performance_cycles
			SET status = 'closed',
			    closed_at = COALESCE(closed_at, NOW()),
			    updated_by = COALESCE(NULLIF(?, ''), updated_by),
			    updated_at = NOW()
			WHERE cycle_code = ?
			  AND status = 'confirmed'
		`, operator, cycleCode); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updatedCycle, err := a.performanceCycleForAction(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"cycle":      updatedCycle,
		"cycle_code": cycleCode,
		"status":     cleanAnyString(updatedCycle["status"]),
		"changed":    changed,
		"idempotent": !changed,
	}, nil
}

func lockPerformanceCycleStatus(ctx context.Context, tx *sql.Tx, cycleCode string) (string, error) {
	var status string
	err := tx.QueryRowContext(ctx, `
		SELECT status
		FROM people_performance_cycles
		WHERE cycle_code = ?
		FOR UPDATE
	`, cycleCode).Scan(&status)
	if err == sql.ErrNoRows {
		return "", httperror.New(http.StatusNotFound, "performance_cycle_not_found", "Performance cycle not found")
	}
	return status, err
}

func performanceCycleContributionCountTx(ctx context.Context, tx *sql.Tx, cycleCode string) (int64, error) {
	var count int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM people_contribution_snapshots
		WHERE cycle_code = ?
	`, cycleCode).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (a *Adapter) cancelPerformanceCycleFromWorkflow(ctx context.Context, cycleCode string, workflowInstanceID string) (bool, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	status, err := lockPerformanceCycleStatus(ctx, tx, cycleCode)
	if err != nil {
		return false, err
	}
	if status == "confirmed" || status == "closed" {
		return false, httperror.New(http.StatusConflict, "performance_cycle_immutable", "Confirmed or closed performance cycle cannot be changed by Workflow callback")
	}
	changed := status != "cancelled"
	if changed {
		if _, err := tx.ExecContext(ctx, `
			UPDATE people_performance_cycles
			SET status = 'cancelled',
			    workflow_instance_id = COALESCE(NULLIF(?, ''), workflow_instance_id),
			    updated_at = NOW()
			WHERE cycle_code = ?
			  AND status = ?
		`, workflowInstanceID, cycleCode, status); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return changed, nil
}

func (a *Adapter) performanceCycleForAction(ctx context.Context, cycleCode string) (map[string]any, error) {
	cycle, err := a.queryRowMap(ctx, `
		SELECT *
		FROM people_performance_cycles
		WHERE cycle_code = ?
		LIMIT 1
	`, cycleCode)
	if err != nil {
		return nil, err
	}
	if cycle == nil {
		return nil, httperror.New(http.StatusNotFound, "performance_cycle_not_found", "Performance cycle not found")
	}
	return cycle, nil
}
