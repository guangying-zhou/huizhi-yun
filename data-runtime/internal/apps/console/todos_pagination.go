package console

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strings"
	"time"
)

func (a *Adapter) userNotificationTodosPage(ctx context.Context, uid string, q url.Values, page, size int) (map[string]any, error) {
	kind := q.Get("todoKind")
	if values, ok := q["todoKind"]; ok && (len(values) != 1 || (kind != "approval" && kind != "due" && kind != "risk" && kind != "follow_up")) {
		return nil, httperror.New(400, "notification_todo_kind_invalid", "Invalid todo kind")
	}
	todoCase := `CASE WHEN n.category='approval' THEN 'approval' WHEN n.category='project-risk' THEN 'risk' WHEN n.category IN ('service-sla','asset-expiry','asset-recovery','offboarding','finance_due','receivable') THEN 'due' ELSE 'follow_up' END`
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var now time.Time
	if err = tx.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP()").Scan(&now); err != nil {
		return nil, err
	}
	filters := []string{"p.uid=?", "p.state='pending'", "(n.expires_at IS NULL OR n.expires_at>?)"}
	args := []any{uid, now}
	if category := limitedNotificationFilter(q.Get("category")); category != "" {
		filters = append(filters, "n.category=?")
		args = append(args, category)
	}
	if source := limitedNotificationFilter(firstValue(q.Get("sourceAppCode"), q.Get("source_app_code"))); source != "" {
		filters = append(filters, "p.source_app_code=?")
		args = append(args, source)
	}
	from := " FROM portal_actionable_projections p INNER JOIN portal_notifications n ON n.notification_id=p.current_notification_id WHERE "
	where := strings.Join(filters, " AND ")
	// Kind counts cover the complete source/category range, independent of the
	// selected kind and page. Its selected bucket is exactly the page COUNT.
	counts := map[string]uint64{"approval": 0, "due": 0, "risk": 0, "follow_up": 0}
	countRows, err := tx.QueryContext(ctx, "SELECT "+todoCase+",COUNT(*)"+from+where+" GROUP BY "+todoCase, args...)
	if err != nil {
		return nil, err
	}
	for countRows.Next() {
		var k string
		var n uint64
		if err = countRows.Scan(&k, &n); err != nil {
			countRows.Close()
			return nil, err
		}
		counts[k] = n
	}
	err = countRows.Err()
	closeErr := countRows.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	var totalPending uint64
	for _, n := range counts {
		totalPending += n
	}
	total := totalPending
	if kind != "" {
		total = counts[kind]
		where += " AND (" + todoCase + ")=?"
		args = append(args, kind)
	}
	rows, err := tx.QueryContext(ctx, "SELECT p.current_notification_id,p.source_app_code,p.target_app_code,"+todoCase+",n.category,n.severity,p.created_at,p.updated_at"+from+where+" ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, size)
	for rows.Next() {
		var id, source, target, k, category, severity string
		var created, updated time.Time
		if err = rows.Scan(&id, &source, &target, &k, &category, &severity, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"notificationId": id, "sourceAppCode": source, "targetAppCode": target, "todoKind": k, "category": category, "severity": severity, "displayLabel": notificationDisplayLabel(category), "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "kindCounts": counts, "totalPending": totalPending}}, nil
}
