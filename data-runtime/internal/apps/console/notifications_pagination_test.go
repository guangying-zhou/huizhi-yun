package console

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"net/url"
	"testing"
	"time"
)

func TestNotificationPageBoundsAndLegacyOmission(t *testing.T) {
	if _, _, paged, e := notificationReadPagination(url.Values{}); e != nil || paged {
		t.Fatal(paged, e)
	}
	p, s, paged, e := notificationReadPagination(url.Values{"pageSize": {"100"}})
	if e != nil || !paged || p != 1 || s != 100 {
		t.Fatal(p, s, paged, e)
	}
	for _, q := range []url.Values{{"page": {"0"}}, {"page": {"01"}}, {"page": {""}}, {"page": {"1.5"}}, {"page": {"1", "2"}}, {"pageSize": {"101"}}, {"page": {"1"}, "cursor": {""}}, {"page": {"1"}, "limit": {"20"}}} {
		if _, _, _, e := notificationReadPagination(q); e == nil {
			t.Fatal("accepted", q)
		}
	}
}
func TestNotificationPageCountsCurrentRecipientFilterAndFrozenExpirySnapshot(t *testing.T) {
	db, mock, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := NewWithDB(config.ConsoleConfig{}, "C000001", db)
	now := time.Date(2026, 9, 27, 1, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT UTC_TIMESTAMP\(\)`).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	where := `(?s)r.uid=\? AND \(n.expires_at IS NULL OR n.expires_at>\?\) AND r.read_at IS NULL AND r.archived_at IS NULL AND n.category=\? AND n.source_app_code=\?`
	mock.ExpectQuery(`SELECT COUNT\(\*\).*`+where).WithArgs("viewer", now, "approval", "aims").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(21))
	mock.ExpectQuery(`SELECT r.id,n.notification_id,n.source_app_code.*`+where+`.*ORDER BY COALESCE\(r.pinned_at,n.created_at\) DESC,r.id DESC LIMIT \? OFFSET \?`).WithArgs("viewer", now, "approval", "aims", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id", "notification_id", "source_app_code", "category", "severity", "created_at", "expires_at", "read_at", "archived_at", "pinned_at"}).AddRow(1, "N1", "aims", "approval", "info", now, nil, nil, nil, nil))
	mock.ExpectCommit()
	out, e := a.UserNotifications(context.Background(), "viewer", url.Values{"page": {"2"}, "pageSize": {"20"}, "status": {"unread"}, "category": {"approval"}, "sourceAppCode": {"aims"}})
	if e != nil {
		t.Fatal(e)
	}
	page := out["data"].(map[string]any)
	if page["total"] != uint64(21) || len(page["items"].([]map[string]any)) != 1 {
		t.Fatal(page)
	}
	if _, ok := page["nextCursor"]; ok {
		t.Fatal("page mode inherited cursor")
	}
	if e := mock.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
