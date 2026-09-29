package console

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func notificationReadPagination(q url.Values) (int, int, bool, error) {
	_, p := q["page"]
	_, s := q["pageSize"]
	if !p && !s {
		return 0, 0, false, nil
	}
	invalid := httperror.New(400, "notification_pagination_invalid", "Invalid pagination")
	if _, ok := q["cursor"]; ok {
		return 0, 0, true, invalid
	}
	if _, ok := q["limit"]; ok {
		return 0, 0, true, invalid
	}
	for _, key := range []string{"status", "category", "sourceAppCode", "source_app_code"} {
		if values, ok := q[key]; ok && (len(values) != 1 || len(values[0]) > 64 || strings.ContainsAny(values[0], "\x00\r\n")) {
			return 0, 0, true, invalid
		}
	}
	page, size := 1, 20
	for key, dest := range map[string]*int{"page": &page, "pageSize": &size} {
		if values, ok := q[key]; ok {
			if len(values) != 1 {
				return 0, 0, true, invalid
			}
			n, e := strconv.Atoi(values[0])
			if e != nil || n < 1 || strconv.Itoa(n) != values[0] || (key == "page" && n > 1000000) || (key == "pageSize" && n > 100) {
				return 0, 0, true, invalid
			}
			*dest = n
		}
	}
	return page, size, true, nil
}
func (a *Adapter) userNotificationsPage(ctx context.Context, filters []string, args []any, page, size int) (map[string]any, error) {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Freeze expiry time as well as rows: COUNT and items must not straddle expiry.
	var now time.Time
	if err = tx.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP()").Scan(&now); err != nil {
		return nil, err
	}
	filters = append([]string(nil), filters...)
	filters[1] = "(n.expires_at IS NULL OR n.expires_at>?)"
	args = append([]any{args[0], now}, args[1:]...)
	where := " WHERE " + strings.Join(filters, " AND ")
	var total uint64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM portal_notification_recipients r INNER JOIN portal_notifications n ON n.notification_id=r.notification_id"+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, notificationSelectSQL()+where+" ORDER BY COALESCE(r.pinned_at,n.created_at) DESC,r.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, size)
	for rows.Next() {
		row, e := scanNotificationRow(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, mapNotification(row))
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
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{"items": items, "total": total, "page": page, "pageSize": size}}, nil
}
