package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/updater"
)

func TestPinnedTimerUpdateSkipsBeforeUpdaterOrNetworkWork(t *testing.T) {
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "auto-update-policy.json")
	lockPath := filepath.Join(dir, "update.lock")
	journalPath := filepath.Join(dir, "update-journal.json")
	if _, err := updater.InitializeAutoUpdatePolicy(policyPath, "tracking", "latest", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := updater.PinAutoUpdatePolicy(policyPath, "CHG-100", time.Now()); err != nil {
		t.Fatal(err)
	}

	err := runUpdate([]string{
		"--trigger", "timer",
		"--policy-file", policyPath,
		"--lock-file", lockPath,
		"--journal-file", journalPath,
		"--base-url", "https://must-not-be-contacted.invalid",
		"--version", "latest",
	})
	if err != nil {
		t.Fatalf("runUpdate(pinned timer) error = %v", err)
	}
	if _, err := os.Stat(journalPath); !os.IsNotExist(err) {
		t.Fatalf("pinned timer unexpectedly created update journal: %v", err)
	}
	policy, err := updater.ReadAutoUpdatePolicy(policyPath)
	if err != nil || policy.State != "pinned" || policy.LastTimerCheck == "" {
		t.Fatalf("pinned timer policy = (%+v, %v)", policy, err)
	}
}

func TestRollbackExecutionPinsPolicyAndUsesSharedLock(t *testing.T) {
	dir := t.TempDir()
	installDir := filepath.Join(dir, "install")
	if err := os.MkdirAll(installDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeExecutable := func(name string, value string) {
		if err := os.WriteFile(filepath.Join(installDir, name), []byte(value), 0755); err != nil {
			t.Fatal(err)
		}
	}
	writeExecutable("hzy-data-runtime", "current")
	writeExecutable("hzy-data-runtime.previous", "previous")
	policyPath := filepath.Join(dir, "auto-update-policy.json")
	lockPath := filepath.Join(dir, "update.lock")
	journalPath := filepath.Join(dir, "update-journal.json")
	if _, err := updater.InitializeAutoUpdatePolicy(policyPath, "tracking", "latest", time.Now()); err != nil {
		t.Fatal(err)
	}

	err := runRollback([]string{
		"--install-dir", installDir,
		"--no-restart",
		"--execute",
		"--confirm", updater.RollbackConfirmation,
		"--change-id", "CHG-ROLLBACK-1",
		"--policy-file", policyPath,
		"--lock-file", lockPath,
		"--journal-file", journalPath,
	})
	if err != nil {
		t.Fatalf("runRollback() error = %v", err)
	}
	current, _ := os.ReadFile(filepath.Join(installDir, "hzy-data-runtime"))
	previous, _ := os.ReadFile(filepath.Join(installDir, "hzy-data-runtime.previous"))
	if string(current) != "previous" || string(previous) != "current" {
		t.Fatalf("rollback binaries current=%q previous=%q", current, previous)
	}
	policy, err := updater.ReadAutoUpdatePolicy(policyPath)
	if err != nil || policy.State != "pinned" || policy.ChangeID != "CHG-ROLLBACK-1" {
		t.Fatalf("rollback policy = (%+v, %v)", policy, err)
	}
	journal, err := updater.ReadUpdateJournal(journalPath)
	if err != nil || journal.Status != "succeeded" || journal.RollbackStatus != "completed" {
		t.Fatalf("rollback journal = (%+v, %v)", journal, err)
	}
}

func TestAutoUpdateUnpinRequiresExactConfirmation(t *testing.T) {
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "auto-update-policy.json")
	lockPath := filepath.Join(dir, "update.lock")
	if _, err := updater.InitializeAutoUpdatePolicy(policyPath, "tracking", "latest", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := updater.PinAutoUpdatePolicy(policyPath, "CHG-100", time.Now()); err != nil {
		t.Fatal(err)
	}
	baseArgs := []string{
		"unpin",
		"--policy-file", policyPath,
		"--lock-file", lockPath,
		"--state", "tracking",
		"--target-version", "latest",
		"--change-id", "CHG-101",
	}
	if err := runAutoUpdatePolicy(append(baseArgs, "--confirm", "wrong")); err == nil {
		t.Fatal("runAutoUpdatePolicy(unpin) accepted wrong confirmation")
	}
	policy, _ := updater.ReadAutoUpdatePolicy(policyPath)
	if policy.State != "pinned" {
		t.Fatalf("wrong confirmation changed policy: %+v", policy)
	}
	if err := runAutoUpdatePolicy(append(baseArgs, "--confirm", "unpin:CHG-101:tracking:latest")); err != nil {
		t.Fatalf("runAutoUpdatePolicy(unpin) error = %v", err)
	}
	policy, _ = updater.ReadAutoUpdatePolicy(policyPath)
	if policy.State != "tracking" {
		t.Fatalf("confirmed unpin policy = %+v", policy)
	}
}
