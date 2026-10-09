package directory

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"testing"
	"time"
)

func TestConsoleSyncOptionalPaginationBounds(t *testing.T) {
	p, s, paged, err := consoleSyncPagination(url.Values{})
	if err != nil || paged || p != 0 || s != 0 {
		t.Fatal(p, s, paged, err)
	}
	p, s, paged, err = consoleSyncPagination(url.Values{"page": {"2"}})
	if err != nil || !paged || p != 2 || s != 20 {
		t.Fatal(p, s, paged, err)
	}
	for _, q := range []url.Values{{"page": {""}}, {"page": {"01"}}, {"page": {"-1"}}, {"page": {"1.5"}}, {"page": {"1000001"}}, {"pageSize": {"101"}}, {"page": {"1", "2"}}, {"page": {"1"}, "limit": {"20"}}} {
		if _, _, _, err := consoleSyncPagination(q); err == nil {
			t.Fatalf("accepted %v", q)
		}
	}
}
func syncJobColumns() []string {
	return []string{"job_code", "provider_code", "sync_type", "object_scope", "cursor_before", "cursor_after", "status", "started_at", "finished_at", "requested_by", "total_count", "created_count", "updated_count", "deleted_count", "skipped_count", "error_count", "error_message", "created_at", "updated_at"}
}
func syncJobRows() *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows(syncJobColumns()).AddRow("J1", "manual", "full", "users", nil, nil, "success", nil, nil, nil, 999, 2, 3, 0, 0, 0, nil, now, now)
}
func TestConsoleSyncJobsPageSnapshotAndLegacyArray(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_sync_jobs`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(21))
	mock.ExpectQuery(`(?s)FROM directory_sync_jobs ORDER BY created_at DESC,job_code DESC LIMIT \? OFFSET \?`).WithArgs(20, 20).WillReturnRows(syncJobRows())
	mock.ExpectCommit()
	result, err := a.ConsoleDirectorySyncJobs(context.Background(), url.Values{"page": {"2"}, "pageSize": {"20"}})
	if err != nil {
		t.Fatal(err)
	}
	page := result.(map[string]any)
	if page["total"] != int64(21) || page["items"].([]map[string]any)[0]["totalCount"] != int64(999) {
		t.Fatal(page)
	}
	mock.ExpectQuery(`(?s)FROM directory_sync_jobs ORDER BY created_at DESC LIMIT \?`).WithArgs(20).WillReturnRows(syncJobRows())
	result, err = a.ConsoleDirectorySyncJobs(context.Background(), url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := result.([]map[string]any); !ok {
		t.Fatalf("legacy shape changed: %T", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestConsoleSyncEventsCountBoundToJobAndBeyondPage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`(?s)FROM directory_sync_jobs WHERE job_code=\? LIMIT 1`).WithArgs("J1").WillReturnRows(syncJobRows())
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_sync_events WHERE job_code=\?`).WithArgs("J1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery(`(?s)FROM directory_sync_events WHERE job_code=\?.*ORDER BY created_at DESC,id DESC LIMIT \? OFFSET \?`).WithArgs("J1", 20, 160).WillReturnRows(sqlmock.NewRows([]string{"id", "job_code", "object_type", "object_code", "change_type", "source_provider", "external_ref", "status", "message", "before_hash", "after_hash", "created_at"}))
	mock.ExpectCommit()
	result, err := a.ConsoleDirectorySyncEvents(context.Background(), "J1", url.Values{"page": {"9"}, "pageSize": {"20"}})
	if err != nil {
		t.Fatal(err)
	}
	page := result.(map[string]any)
	if page["total"] != int64(3) || len(page["items"].([]map[string]any)) != 0 {
		t.Fatal(page)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
