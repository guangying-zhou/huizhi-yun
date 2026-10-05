package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/updater"
	"github.com/huizhi-yun/data-runtime/internal/version"
)

func configurePersistentUpdateFixture(t *testing.T) string {
	t.Helper()
	configDir := t.TempDir()
	installDir := t.TempDir()
	t.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", configDir)
	t.Setenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", officialDataRuntimePackageOrigin)
	t.Setenv("HZY_DATA_RUNTIME_ALLOWED_UPDATE_BASE_URLS", "")
	t.Setenv("HZY_DATA_RUNTIME_INSTALL_DIR", installDir)
	t.Setenv("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime")
	if err := os.WriteFile(filepath.Join(installDir, "hzy-data-runtime"), []byte("current-binary"), 0755); err != nil {
		t.Fatalf("write current binary fixture: %v", err)
	}
	return configDir
}

func TestTriggerUpdatePersistsQueuedOperationBeforeExternalRequest(t *testing.T) {
	configurePersistentUpdateFixture(t)
	server := &Server{}
	response, err := server.triggerUpdate(map[string]any{"targetVersion": "0.3.95"}, "private-request-id")
	if err != nil {
		t.Fatalf("triggerUpdate() error = %v", err)
	}
	operationID, _ := response["operationId"].(string)
	if !strings.HasPrefix(operationID, "update-") {
		t.Fatalf("operationId = %q", operationID)
	}
	journal, err := updater.ReadUpdateJournal(updateJournalPath())
	if err != nil {
		t.Fatalf("ReadUpdateJournal() error = %v", err)
	}
	if journal.OperationID != operationID || journal.Status != "queued" || journal.Trigger != "api" {
		t.Fatalf("unexpected queued journal: %+v", journal)
	}
	if journal.RequestID == "private-request-id" || len(journal.RequestID) != 64 {
		t.Fatalf("journal requestId must be a non-reversible fingerprint: %q", journal.RequestID)
	}
	requestEnv, err := os.ReadFile(updateRequestPath())
	if err != nil {
		t.Fatalf("read update request env: %v", err)
	}
	values := parseRuntimeUpdateRequestEnv(t, string(requestEnv))
	if len(values) != 2 || values["HZY_DATA_RUNTIME_UPDATE_VERSION"] != "0.3.95" ||
		values["HZY_DATA_RUNTIME_UPDATE_OPERATION_ID"] != operationID {
		t.Fatalf("unexpected update request env: %#v", values)
	}
	if strings.Contains(string(requestEnv), "private-request-id") {
		t.Fatal("request env leaked the inbound request ID")
	}
}

func TestPersistentJournalSurvivesServerReplacementAndBlocksDuplicate(t *testing.T) {
	configurePersistentUpdateFixture(t)
	first := &Server{}
	if _, err := first.triggerUpdate(map[string]any{"targetVersion": "0.3.95"}, "request-1"); err != nil {
		t.Fatalf("first triggerUpdate() error = %v", err)
	}
	second := &Server{}
	if _, err := second.triggerUpdate(map[string]any{"targetVersion": "0.3.95"}, "request-2"); err == nil {
		t.Fatal("second Server accepted a duplicate persistent update")
	}
	status := second.runtimeUpdateStatus()
	if status["status"] != "queued" || status["running"] != true {
		t.Fatalf("replacement Server status = %#v, want persistent queued", status)
	}

	journal, err := updater.ReadUpdateJournal(updateJournalPath())
	if err != nil {
		t.Fatal(err)
	}
	journal.Status = "succeeded"
	journal.Phase = "completed"
	journal.StartedAt = journal.TriggeredAt
	journal.FinishedAt = journal.TriggeredAt
	journal.AfterVersion = version.Version
	journal.AfterBinarySHA256 = strings.Repeat("b", 64)
	if err := updater.WriteUpdateJournal(updateJournalPath(), journal); err != nil {
		t.Fatal(err)
	}
	status = (&Server{}).runtimeUpdateStatus()
	if status["status"] != "succeeded" || status["expectedVersionMatches"] != true {
		t.Fatalf("replacement Server terminal status = %#v", status)
	}
}

func TestCorruptPersistentJournalNeverFallsBackToIdle(t *testing.T) {
	configurePersistentUpdateFixture(t)
	if err := os.WriteFile(updateJournalPath(), []byte("truncated"), 0600); err != nil {
		t.Fatal(err)
	}
	status := (&Server{}).runtimeUpdateStatus()
	if status["status"] != "partial_or_unknown" || status["errorCode"] != "runtime_update_journal_read_failed" {
		t.Fatalf("corrupt journal status = %#v", status)
	}
}

func TestStaleRunningJournalBecomesPartialOrUnknown(t *testing.T) {
	configurePersistentUpdateFixture(t)
	journal := updater.UpdateJournal{
		SchemaVersion:  updater.UpdateJournalSchemaVersion,
		OperationID:    "update-stale-1",
		Trigger:        "api",
		Status:         "running",
		Phase:          "installing",
		TargetVersion:  "0.3.95",
		TriggeredAt:    "2026-07-10T00:00:00Z",
		StartedAt:      "2026-07-10T00:00:01Z",
		AutomaticRetry: false,
	}
	if err := updater.WriteUpdateJournal(updateJournalPath(), journal); err != nil {
		t.Fatal(err)
	}
	status := (&Server{}).runtimeUpdateStatus()
	if status["status"] != "partial_or_unknown" || status["errorCode"] != "runtime_update_executor_stale" {
		t.Fatalf("stale running journal status = %#v", status)
	}
	stored, err := updater.ReadUpdateJournal(updateJournalPath())
	if err != nil || stored.Status != "partial_or_unknown" {
		t.Fatalf("stored stale reconciliation = (%+v, %v)", stored, err)
	}
}
