package updater

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"syscall"
)

const UpdateJournalSchemaVersion = 1

const maxUpdateJournalBytes = 64 * 1024

var journalSafeTextPattern = regexp.MustCompile(`^[A-Za-z0-9._:@/-]{1,160}$`)
var journalSensitiveTextPattern = regexp.MustCompile(`(?i)(authorization|cookie|password|secret|token)`)

type UpdateJournal struct {
	SchemaVersion            int    `json:"schemaVersion"`
	OperationID              string `json:"operationId"`
	RequestID                string `json:"requestId,omitempty"`
	Trigger                  string `json:"trigger"`
	Status                   string `json:"status"`
	Phase                    string `json:"phase"`
	TargetVersion            string `json:"targetVersion"`
	PackageSourceFingerprint string `json:"packageSourceFingerprint,omitempty"`
	BeforeVersion            string `json:"beforeVersion,omitempty"`
	BeforeBinarySHA256       string `json:"beforeBinarySha256,omitempty"`
	AfterVersion             string `json:"afterVersion,omitempty"`
	AfterBinarySHA256        string `json:"afterBinarySha256,omitempty"`
	ArtifactSHA256           string `json:"artifactSha256,omitempty"`
	ManifestSHA256           string `json:"manifestSha256,omitempty"`
	SigningKeyID             string `json:"signingKeyId,omitempty"`
	AutoUpdateState          string `json:"autoUpdateState,omitempty"`
	RollbackStatus           string `json:"rollbackStatus,omitempty"`
	ErrorCode                string `json:"errorCode,omitempty"`
	TriggeredAt              string `json:"triggeredAt"`
	StartedAt                string `json:"startedAt,omitempty"`
	FinishedAt               string `json:"finishedAt,omitempty"`
	AutomaticRetry           bool   `json:"automaticRetry"`
}

func ReadUpdateJournal(path string) (UpdateJournal, error) {
	file, err := os.Open(path)
	if err != nil {
		return UpdateJournal{}, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxUpdateJournalBytes+1))
	decoder.DisallowUnknownFields()
	var journal UpdateJournal
	if err := decoder.Decode(&journal); err != nil {
		return UpdateJournal{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return UpdateJournal{}, fmt.Errorf("update journal contains trailing data")
		}
		return UpdateJournal{}, err
	}
	if err := validateUpdateJournal(journal); err != nil {
		return UpdateJournal{}, err
	}
	return journal, nil
}

func WriteUpdateJournal(path string, journal UpdateJournal) error {
	if journal.SchemaVersion == 0 {
		journal.SchemaVersion = UpdateJournalSchemaVersion
	}
	if err := validateUpdateJournal(journal); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if len(payload) > maxUpdateJournalBytes {
		return fmt.Errorf("update journal exceeds %d bytes", maxUpdateJournalBytes)
	}

	directoryPath := filepath.Dir(path)
	if err := os.MkdirAll(directoryPath, 0750); err != nil {
		return err
	}
	var owner *syscall.Stat_t
	ownerFromDirectory := false
	if info, statErr := os.Stat(path); statErr == nil {
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			copy := *stat
			owner = &copy
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	} else if directoryInfo, directoryStatErr := os.Stat(directoryPath); directoryStatErr != nil {
		return directoryStatErr
	} else if stat, ok := directoryInfo.Sys().(*syscall.Stat_t); ok {
		// The privileged systemd updater may be the first process to recreate a
		// missing journal after an operator quarantines a corrupt file. Inherit
		// the config directory owner so the unprivileged runtime can still read
		// the resulting 0600 journal and does not deadlock future API updates.
		copy := *stat
		owner = &copy
		ownerFromDirectory = true
	}

	temporary, err := os.CreateTemp(directoryPath, ".update-journal-*")
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
		ownerGroup := int(owner.Gid)
		if ownerFromDirectory {
			// An unprivileged directory owner may not belong to the directory's
			// shared connector group. Only the UID is security-relevant for 0600.
			ownerGroup = -1
		}
		if err := temporary.Chown(int(owner.Uid), ownerGroup); err != nil {
			_ = temporary.Close()
			return err
		}
	}
	if _, err := io.Copy(temporary, bytes.NewReader(payload)); err != nil {
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

func validateUpdateJournal(journal UpdateJournal) error {
	if journal.SchemaVersion != UpdateJournalSchemaVersion {
		return fmt.Errorf("unsupported update journal schema version: %d", journal.SchemaVersion)
	}
	if !journalSafeTextPattern.MatchString(journal.OperationID) {
		return fmt.Errorf("invalid update journal operationId")
	}
	if journal.RequestID != "" && !journalSafeTextPattern.MatchString(journal.RequestID) {
		return fmt.Errorf("invalid update journal requestId")
	}
	if !journalSafeTextPattern.MatchString(journal.TargetVersion) {
		return fmt.Errorf("invalid update journal targetVersion")
	}
	if !oneOf(journal.Trigger, "api", "timer", "manual") {
		return fmt.Errorf("invalid update journal trigger: %s", journal.Trigger)
	}
	if !oneOf(journal.Status, "queued", "running", "succeeded", "failed", "partial_or_unknown", "skipped") {
		return fmt.Errorf("invalid update journal status: %s", journal.Status)
	}
	if !oneOf(journal.Phase, "queued", "resolving", "downloading", "verifying", "installing", "restarting", "verifying_runtime", "completed", "failed", "unknown", "skipped") {
		return fmt.Errorf("invalid update journal phase: %s", journal.Phase)
	}
	for name, value := range map[string]string{
		"errorCode":       journal.ErrorCode,
		"signingKeyId":    journal.SigningKeyID,
		"autoUpdateState": journal.AutoUpdateState,
		"rollbackStatus":  journal.RollbackStatus,
	} {
		if value != "" && (!journalSafeTextPattern.MatchString(value) || journalSensitiveTextPattern.MatchString(value)) {
			return fmt.Errorf("invalid update journal %s", name)
		}
	}
	for name, value := range map[string]string{
		"packageSourceFingerprint": journal.PackageSourceFingerprint,
		"beforeBinarySha256":       journal.BeforeBinarySHA256,
		"afterBinarySha256":        journal.AfterBinarySHA256,
		"artifactSha256":           journal.ArtifactSHA256,
		"manifestSha256":           journal.ManifestSHA256,
	} {
		if value != "" && !isSHA256(value) {
			return fmt.Errorf("invalid update journal %s", name)
		}
	}
	if journal.TriggeredAt == "" {
		return fmt.Errorf("update journal triggeredAt is required")
	}
	return nil
}

func isSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
