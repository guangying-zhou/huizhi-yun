package updater

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExecutionLockExcludesConcurrentUpdaterAndRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update.lock")
	first, err := AcquireExecutionLock(context.Background(), path, false)
	if err != nil {
		t.Fatalf("AcquireExecutionLock(first) error = %v", err)
	}
	defer first.Release()

	second, err := AcquireExecutionLock(context.Background(), path, false)
	if !errors.Is(err, ErrUpdateExecutionBusy) || second != nil {
		t.Fatalf("AcquireExecutionLock(second) = (%v, %v), want busy", second, err)
	}
	if err := first.Release(); err != nil {
		t.Fatalf("Release(first) error = %v", err)
	}
	third, err := AcquireExecutionLock(context.Background(), path, false)
	if err != nil {
		t.Fatalf("AcquireExecutionLock(third) error = %v", err)
	}
	defer third.Release()

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat lock: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("lock mode = %#o, want 0600", info.Mode().Perm())
	}
}

func TestExecutionLockWaitHonorsContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update.lock")
	first, err := AcquireExecutionLock(context.Background(), path, false)
	if err != nil {
		t.Fatalf("AcquireExecutionLock(first) error = %v", err)
	}
	defer first.Release()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err = AcquireExecutionLock(ctx, path, true)
	if !errors.Is(err, ErrUpdateExecutionBusy) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("AcquireExecutionLock(wait) error = %v, want busy deadline", err)
	}
}
