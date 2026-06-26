package people

import (
	"context"
	"database/sql"
	"net/http"
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

func (a *Adapter) confirmPerformanceCycle(ctx context.Context, cycleCode string, body map[string]any) (map[string]any, error) {
	cycle, err := a.performanceCycleForAction(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	status := cleanAnyString(cycle["status"])
	if status == "cancelled" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_cancelled", "Cancelled performance cycle cannot be confirmed")
	}
	if status == "closed" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_closed", "Closed performance cycle cannot be confirmed again")
	}

	contributionCount, err := a.performanceCycleContributionCount(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	if contributionCount == 0 {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_empty", "Performance cycle has no contribution snapshots to confirm")
	}

	operator := cleanBodyString(body, "operator_uid", "operatorUid", "currentUser", "current_user")
	result, err := a.DB().ExecContext(ctx, `
		UPDATE people_performance_cycles
		SET status = 'confirmed',
		    confirmed_at = COALESCE(confirmed_at, NOW()),
		    updated_by = COALESCE(NULLIF(?, ''), updated_by),
		    updated_at = NOW()
		WHERE cycle_code = ?
		  AND status <> 'cancelled'
		  AND status <> 'closed'
	`, operator, cycleCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()

	if _, err := a.DB().ExecContext(ctx, `
		UPDATE people_contribution_snapshots
		SET confirmed_at = COALESCE(confirmed_at, NOW()),
		    updated_by = COALESCE(NULLIF(?, ''), updated_by),
		    updated_at = NOW()
		WHERE cycle_code = ?
	`, operator, cycleCode); err != nil {
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
		"changed":            affected > 0,
		"idempotent":         affected == 0 && status == "confirmed",
	}, nil
}

func (a *Adapter) closePerformanceCycle(ctx context.Context, cycleCode string, body map[string]any) (map[string]any, error) {
	cycle, err := a.performanceCycleForAction(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	status := cleanAnyString(cycle["status"])
	if status == "cancelled" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_cancelled", "Cancelled performance cycle cannot be closed")
	}
	if status != "confirmed" && status != "closed" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_not_confirmed", "Only confirmed performance cycle can be closed")
	}

	operator := cleanBodyString(body, "operator_uid", "operatorUid", "currentUser", "current_user")
	result, err := a.DB().ExecContext(ctx, `
		UPDATE people_performance_cycles
		SET status = 'closed',
		    closed_at = COALESCE(closed_at, NOW()),
		    updated_by = COALESCE(NULLIF(?, ''), updated_by),
		    updated_at = NOW()
		WHERE cycle_code = ?
		  AND status = 'confirmed'
	`, operator, cycleCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()

	updatedCycle, err := a.performanceCycleForAction(ctx, cycleCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"cycle":      updatedCycle,
		"cycle_code": cycleCode,
		"status":     cleanAnyString(updatedCycle["status"]),
		"changed":    affected > 0,
		"idempotent": affected == 0 && status == "closed",
	}, nil
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

func (a *Adapter) performanceCycleContributionCount(ctx context.Context, cycleCode string) (int64, error) {
	var count sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM people_contribution_snapshots
		WHERE cycle_code = ?
	`, cycleCode).Scan(&count); err != nil {
		return 0, err
	}
	return count.Int64, nil
}
