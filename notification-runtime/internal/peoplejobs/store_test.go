package peoplejobs

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenRecoversMultipleLegacyActiveJobsBeforeAddingSingleActiveIndex(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobs.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE connector_people_sync_jobs (
job_id TEXT PRIMARY KEY, provider TEXT NOT NULL, integration_code TEXT NOT NULL,
object_scopes_json TEXT NOT NULL, watermark TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
status TEXT NOT NULL, departments_count INTEGER NOT NULL DEFAULT 0, users_count INTEGER NOT NULL DEFAULT 0,
applied_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, batch_count INTEGER NOT NULL DEFAULT 0,
error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL
)`)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"legacy-a", "legacy-b"} {
		_, err = db.Exec(`INSERT INTO connector_people_sync_jobs
(job_id,provider,integration_code,object_scopes_json,watermark,idempotency_key,status,created_at,updated_at)
VALUES (?,'dingtalk','dingtalk.default','["people"]','2026-08-28T00:00:00Z',?,'running','2026-08-28T00:00:00Z','2026-08-28T00:00:00Z')`, id, "idempotency-"+id)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open legacy store with concurrent jobs: %v", err)
	}
	defer store.Close()
	var failed int
	if err = store.db.QueryRow(`SELECT COUNT(*) FROM connector_people_sync_jobs WHERE status='failed' AND error_code='runtime_restarted'`).Scan(&failed); err != nil || failed != 2 {
		t.Fatalf("recovered jobs=%d err=%v", failed, err)
	}
}

func TestOpenMigratesExistingPeopleJobStoreForRetryLineage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobs.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE connector_people_sync_jobs (
job_id TEXT PRIMARY KEY, provider TEXT NOT NULL, integration_code TEXT NOT NULL,
object_scopes_json TEXT NOT NULL, watermark TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
status TEXT NOT NULL, departments_count INTEGER NOT NULL DEFAULT 0, users_count INTEGER NOT NULL DEFAULT 0,
applied_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, batch_count INTEGER NOT NULL DEFAULT 0,
error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL
)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open legacy store: %v", err)
	}
	defer store.Close()
	job := Job{JobID: "crj_retry", RetryOfJobID: "crj_original", OriginalActorUID: "people-admin-1", Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, Watermark: "watermark"}
	created, wasCreated, err := store.Create(context.Background(), job, "legacy-store-retry-0001", "legacy-store-request-hash")
	if err != nil || !wasCreated || created.RetryOfJobID != "crj_original" || created.OriginalActorUID != "people-admin-1" {
		t.Fatalf("create after migration: job=%#v created=%v err=%v", created, wasCreated, err)
	}
}

func TestCancelIdempotencyKeyCannotReplayAcrossJobs(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	first := Job{JobID: "crj_cancel_a", Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, Watermark: "2026-08-28T00:00:00Z"}
	if _, _, err = store.Create(ctx, first, "start-cancel-job-a-0001", "start-hash-a"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = store.CancelAs(ctx, first.JobID, "admin-a", "cancel-job-a-action-0001", "cancel-hash-a"); err != nil {
		t.Fatal(err)
	}

	second := Job{JobID: "crj_cancel_b", Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, Watermark: "2026-08-28T00:01:00Z"}
	if _, _, err = store.Create(ctx, second, "start-cancel-job-b-0001", "start-hash-b"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = store.CancelAs(ctx, second.JobID, "admin-b", "cancel-job-b-action-0001", "cancel-hash-b"); err != nil {
		t.Fatal(err)
	}

	if _, _, err = store.CancelAs(ctx, second.JobID, "admin-a", "cancel-job-a-action-0001", "cancel-hash-a"); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("error=%v, want %v", err, ErrIdempotencyConflict)
	}
}

func TestCompleteRecordsPartialFieldsMissingWarningOnSuccess(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job, _, err := store.Create(context.Background(), Job{
		JobID: "job-partial", Provider: "dingtalk", IntegrationCode: "dingtalk.default",
		ObjectScopes: []string{"people"}, Watermark: "2026-09-02T00:00:00Z",
	}, "idempotency-partial", "hash-partial")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Start(context.Background(), job.JobID); err != nil {
		t.Fatal(err)
	}
	if err = store.Complete(context.Background(), job.JobID, Counts{
		Users: 120, Applied: 120,
		FieldCoverage: []FieldCoverage{
			{Field: "onboardDate", Absent: 120, Observed: 120},
			{Field: "mobile", Provided: 118, Empty: 1, Absent: 1, Observed: 120},
		},
		PartialFieldsMissing: []string{"onboardDate", "mobile"},
	}); err != nil {
		t.Fatal(err)
	}

	var status, code, message string
	if err = store.db.QueryRow(
		`SELECT status,COALESCE(error_code,''),COALESCE(error_message,'') FROM connector_people_sync_jobs WHERE job_id=?`,
		job.JobID,
	).Scan(&status, &code, &message); err != nil {
		t.Fatal(err)
	}
	if status != "success" {
		t.Fatalf("status=%q", status)
	}
	if code != "partial_fields_missing" {
		t.Fatalf("error_code=%q", code)
	}
	if !strings.Contains(message, "onboardDate, mobile") || !strings.Contains(message, "permission") {
		t.Fatalf("error_message=%q", message)
	}
	persisted, ok, err := store.Get(context.Background(), job.JobID)
	if err != nil || !ok {
		t.Fatalf("get completed job: ok=%v err=%v", ok, err)
	}
	if len(persisted.Counts.FieldCoverage) != 2 || persisted.Counts.FieldCoverage[1].Empty != 1 || persisted.Counts.FieldCoverage[1].Absent != 1 {
		t.Fatalf("field coverage was not persisted: %#v", persisted.Counts.FieldCoverage)
	}
	if len(persisted.Counts.PartialFieldsMissing) != 2 {
		t.Fatalf("partial fields were not persisted: %#v", persisted.Counts.PartialFieldsMissing)
	}
}

func TestCompleteLeavesNoWarningWhenEveryFieldWasProvided(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job, _, err := store.Create(context.Background(), Job{
		JobID: "job-clean", Provider: "dingtalk", IntegrationCode: "dingtalk.default",
		ObjectScopes: []string{"people"}, Watermark: "2026-09-02T00:00:00Z",
	}, "idempotency-clean", "hash-clean")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Start(context.Background(), job.JobID); err != nil {
		t.Fatal(err)
	}
	if err = store.Complete(context.Background(), job.JobID, Counts{Users: 120, Applied: 120}); err != nil {
		t.Fatal(err)
	}

	var code sql.NullString
	if err = store.db.QueryRow(
		`SELECT error_code FROM connector_people_sync_jobs WHERE job_id=?`, job.JobID,
	).Scan(&code); err != nil {
		t.Fatal(err)
	}
	if code.Valid {
		t.Fatalf("error_code=%q, want NULL", code.String)
	}
}
