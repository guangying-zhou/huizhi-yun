package console

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"net/url"
	"testing"
	"time"
)

func TestTodoPageFullKindCountsCurrentProjectionAndFrozenExpiry(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := NewWithDB(config.ConsoleConfig{}, "C000001", db)
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	m.ExpectBegin()
	m.ExpectQuery(`SELECT UTC_TIMESTAMP\(\)`).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	where := `(?s)p.uid=\? AND p.state='pending' AND \(n.expires_at IS NULL OR n.expires_at>\?\) AND n.category=\? AND p.source_app_code=\?`
	m.ExpectQuery(`SELECT CASE.*COUNT\(\*\).*`+where+`.*GROUP BY CASE`).WithArgs("viewer", now, "approval", "aims").WillReturnRows(sqlmock.NewRows([]string{"kind", "n"}).AddRow("approval", 21))
	m.ExpectQuery(`SELECT p.current_notification_id.*`+where+`.*END\)=\?.*ORDER BY p.updated_at DESC,p.id DESC LIMIT \? OFFSET \?`).WithArgs("viewer", now, "approval", "aims", "approval", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id", "source", "target", "kind", "category", "severity", "created", "updated"}).AddRow("N1", "aims", "enterprise", "approval", "approval", "info", now, now))
	m.ExpectCommit()
	result, err := a.UserNotificationTodos(context.Background(), "viewer", url.Values{"page": {"2"}, "pageSize": {"20"}, "todoKind": {"approval"}, "category": {"approval"}, "sourceAppCode": {"aims"}})
	if err != nil {
		t.Fatal(err)
	}
	d := result["data"].(map[string]any)
	if d["total"] != uint64(21) || d["totalPending"] != uint64(21) || d["kindCounts"].(map[string]uint64)["approval"] != 21 || len(d["items"].([]map[string]any)) != 1 {
		t.Fatal(d)
	}
	if _, ok := d["nextCursor"]; ok {
		t.Fatal(d)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
