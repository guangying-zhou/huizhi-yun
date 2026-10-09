package documentcatalog

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

type recordedRun struct {
	kind   string
	filter Filter
}

// blockingRunner records every run and holds each one until released, so a
// test controls exactly what is pending while the worker is busy.
type blockingRunner struct {
	mu      sync.Mutex
	runs    []recordedRun
	started chan struct{}
	release chan struct{}
}

func newBlockingRunner() *blockingRunner {
	return &blockingRunner{started: make(chan struct{}, 100), release: make(chan struct{}, 100)}
}

func (r *blockingRunner) run(kind string, filter Filter) {
	r.mu.Lock()
	r.runs = append(r.runs, recordedRun{kind, filter})
	r.mu.Unlock()
	r.started <- struct{}{}
	<-r.release
}

func (r *blockingRunner) waitStarted(t *testing.T) {
	t.Helper()
	select {
	case <-r.started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start a run")
	}
}

func (r *blockingRunner) idle(t *testing.T) {
	t.Helper()
	select {
	case <-r.started:
		t.Fatal("unexpected extra run")
	case <-time.After(150 * time.Millisecond):
	}
}

func (r *blockingRunner) recorded() []recordedRun {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]recordedRun(nil), r.runs...)
}

func TestSyncerMergesPendingTriggersAndRunsSerially(t *testing.T) {
	runner := newBlockingRunner()
	syncer := NewSyncer(100, runner.run)
	syncer.Trigger("weekly", Filter{ObjectIDs: []string{"1"}})
	runner.waitStarted(t) // the worker is now busy with the first request

	// Everything triggered while it is busy merges into one pending request
	// per kind; nothing runs concurrently.
	for i := 0; i < 20; i++ {
		syncer.Trigger("weekly", Filter{ObjectIDs: []string{"3", "2"}})
		syncer.Trigger("repo", Filter{OwnerType: "project", OwnerCode: "P1"})
	}
	syncer.Trigger("spec", Filter{ObjectIDs: []string{"9"}})
	syncer.Trigger("spec", Filter{}) // the whole kind absorbs targeted requests
	syncer.Trigger("spec", Filter{ObjectIDs: []string{"10"}})
	runner.idle(t)

	for i := 0; i < 4; i++ {
		runner.release <- struct{}{}
		if i < 3 {
			runner.waitStarted(t)
		}
	}
	runner.idle(t)
	want := []recordedRun{
		{"weekly", Filter{ObjectIDs: []string{"1"}}},
		{"weekly", Filter{ObjectIDs: []string{"2", "3"}}},
		{"repo", Filter{OwnerType: "project", OwnerCode: "P1"}},
		{"spec", Filter{}},
	}
	if got := runner.recorded(); !reflect.DeepEqual(got, want) {
		t.Fatalf("runs=%+v", got)
	}
	if syncer.Dropped() != 0 {
		t.Fatalf("dropped=%d", syncer.Dropped())
	}
}

func TestSyncerDropsWhenFullAndNeverBlocksTheCaller(t *testing.T) {
	runner := newBlockingRunner()
	syncer := NewSyncer(2, runner.run)
	syncer.Trigger("weekly", Filter{ObjectIDs: []string{"1"}})
	runner.waitStarted(t)

	// The worker is stuck. A burst far beyond the bound must return at once.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 1000; i++ {
			syncer.Trigger("weekly", Filter{ObjectIDs: []string{"2", "3", "4", "5", "6"}})
		}
		syncer.Trigger("repo", Filter{OwnerType: "project", OwnerCode: "P1"})
		syncer.Trigger("repo", Filter{OwnerType: "project", OwnerCode: "P2"})
		syncer.Trigger("repo", Filter{OwnerType: "project", OwnerCode: "P3"})
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Trigger blocked while the worker was busy")
	}
	// Per kind: 2 kept. Weekly: first call drops 3, the other 999 drop 3 each
	// (two ids are already pending). Repo: third owner dropped.
	if got, want := syncer.Dropped(), int64(3*1000+1); got != want {
		t.Fatalf("dropped=%d want=%d", got, want)
	}
	for i := 0; i < 4; i++ {
		runner.release <- struct{}{}
		if i < 3 {
			runner.waitStarted(t)
		}
	}
	runner.idle(t)
	want := []recordedRun{
		{"weekly", Filter{ObjectIDs: []string{"1"}}},
		{"weekly", Filter{ObjectIDs: []string{"2", "3"}}},
		{"repo", Filter{OwnerType: "project", OwnerCode: "P1"}},
		{"repo", Filter{OwnerType: "project", OwnerCode: "P2"}},
	}
	if got := runner.recorded(); !reflect.DeepEqual(got, want) {
		t.Fatalf("runs=%+v", got)
	}
}

func TestSyncerNilAndUnconfiguredAreNoOps(t *testing.T) {
	var syncer *Syncer
	syncer.Trigger("weekly", Filter{})
	NewSyncer(0, nil).Trigger("weekly", Filter{})
}
