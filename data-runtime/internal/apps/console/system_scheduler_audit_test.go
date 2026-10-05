package console

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func schedulerAuditFixture() SystemSchedulerAuditRecord {
	start := time.Date(2026, 10, 1, 10, 0, 0, 0, time.FixedZone("test", -3*3600))
	return SystemSchedulerAuditRecord{Task: enterprise.SystemMilestoneRolloverTask, Principal: enterprise.SystemSchedulerPrincipal, Result: "ok", Generation: 7,
		Counts: SystemSchedulerAuditCounts{Scanned: 3, RolledOver: 2, Pending: 1}, StartedAt: start, EndedAt: start.Add(time.Second), DurationMs: 1000}
}

type schedulerAuditJSON struct{ expected SystemSchedulerAuditRecord }

func (a schedulerAuditJSON) Match(value driver.Value) bool {
	raw, ok := value.([]byte)
	if !ok {
		return false
	}
	var actual SystemSchedulerAuditRecord
	if json.Unmarshal(raw, &actual) != nil {
		return false
	}
	return actual == a.expected
}

func TestSystemSchedulerAuditAppendsIndependentSanitizedSummary(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := NewWithDB(config.ConsoleConfig{}, "tenant", db)
	for _, result := range []string{"ok", "item_failures", "unavailable", "cancelled", "generation_stale"} {
		r := schedulerAuditFixture()
		r.Result = result
		if result == "unavailable" {
			r.ErrorClass = "db"
		}
		expected := r
		expected.StartedAt, expected.EndedAt = r.StartedAt.UTC(), r.EndedAt.UTC()
		// No Begin/Commit or receipt writes: exactly one append on its own DB.
		mock.ExpectExec(`(?s)INSERT INTO operation_logs.*NULL,'system',\?,NULL,\?,UTC_TIMESTAMP`).WithArgs(enterprise.SystemSchedulerPrincipal, schedulerAuditJSON{expected}).WillReturnResult(sqlmock.NewResult(1, 1))
		if err := a.AppendSystemSchedulerAudit(context.Background(), r); err != nil {
			t.Fatal(err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemSchedulerAuditRejectsUntrustedSummaryBeforeSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := NewWithDB(config.ConsoleConfig{}, "tenant", db)
	for _, mutate := range []func(*SystemSchedulerAuditRecord){
		func(r *SystemSchedulerAuditRecord) { r.Principal = "human-uid" },
		func(r *SystemSchedulerAuditRecord) { r.Task = "other-task" },
		func(r *SystemSchedulerAuditRecord) { r.Result = "raw-sql-id" },
		func(r *SystemSchedulerAuditRecord) { r.ErrorClass = "raw-sql-id" },
		func(r *SystemSchedulerAuditRecord) { r.Result = "unavailable"; r.ErrorClass = "raw-sql-id" },
		func(r *SystemSchedulerAuditRecord) { r.Generation = 0 },
		func(r *SystemSchedulerAuditRecord) { r.StartedAt = time.Time{} },
		func(r *SystemSchedulerAuditRecord) { r.EndedAt = r.StartedAt.Add(-time.Second) },
		func(r *SystemSchedulerAuditRecord) { r.Counts.Scanned = -1 },
	} {
		r := schedulerAuditFixture()
		mutate(&r)
		if err := a.AppendSystemSchedulerAudit(context.Background(), r); !errors.Is(err, enterprise.ErrInvalidBinding) {
			t.Fatal(err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
