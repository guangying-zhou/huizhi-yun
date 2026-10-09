package updater

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func validUpdateJournal() UpdateJournal {
	return UpdateJournal{
		SchemaVersion:            UpdateJournalSchemaVersion,
		OperationID:              "update-20260710-001",
		RequestID:                "request-001",
		Trigger:                  "api",
		Status:                   "queued",
		Phase:                    "queued",
		TargetVersion:            "0.3.95",
		PackageSourceFingerprint: strings.Repeat("a", 64),
		TriggeredAt:              "2026-07-10T12:00:00Z",
		AutomaticRetry:           false,
	}
}

func TestUpdateJournalRoundTripIsAtomicAnd0600(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "update-journal.json")
	journal := validUpdateJournal()
	if err := WriteUpdateJournal(path, journal); err != nil {
		t.Fatalf("WriteUpdateJournal() error = %v", err)
	}
	loaded, err := ReadUpdateJournal(path)
	if err != nil {
		t.Fatalf("ReadUpdateJournal() error = %v", err)
	}
	if loaded != journal {
		t.Fatalf("ReadUpdateJournal() = %+v, want %+v", loaded, journal)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat journal: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("journal mode = %#o, want 0600", info.Mode().Perm())
	}
	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".update-journal-*"))
	if err != nil {
		t.Fatalf("glob journal temp files: %v", err)
	}
	if len(leftovers) != 0 {
		t.Fatalf("journal temp files remain: %v", leftovers)
	}
}

func TestUpdateJournalNewFileInheritsDirectoryOwner(t *testing.T) {
	directoryPath := filepath.Join(t.TempDir(), "state")
	if err := os.MkdirAll(directoryPath, 0750); err != nil {
		t.Fatal(err)
	}
	directoryInfo, err := os.Stat(directoryPath)
	if err != nil {
		t.Fatal(err)
	}
	directoryOwner, ok := directoryInfo.Sys().(*syscall.Stat_t)
	if !ok {
		t.Skip("filesystem owner metadata is unavailable")
	}

	path := filepath.Join(directoryPath, "update-journal.json")
	if err := WriteUpdateJournal(path, validUpdateJournal()); err != nil {
		t.Fatalf("WriteUpdateJournal() error = %v", err)
	}
	journalInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	journalOwner, ok := journalInfo.Sys().(*syscall.Stat_t)
	if !ok {
		t.Skip("filesystem owner metadata is unavailable")
	}
	if journalOwner.Uid != directoryOwner.Uid {
		t.Fatalf(
			"journal owner uid = %d, want config directory owner uid %d",
			journalOwner.Uid,
			directoryOwner.Uid,
		)
	}
}

func TestUpdateJournalOverwriteKeepsACompleteReadableDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update-journal.json")
	queued := validUpdateJournal()
	if err := WriteUpdateJournal(path, queued); err != nil {
		t.Fatalf("write queued journal: %v", err)
	}
	succeeded := queued
	succeeded.Status = "succeeded"
	succeeded.Phase = "completed"
	succeeded.StartedAt = "2026-07-10T12:00:01Z"
	succeeded.FinishedAt = "2026-07-10T12:00:05Z"
	succeeded.AfterVersion = "0.3.95"
	succeeded.AfterBinarySHA256 = strings.Repeat("b", 64)
	if err := WriteUpdateJournal(path, succeeded); err != nil {
		t.Fatalf("write succeeded journal: %v", err)
	}
	loaded, err := ReadUpdateJournal(path)
	if err != nil {
		t.Fatalf("read succeeded journal: %v", err)
	}
	if loaded.Status != "succeeded" || loaded.AfterBinarySHA256 != strings.Repeat("b", 64) {
		t.Fatalf("unexpected journal after overwrite: %+v", loaded)
	}
}

func TestUpdateJournalRejectsSecretShapedOrUnknownData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update-journal.json")
	journal := validUpdateJournal()
	journal.ErrorCode = "Authorization:Bearer-secret"
	if err := WriteUpdateJournal(path, journal); err == nil {
		t.Fatal("WriteUpdateJournal() accepted unsafe errorCode")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("invalid journal created a file: %v", err)
	}

	unsafeJSON := `{"schemaVersion":1,"operationId":"op-1","trigger":"api","status":"failed","phase":"failed","targetVersion":"0.3.95","triggeredAt":"2026-07-10T12:00:00Z","automaticRetry":false,"token":"secret"}`
	unsafeJSON = strings.ReplaceAll(unsafeJSON, `\"`, `"`)
	if err := os.WriteFile(path, []byte(unsafeJSON), 0600); err != nil {
		t.Fatalf("write unsafe fixture: %v", err)
	}
	if _, err := ReadUpdateJournal(path); err == nil {
		t.Fatal("ReadUpdateJournal() accepted unknown secret field")
	}
}

func TestUpdateJournalRejectsInvalidStateAndDigest(t *testing.T) {
	journal := validUpdateJournal()
	journal.Status = "retrying"
	if err := WriteUpdateJournal(filepath.Join(t.TempDir(), "journal.json"), journal); err == nil {
		t.Fatal("WriteUpdateJournal() accepted retrying status")
	}
	journal = validUpdateJournal()
	journal.ArtifactSHA256 = "not-a-digest"
	if err := WriteUpdateJournal(filepath.Join(t.TempDir(), "journal.json"), journal); err == nil {
		t.Fatal("WriteUpdateJournal() accepted invalid artifact digest")
	}
}
