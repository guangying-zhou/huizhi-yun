package updater

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAutoUpdatePolicyPinPersistsAcrossInitialization(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	initialAt := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	initial, err := InitializeAutoUpdatePolicy(path, "tracking", "latest", initialAt)
	if err != nil || initial.State != "tracking" {
		t.Fatalf("InitializeAutoUpdatePolicy() = (%+v, %v)", initial, err)
	}
	pinned, err := PinAutoUpdatePolicy(path, "CHG-100", initialAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("PinAutoUpdatePolicy() error = %v", err)
	}
	if pinned.State != "pinned" || pinned.PreviousState != "tracking" {
		t.Fatalf("unexpected pinned policy: %+v", pinned)
	}
	preserved, err := InitializeAutoUpdatePolicy(path, "tracking", "latest", initialAt.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("InitializeAutoUpdatePolicy(existing) error = %v", err)
	}
	if preserved.State != "pinned" || preserved.ChangeID != "CHG-100" {
		t.Fatalf("installer-style initialization overwrote pin: %+v", preserved)
	}
}

func TestAutoUpdatePolicyInitializationRefreshesUnpinnedInstallerTarget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	if _, err := InitializeAutoUpdatePolicy(path, "tracking", "0.3.96", now); err != nil {
		t.Fatal(err)
	}
	updated, err := InitializeAutoUpdatePolicy(path, "tracking", "0.3.97", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("InitializeAutoUpdatePolicy(update) error = %v", err)
	}
	if updated.State != "tracking" || updated.TargetVersion != "0.3.97" {
		t.Fatalf("installer target was not refreshed: %+v", updated)
	}
	if updated.ChangedAt != now.Add(time.Minute).Format(time.RFC3339) {
		t.Fatalf("changedAt = %q, want refreshed timestamp", updated.ChangedAt)
	}
}

func TestAutoUpdatePolicyRequiresExplicitUnpinTransition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	if _, err := InitializeAutoUpdatePolicy(path, "tracking", "latest", now); err != nil {
		t.Fatal(err)
	}
	if _, err := PinAutoUpdatePolicy(path, "CHG-100", now); err != nil {
		t.Fatal(err)
	}
	policy, err := UnpinAutoUpdatePolicy(path, "CHG-101", "tracking", "latest", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("UnpinAutoUpdatePolicy() error = %v", err)
	}
	if policy.State != "tracking" || policy.PreviousState != "pinned" || policy.ChangeID != "CHG-101" {
		t.Fatalf("unexpected unpinned policy: %+v", policy)
	}
}

func TestAutoUpdateTimerFailsClosedForMissingOrCorruptPolicy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	if policy, allowed, err := RecordTimerCheck(path, time.Now()); err == nil || allowed || policy.State != "pinned" {
		t.Fatalf("RecordTimerCheck(missing) = (%+v, %t, %v), want fail-closed pinned", policy, allowed, err)
	}
	if err := os.WriteFile(path, []byte("not-json\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if policy, allowed, err := RecordTimerCheck(path, time.Now()); err == nil || allowed || policy.State != "pinned" {
		t.Fatalf("RecordTimerCheck(corrupt) = (%+v, %t, %v), want fail-closed pinned", policy, allowed, err)
	}
}

func TestPinnedTimerCheckDoesNotEnableUpdateOrGrowHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	if _, err := InitializeAutoUpdatePolicy(path, "tracking", "latest", now); err != nil {
		t.Fatal(err)
	}
	if _, err := PinAutoUpdatePolicy(path, "CHG-100", now); err != nil {
		t.Fatal(err)
	}
	policy, allowed, err := RecordTimerCheck(path, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("RecordTimerCheck() error = %v", err)
	}
	if allowed || policy.State != "pinned" || policy.LastTimerCheck == "" {
		t.Fatalf("RecordTimerCheck() = (%+v, %t), want pinned skip", policy, allowed)
	}
}

func TestAutoUpdatePolicyRejectsUnsafeTargetVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auto-update-policy.json")
	if _, err := InitializeAutoUpdatePolicy(path, "tracking", "../latest", time.Now()); err == nil {
		t.Fatal("InitializeAutoUpdatePolicy() accepted unsafe target version")
	}
}
