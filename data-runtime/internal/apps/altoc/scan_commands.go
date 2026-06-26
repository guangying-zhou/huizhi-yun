package altoc

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) scanStaleOpportunities(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "opportunity", "edit"); err != nil {
		return nil, err
	}
	staleDays := numberValue(firstNonEmptyBodyValue(body, "staleDays", "stale_days"), 7)
	if staleDays <= 0 {
		staleDays = 7
	}
	if staleDays > 365 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_stale_days", "staleDays must be between 1 and 365")
	}

	where := []string{
		"op.deleted_at IS NULL",
		"op.status = 'active'",
		`(
			(op.next_action_due_at IS NOT NULL AND op.next_action_due_at < NOW())
			OR
			(op.next_action_due_at IS NULL AND DATEDIFF(CURDATE(), op.updated_at) > ?)
		)`,
	}
	args := []any{staleDays}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(body, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  op.id,
		  op.code,
		  op.name,
		  op.owner_user_id,
		  op.next_action,
		  op.next_action_due_at,
		  op.updated_at,
		  DATEDIFF(CURDATE(), COALESCE(op.next_action_due_at, op.updated_at, op.created_at)) AS days_stale
		FROM opportunity op
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY COALESCE(op.next_action_due_at, op.updated_at, op.created_at) ASC, op.id ASC
		LIMIT 500
	`, args...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"scanned":         len(items),
		"stale_ids":       idsFromRows(items),
		"items":           items,
		"notified_owners": distinctTextCount(items, "owner_user_id"),
	}, nil
}

func (a *Adapter) scanOverdueReceivablePlans(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "receivable", "edit"); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(nil, body, "rp", "ct")
	if err != nil {
		return nil, err
	}
	newWhere := overdueReceivableWhere()
	newWhere = append(newWhere, scopeWhere...)
	newArgs := append([]any{}, scopeArgs...)

	newlyOverdue, err := altocQueryMaps(ctx, tx, `
		SELECT
		  rp.id,
		  rp.code,
		  rp.plan_name,
		  rp.amount,
		  rp.received_amount,
		  rp.unreceived_amount,
		  DATEDIFF(CURDATE(), rp.planned_payment_date) AS overdue_days,
		  rp.planned_payment_date,
		  rp.owner_user_id,
		  ct.code AS contract_code,
		  ct.name AS contract_name,
		  ct.owner_user_id AS contract_owner_user_id
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(newWhere, " AND ")+`
		ORDER BY rp.planned_payment_date ASC, rp.id ASC
		LIMIT 500
	`, newArgs...)
	if err != nil {
		return nil, err
	}

	updateWhere := overdueReceivableWhere()
	updateWhere = append(updateWhere, scopeWhere...)
	updateArgs := append([]any{nullableText(operator)}, scopeArgs...)
	markResult, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		SET rp.status = 'overdue',
		    rp.overdue_days = DATEDIFF(CURDATE(), rp.planned_payment_date),
		    rp.unreceived_amount = GREATEST(COALESCE(rp.amount, 0) - COALESCE(rp.received_amount, 0), 0),
		    rp.updated_by = ?
		WHERE `+strings.Join(updateWhere, " AND "), updateArgs...)
	if err != nil {
		return nil, err
	}

	refreshWhere := []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date IS NOT NULL",
		"rp.status = 'overdue'",
	}
	refreshWhere = append(refreshWhere, scopeWhere...)
	refreshArgs := append([]any{nullableText(operator)}, scopeArgs...)
	refreshResult, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		SET rp.overdue_days = DATEDIFF(CURDATE(), rp.planned_payment_date),
		    rp.unreceived_amount = GREATEST(COALESCE(rp.amount, 0) - COALESCE(rp.received_amount, 0), 0),
		    rp.updated_by = ?
		WHERE `+strings.Join(refreshWhere, " AND "), refreshArgs...)
	if err != nil {
		return nil, err
	}

	marked, _ := markResult.RowsAffected()
	refreshed, _ := refreshResult.RowsAffected()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"scanned":         marked + refreshed,
		"marked_overdue":  marked,
		"updated_days":    refreshed,
		"newly_overdue":   newlyOverdue,
		"overdue_ids":     idsFromRows(newlyOverdue),
		"notified_owners": distinctOwnerCountForReceivable(newlyOverdue),
	}, nil
}

func overdueReceivableWhere() []string {
	return []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date IS NOT NULL",
		"rp.planned_payment_date < CURDATE()",
		"rp.status IN ('pending', 'to_invoice', 'to_receive', 'partially_received')",
		"(rp.received_amount IS NULL OR rp.received_amount < rp.amount)",
	}
}

func idsFromRows(rows []map[string]any) []int64 {
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		id := altocPositiveID(row["id"])
		if id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func distinctTextCount(rows []map[string]any, key string) int {
	seen := map[string]bool{}
	for _, row := range rows {
		value := strings.TrimSpace(fmt.Sprint(row[key]))
		if value == "" || value == "<nil>" {
			continue
		}
		seen[value] = true
	}
	return len(seen)
}

func distinctOwnerCountForReceivable(rows []map[string]any) int {
	seen := map[string]bool{}
	for _, row := range rows {
		value := firstNonEmptyText(altocMapText(row, "owner_user_id"), altocMapText(row, "contract_owner_user_id"))
		if value == "" {
			continue
		}
		seen[value] = true
	}
	return len(seen)
}
