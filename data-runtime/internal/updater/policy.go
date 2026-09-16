package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const AutoUpdatePolicySchemaVersion = 1

var autoUpdateTargetPattern = regexp.MustCompile(`^(?:latest|[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$`)

type AutoUpdatePolicy struct {
	SchemaVersion  int    `json:"schemaVersion"`
	State          string `json:"state"`
	TargetVersion  string `json:"targetVersion"`
	PreviousState  string `json:"previousState,omitempty"`
	ChangeID       string `json:"changeId,omitempty"`
	ChangedAt      string `json:"changedAt"`
	LastTimerCheck string `json:"lastTimerCheck,omitempty"`
}

func ReadAutoUpdatePolicy(path string) (AutoUpdatePolicy, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return AutoUpdatePolicy{}, err
	}
	var policy AutoUpdatePolicy
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&policy); err != nil {
		return AutoUpdatePolicy{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return AutoUpdatePolicy{}, fmt.Errorf("auto-update policy contains trailing data")
		}
		return AutoUpdatePolicy{}, err
	}
	if err := validateAutoUpdatePolicy(policy); err != nil {
		return AutoUpdatePolicy{}, err
	}
	return policy, nil
}

func WriteAutoUpdatePolicy(path string, policy AutoUpdatePolicy) error {
	if policy.SchemaVersion == 0 {
		policy.SchemaVersion = AutoUpdatePolicySchemaVersion
	}
	if err := validateAutoUpdatePolicy(policy); err != nil {
		return err
	}
	return writeJSONAtomically(path, policy, ".auto-update-policy-*")
}

func InitializeAutoUpdatePolicy(path string, state string, targetVersion string, now time.Time) (AutoUpdatePolicy, error) {
	if existing, err := ReadAutoUpdatePolicy(path); err == nil {
		if existing.State == "pinned" {
			return existing, nil
		}
		if existing.State == state && existing.TargetVersion == targetVersion {
			return existing, nil
		}
		existing.State = state
		existing.TargetVersion = targetVersion
		existing.PreviousState = ""
		existing.ChangeID = ""
		existing.ChangedAt = now.UTC().Format(time.RFC3339)
		if err := WriteAutoUpdatePolicy(path, existing); err != nil {
			return AutoUpdatePolicy{}, err
		}
		return existing, nil
	} else if !os.IsNotExist(err) {
		return AutoUpdatePolicy{}, fmt.Errorf("existing auto-update policy is invalid; refusing to replace it: %w", err)
	}
	policy := AutoUpdatePolicy{
		SchemaVersion: AutoUpdatePolicySchemaVersion,
		State:         state,
		TargetVersion: targetVersion,
		ChangedAt:     now.UTC().Format(time.RFC3339),
	}
	if err := WriteAutoUpdatePolicy(path, policy); err != nil {
		return AutoUpdatePolicy{}, err
	}
	return policy, nil
}

func PinAutoUpdatePolicy(path string, changeID string, now time.Time) (AutoUpdatePolicy, error) {
	policy, err := ReadAutoUpdatePolicy(path)
	if err != nil {
		return AutoUpdatePolicy{}, err
	}
	if !journalSafeTextPattern.MatchString(changeID) {
		return AutoUpdatePolicy{}, fmt.Errorf("invalid auto-update change ID")
	}
	if policy.State != "pinned" {
		policy.PreviousState = policy.State
	}
	policy.State = "pinned"
	policy.ChangeID = changeID
	policy.ChangedAt = now.UTC().Format(time.RFC3339)
	if err := WriteAutoUpdatePolicy(path, policy); err != nil {
		return AutoUpdatePolicy{}, err
	}
	return policy, nil
}

func UnpinAutoUpdatePolicy(path string, changeID string, targetState string, targetVersion string, now time.Time) (AutoUpdatePolicy, error) {
	policy, err := ReadAutoUpdatePolicy(path)
	if err != nil {
		return AutoUpdatePolicy{}, err
	}
	if policy.State != "pinned" {
		return AutoUpdatePolicy{}, fmt.Errorf("auto-update policy is not pinned")
	}
	if !journalSafeTextPattern.MatchString(changeID) {
		return AutoUpdatePolicy{}, fmt.Errorf("invalid auto-update change ID")
	}
	if targetState != "tracking" && targetState != "disabled" {
		return AutoUpdatePolicy{}, fmt.Errorf("unpin target state must be tracking or disabled")
	}
	policy.State = targetState
	policy.PreviousState = "pinned"
	policy.TargetVersion = targetVersion
	policy.ChangeID = changeID
	policy.ChangedAt = now.UTC().Format(time.RFC3339)
	if err := WriteAutoUpdatePolicy(path, policy); err != nil {
		return AutoUpdatePolicy{}, err
	}
	return policy, nil
}

func RecordTimerCheck(path string, now time.Time) (AutoUpdatePolicy, bool, error) {
	policy, err := ReadAutoUpdatePolicy(path)
	if err != nil {
		return AutoUpdatePolicy{State: "pinned"}, false, fmt.Errorf("auto-update policy is unreadable; failing closed: %w", err)
	}
	policy.LastTimerCheck = now.UTC().Format(time.RFC3339)
	if err := WriteAutoUpdatePolicy(path, policy); err != nil {
		return AutoUpdatePolicy{State: "pinned"}, false, err
	}
	return policy, policy.State == "tracking", nil
}

func validateAutoUpdatePolicy(policy AutoUpdatePolicy) error {
	if policy.SchemaVersion != AutoUpdatePolicySchemaVersion {
		return fmt.Errorf("unsupported auto-update policy schema version: %d", policy.SchemaVersion)
	}
	if !oneOf(policy.State, "disabled", "tracking", "pinned") {
		return fmt.Errorf("invalid auto-update policy state: %s", policy.State)
	}
	if policy.PreviousState != "" && !oneOf(policy.PreviousState, "disabled", "tracking", "pinned") {
		return fmt.Errorf("invalid auto-update previous state: %s", policy.PreviousState)
	}
	if !autoUpdateTargetPattern.MatchString(policy.TargetVersion) {
		return fmt.Errorf("invalid auto-update target version")
	}
	if policy.ChangeID != "" && !journalSafeTextPattern.MatchString(policy.ChangeID) {
		return fmt.Errorf("invalid auto-update change ID")
	}
	if policy.ChangedAt == "" {
		return fmt.Errorf("auto-update changedAt is required")
	}
	return nil
}

func writeJSONAtomically(path string, value any, pattern string) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	directoryPath := filepath.Dir(path)
	if err := os.MkdirAll(directoryPath, 0750); err != nil {
		return err
	}
	var owner *syscall.Stat_t
	if info, statErr := os.Stat(path); statErr == nil {
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			copy := *stat
			owner = &copy
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	temporary, err := os.CreateTemp(directoryPath, pattern)
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return err
	}
	if owner != nil {
		if err := temporary.Chown(int(owner.Uid), int(owner.Gid)); err != nil {
			_ = temporary.Close()
			return err
		}
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	if err := os.Chmod(path, 0600); err != nil {
		return err
	}
	directory, err := os.Open(directoryPath)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
