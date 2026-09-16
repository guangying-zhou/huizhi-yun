package peoplejobs

import (
	"context"
	"errors"
	"testing"
)

type recordingSink struct {
	name  string
	calls *[]string
	value Counts
	err   error
}

func (s recordingSink) Apply(context.Context, Batch) (Counts, error) {
	*s.calls = append(*s.calls, s.name)
	return s.value, s.err
}

type recordingFailureSink struct {
	recordingSink
	failures int
}

func (s *recordingFailureSink) Fail(context.Context, Batch, string, string) error {
	s.failures++
	return nil
}

func TestScopedSinkAppliesPeopleBeforeDirectoryCallback(t *testing.T) {
	calls := []string{}
	people := recordingSink{name: "people", calls: &calls, value: Counts{Applied: 2, Skipped: 1}}
	directory := &recordingFailureSink{recordingSink: recordingSink{name: "directory", calls: &calls, value: Counts{Applied: 1}}}
	sink := NewScopedSink(people, directory)

	result, err := sink.Apply(context.Background(), Batch{ObjectScopes: []string{"organization", "people", "directory_profiles"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || calls[0] != "people" || calls[1] != "directory" {
		t.Fatalf("sink order = %v, want People then Directory", calls)
	}
	if result.Applied != 2 || result.Skipped != 1 {
		t.Fatalf("result = %#v, want People counts", result)
	}
}

func TestScopedSinkDoesNotCallDirectoryWhenPeopleApplyFails(t *testing.T) {
	calls := []string{}
	sink := NewScopedSink(
		recordingSink{name: "people", calls: &calls, err: errors.New("people failed")},
		recordingSink{name: "directory", calls: &calls},
	)
	if _, err := sink.Apply(context.Background(), Batch{ObjectScopes: []string{"people", "directory_profiles"}}); err == nil {
		t.Fatal("expected People failure")
	}
	if len(calls) != 1 || calls[0] != "people" {
		t.Fatalf("calls = %v, Directory must not run after People failure", calls)
	}
}

func TestScopedSinkForwardsCombinedJobFailureToDirectory(t *testing.T) {
	calls := []string{}
	directory := &recordingFailureSink{recordingSink: recordingSink{name: "directory", calls: &calls}}
	sink := NewScopedSink(recordingSink{name: "people", calls: &calls}, directory)
	if err := sink.Fail(context.Background(), Batch{ObjectScopes: []string{"people", "directory_profiles"}}, "failed", "safe"); err != nil {
		t.Fatal(err)
	}
	if directory.failures != 1 {
		t.Fatalf("failures = %d, want 1", directory.failures)
	}
}
