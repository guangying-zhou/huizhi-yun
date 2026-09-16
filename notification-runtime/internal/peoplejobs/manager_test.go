package peoplejobs

import (
	"context"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type fakeRunner struct{}

func (fakeRunner) RunPeopleSync(_ context.Context, _ StartRequest, emit func(Batch) error) (Counts, error) {
	if err := emit(Batch{BatchNumber: 1, Users: []User{{ProviderSubject: "u1", Active: true}}}); err != nil {
		return Counts{}, err
	}
	if err := emit(Batch{BatchNumber: 2, Final: true}); err != nil {
		return Counts{}, err
	}
	return Counts{Users: 1, Batches: 2}, nil
}

type fakeSink struct{}

func (fakeSink) Apply(_ context.Context, b Batch) (Counts, error) {
	if b.Final {
		return Counts{}, nil
	}
	return Counts{Applied: len(b.Users)}, nil
}

type blockingRunner struct{ started chan struct{} }

func (runner blockingRunner) RunPeopleSync(ctx context.Context, _ StartRequest, _ func(Batch) error) (Counts, error) {
	close(runner.started)
	<-ctx.Done()
	return Counts{}, ctx.Err()
}

type flakyRunner struct{ calls atomic.Int32 }

func (runner *flakyRunner) RunPeopleSync(_ context.Context, _ StartRequest, emit func(Batch) error) (Counts, error) {
	if runner.calls.Add(1) == 1 {
		return Counts{}, errors.New("provider unavailable")
	}
	if err := emit(Batch{BatchNumber: 1, Final: true}); err != nil {
		return Counts{}, err
	}
	return Counts{Batches: 1}, nil
}

func waitForStatus(t *testing.T, manager *Manager, id, status string) Job {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		job, ok, err := manager.Get(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if ok && job.Status == status {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach %s", id, status)
	return Job{}
}

func TestManagerRunsPersistedIdempotentPeopleJob(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := NewManager(store, fakeRunner{}, fakeSink{})
	request := StartRequest{Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, IdempotencyKey: "test-idempotency-0001", OriginalActorUID: "people-admin-1"}
	job, created, err := manager.Start(ctx, request)
	if err != nil || !created {
		t.Fatalf("start: created=%v err=%v", created, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		current, ok, getErr := manager.Get(ctx, job.JobID)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if ok && current.Status == "success" {
			if current.OriginalActorUID != "people-admin-1" {
				t.Fatalf("original actor was not persisted: %#v", current)
			}
			if current.Counts.Users != 1 || current.Counts.Applied != 1 || current.Counts.Batches != 2 {
				t.Fatalf("unexpected counts: %#v", current.Counts)
			}
			again, againCreated, againErr := manager.Start(ctx, request)
			if againErr != nil || againCreated || again.JobID != job.JobID {
				t.Fatalf("idempotent replay: %#v created=%v err=%v", again, againCreated, againErr)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("job did not complete")
}

func TestManagerRejectsIdempotencyKeyReuseWithDifferentRequest(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := NewManager(store, fakeRunner{}, fakeSink{})
	request := StartRequest{Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, IdempotencyKey: "test-conflict-key-0001", OriginalActorUID: "admin-a"}
	job, _, err := manager.Start(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, manager, job.JobID, "success")

	for name, mutate := range map[string]func(*StartRequest){
		"scopes":    func(value *StartRequest) { value.ObjectScopes = []string{"organization", "people"} },
		"actor":     func(value *StartRequest) { value.OriginalActorUID = "admin-b" },
		"watermark": func(value *StartRequest) { value.Watermark = "2026-08-28T00:00:00Z" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := request
			mutate(&changed)
			if _, _, conflictErr := manager.Start(ctx, changed); !errors.Is(conflictErr, ErrIdempotencyConflict) {
				t.Fatalf("error=%v, want %v", conflictErr, ErrIdempotencyConflict)
			}
		})
	}
}

func TestManagerRejectsOlderWatermarkAfterNewerJobCompletes(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := NewManager(store, fakeRunner{}, fakeSink{})
	newer, _, err := manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"},
		Watermark: "2026-08-28T02:00:00Z", IdempotencyKey: "test-newer-watermark-0001",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, manager, newer.JobID, "success")
	if _, _, err = manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"},
		Watermark: "2026-08-28T01:00:00Z", IdempotencyKey: "test-older-watermark-0001",
	}); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("error=%v, want %v", err, ErrStaleRevision)
	}
}

func TestManagerCancelsRunningJobIdempotently(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	started := make(chan struct{})
	manager := NewManager(store, blockingRunner{started: started}, fakeSink{})
	job, created, err := manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, IdempotencyKey: "test-cancel-job-0001",
	})
	if err != nil || !created {
		t.Fatalf("start: created=%v err=%v", created, err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not start")
	}
	cancelled, err := manager.Cancel(ctx, job.JobID)
	if err != nil || cancelled.Status != "cancelled" || cancelled.FinishedAt == "" {
		t.Fatalf("cancel: job=%#v err=%v", cancelled, err)
	}
	again, err := manager.Cancel(ctx, job.JobID)
	if err != nil || again.Status != "cancelled" {
		t.Fatalf("idempotent cancel: job=%#v err=%v", again, err)
	}
	waitForStatus(t, manager, job.JobID, "cancelled")
	if _, _, err := manager.Retry(ctx, job.JobID); !errors.Is(err, ErrJobNotRetryable) {
		t.Fatalf("retry cancelled job error=%v, want %v", err, ErrJobNotRetryable)
	}
}

func TestManagerAllowsOnlyOneActiveProviderJob(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	started := make(chan struct{})
	manager := NewManager(store, blockingRunner{started: started}, fakeSink{})
	first, _, err := manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"},
		Watermark: "2026-08-28T01:00:00Z", IdempotencyKey: "test-single-active-first-0001",
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	if _, _, err = manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"},
		Watermark: "2026-08-28T02:00:00Z", IdempotencyKey: "test-single-active-second-0001",
	}); !errors.Is(err, ErrJobAlreadyRunning) {
		t.Fatalf("error=%v, want %v", err, ErrJobAlreadyRunning)
	}
	if _, err = manager.Cancel(ctx, first.JobID); err != nil {
		t.Fatal(err)
	}
}

func TestManagerCancelPersistsActorAndRejectsConflictingReplay(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	started := make(chan struct{})
	manager := NewManager(store, blockingRunner{started: started}, fakeSink{})
	job, _, err := manager.Start(ctx, StartRequest{Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"}, IdempotencyKey: "test-cancel-audit-start-0001", OriginalActorUID: "admin-start"})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	cancelled, err := manager.CancelAs(ctx, job.JobID, "admin-cancel", "test-cancel-audit-action-0001")
	if err != nil || cancelled.CancelledByUID != "admin-cancel" {
		t.Fatalf("cancelled=%#v err=%v", cancelled, err)
	}
	replayed, err := manager.CancelAs(ctx, job.JobID, "admin-cancel", "test-cancel-audit-action-0001")
	if err != nil || replayed.JobID != job.JobID || replayed.CancelledByUID != "admin-cancel" {
		t.Fatalf("replayed=%#v err=%v", replayed, err)
	}
	if _, err = manager.CancelAs(ctx, job.JobID, "another-admin", "test-cancel-audit-action-0001"); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("error=%v, want %v", err, ErrIdempotencyConflict)
	}
}

func TestManagerRetriesFailedJobWithStableLineageAndIdempotency(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	runner := &flakyRunner{}
	manager := NewManager(store, runner, fakeSink{})
	original, created, err := manager.Start(ctx, StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"organization", "people"}, Watermark: "2026-07-14T00:00:00Z", IdempotencyKey: "test-retry-job-0001",
	})
	if err != nil || !created {
		t.Fatalf("start: created=%v err=%v", created, err)
	}
	waitForStatus(t, manager, original.JobID, "failed")

	retry, retryCreated, err := manager.RetryAs(ctx, original.JobID, "people-admin-retry", "test-retry-job-action-0001")
	if err != nil || !retryCreated || retry.RetryOfJobID != original.JobID || retry.Watermark != original.Watermark || retry.OriginalActorUID != "people-admin-retry" {
		t.Fatalf("retry: job=%#v created=%v err=%v", retry, retryCreated, err)
	}
	replayed, replayCreated, err := manager.RetryAs(ctx, original.JobID, "people-admin-retry", "test-retry-job-action-0001")
	if err != nil || replayCreated || replayed.JobID != retry.JobID {
		t.Fatalf("retry replay: job=%#v created=%v err=%v", replayed, replayCreated, err)
	}
	completed := waitForStatus(t, manager, retry.JobID, "success")
	if completed.RetryOfJobID != original.JobID || completed.Counts.Batches != 1 || completed.OriginalActorUID != "people-admin-retry" {
		t.Fatalf("completed retry lost lineage/counts: %#v", completed)
	}
	if _, _, err := manager.Retry(ctx, retry.JobID); !errors.Is(err, ErrJobNotRetryable) {
		t.Fatalf("retry success error=%v, want %v", err, ErrJobNotRetryable)
	}
}

func TestManagerAllowsDirectoryProfileCallbackAfterPeopleSync(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := NewManager(store, fakeRunner{}, fakeSink{})
	first, _, err := manager.Start(context.Background(), StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"directory_profiles"}, IdempotencyKey: "directory-profile-test-0001",
	})
	if err != nil {
		t.Fatalf("directory profile scope was rejected: %v", err)
	}
	waitForStatus(t, manager, first.JobID, "success")
	if _, _, err = manager.Start(context.Background(), StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people", "directory_profiles"}, IdempotencyKey: "directory-profile-test-0002",
	}); err != nil {
		t.Fatalf("combined People and directory profile scopes were rejected: %v", err)
	}
}
