package people

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func contributionReplayBody() map[string]any {
	return map[string]any{
		"cycle_code":        "CYCLE-202607",
		"period_start":      "2026-07-01",
		"period_end":        "2026-07-31",
		"project_code":      "PRJ-1",
		"source_app":        "aims",
		"source_biz_type":   "time_entries",
		"sync_mode":         "replace_scope",
		"snapshot_complete": true,
		"captured_at":       "2026-07-31 18:00:00",
		"items": []any{map[string]any{
			"employee_uid":       "u-1",
			"project_code":       "PRJ-1",
			"role_code":          "delivery",
			"work_hours":         80.0,
			"contribution_score": 80.0,
			"source_app":         "aims",
			"source_biz_type":    "time_entries",
			"source_biz_id":      "PRJ-1:u-1",
			"source_refs": map[string]any{
				"time_entries": []any{11, 12},
			},
		}},
	}
}

func versionedContributionBody(t *testing.T, revision uint64) map[string]any {
	t.Helper()
	body := contributionReplayBody()
	hash, err := contributionSnapshotContentHash(body)
	if err != nil {
		t.Fatal(err)
	}
	body["source_revision"] = revision
	body["snapshot_hash"] = hash
	return body
}

func expectContributionSync(mock sqlmock.Sqlmock, removed int64) {
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)INSERT INTO people_contribution_snapshots.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			sqlmock.AnyArg(), "CYCLE-202607", "u-1", "PRJ-1", "delivery", 80.0, 80.0,
			"scored", "aims", "time_entries", "PRJ-1:u-1", sqlmock.AnyArg(), "2026-07-31 18:00:00",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)DELETE FROM people_contribution_snapshots.*cycle_code = \?.*project_code = \?.*source_app = \?.*source_biz_type = \?.*confirmed_at IS NULL.*employee_uid = \?.*source_biz_id = \?`).
		WithArgs("CYCLE-202607", "PRJ-1", "aims", "time_entries", "u-1", "PRJ-1:u-1").
		WillReturnResult(sqlmock.NewResult(0, removed))
	mock.ExpectCommit()
}

func TestSyncContributionsReplaysByNaturalSourceKey(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	expectContributionSync(mock, 0)
	expectContributionSync(mock, 0)
	for attempt := 0; attempt < 2; attempt++ {
		result, err := adapter.syncContributions(context.Background(), contributionReplayBody())
		if err != nil {
			t.Fatalf("attempt %d: syncContributions: %v", attempt+1, err)
		}
		if synced := int(float64FromAny(result["synced"])); synced != 1 {
			t.Fatalf("attempt %d: expected one upserted contribution, got %#v", attempt+1, result)
		}
		if mode := cleanAnyString(result["sync_mode"]); mode != "replace_scope" {
			t.Fatalf("attempt %d: expected replace_scope mode, got %#v", attempt+1, result)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsStoresAimsApprovedTimeAsUnscored(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	item := body["items"].([]any)[0].(map[string]any)
	delete(item, "contribution_score")
	item["score_status"] = "unscored"
	item["source_refs"].(map[string]any)["review_status"] = "approved"

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)INSERT INTO people_contribution_snapshots.*contribution_score.*score_status.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			sqlmock.AnyArg(), "CYCLE-202607", "u-1", "PRJ-1", "delivery", 80.0, nil, "unscored",
			"aims", "time_entries", "PRJ-1:u-1", sqlmock.AnyArg(), "2026-07-31 18:00:00",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)DELETE FROM people_contribution_snapshots.*confirmed_at IS NULL`).
		WithArgs("CYCLE-202607", "PRJ-1", "aims", "time_entries", "u-1", "PRJ-1:u-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	if _, err := adapter.syncContributions(context.Background(), body); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsReplaceShrinksCollection(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	expectContributionSync(mock, 1)

	result, err := adapter.syncContributions(context.Background(), contributionReplayBody())
	if err != nil {
		t.Fatalf("syncContributions: %v", err)
	}
	if removed := int64(float64FromAny(result["removed"])); removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsSkipsStaleRevisionWithoutMutation(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := versionedContributionBody(t, 1)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectQuery(`SELECT applied_revision,snapshot_hash FROM people_contribution_scope_versions.*FOR UPDATE`).
		WithArgs("CYCLE-202607", "PRJ-1", "aims", "time_entries").
		WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash"}).AddRow(2, strings.Repeat("b", 64)))
	mock.ExpectCommit()

	result, err := adapter.syncContributions(context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	if result["staleSkipped"] != true || result["appliedRevision"] != uint64(2) {
		t.Fatalf("unexpected stale result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsSameRevisionDifferentStoredHash(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := versionedContributionBody(t, 2)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectQuery(`SELECT applied_revision,snapshot_hash FROM people_contribution_scope_versions.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash"}).AddRow(2, strings.Repeat("f", 64)))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "contribution_source_version_hash_mismatch" {
		t.Fatalf("expected same-version hash conflict, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsForgedDeclaredSnapshotHash(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := versionedContributionBody(t, 2)
	body["snapshot_hash"] = strings.Repeat("0", 64)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "contribution_snapshot_hash_mismatch" {
		t.Fatalf("expected forged snapshot hash conflict, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsEmptyNewRevisionAdvancesWatermark(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"] = []any{}
	hash, err := contributionSnapshotContentHash(body)
	if err != nil {
		t.Fatal(err)
	}
	body["source_revision"] = uint64(3)
	body["snapshot_hash"] = hash

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectQuery(`SELECT applied_revision,snapshot_hash FROM people_contribution_scope_versions.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash"}).AddRow(2, strings.Repeat("b", 64)))
	mock.ExpectExec(`(?s)DELETE FROM people_contribution_snapshots.*confirmed_at IS NULL`).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`INSERT INTO people_contribution_scope_versions`).
		WithArgs("CYCLE-202607", "PRJ-1", "aims", "time_entries", uint64(3), hash).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.syncContributions(context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	if float64FromAny(result["synced"]) != 0 || float64FromAny(result["removed"]) != 2 {
		t.Fatalf("unexpected empty replacement result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsEmptyReplaceClearsOnlyLockedScope(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"] = []any{}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)DELETE FROM people_contribution_snapshots.*cycle_code = \?.*project_code = \?.*source_app = \?.*source_biz_type = \?.*confirmed_at IS NULL`).
		WithArgs("CYCLE-202607", "PRJ-1", "aims", "time_entries").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	result, err := adapter.syncContributions(context.Background(), body)
	if err != nil {
		t.Fatalf("syncContributions: %v", err)
	}
	if float64FromAny(result["synced"]) != 0 || float64FromAny(result["removed"]) != 2 {
		t.Fatalf("unexpected empty replacement result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsMissingNaturalSourceIdentity(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()
	body := contributionReplayBody()
	item := body["items"].([]any)[0].(map[string]any)
	delete(item, "source_biz_id")

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_contribution_source_identity" {
		t.Fatalf("expected invalid source identity error, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsClosedCycleBeforeWrite(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*project_code.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("closed", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), contributionReplayBody())
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "performance_cycle_not_collecting" {
		t.Fatalf("expected closed cycle rejection, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsMalformedItemBeforeTransaction(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"] = []any{"not-an-object"}

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "invalid_contribution_item" {
		t.Fatalf("expected invalid contribution item, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsReplaceRequiresExplicitCompleteSnapshot(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	delete(body, "snapshot_complete")

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "incomplete_contribution_snapshot" {
		t.Fatalf("expected incomplete snapshot rejection, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsDuplicateReplaceIdentity(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	item := body["items"].([]any)[0].(map[string]any)
	duplicate := make(map[string]any, len(item))
	for key, value := range item {
		duplicate[key] = value
	}
	body["items"] = []any{item, duplicate}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)INSERT INTO people_contribution_snapshots.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "duplicate_contribution_source_identity" {
		t.Fatalf("expected duplicate identity rejection, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsOversizedSourceIdentityBeforeWrite(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"].([]any)[0].(map[string]any)["source_biz_id"] = strings.Repeat("x", 129)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "invalid_contribution_source_length" {
		t.Fatalf("expected source length rejection, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsItemCycleMismatchBeforeWrite(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"].([]any)[0].(map[string]any)["cycle_code"] = "CYCLE-OTHER"

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "performance_cycle_item_mismatch" {
		t.Fatalf("expected cycle mismatch, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRejectsReplaceSourceMismatch(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	body["items"].([]any)[0].(map[string]any)["source_biz_type"] = "tasks"

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectRollback()

	_, err := adapter.syncContributions(context.Background(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "contribution_replace_scope_mismatch" {
		t.Fatalf("expected source scope mismatch, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsRollsBackWhenDeleteFails(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)INSERT INTO people_contribution_snapshots.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)DELETE FROM people_contribution_snapshots`).
		WillReturnError(errors.New("delete failed"))
	mock.ExpectRollback()

	if _, err := adapter.syncContributions(context.Background(), body); err == nil {
		t.Fatal("expected delete failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncContributionsLegacyUpsertDoesNotDelete(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := contributionReplayBody()
	delete(body, "sync_mode")
	delete(body, "snapshot_complete")

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM people_performance_cycles.*FOR UPDATE`).
		WithArgs("CYCLE-202607").
		WillReturnRows(sqlmock.NewRows([]string{"status", "project_code", "period_start", "period_end"}).
			AddRow("collecting", "PRJ-1", "2026-07-01", "2026-07-31"))
	mock.ExpectExec(`(?s)INSERT INTO people_contribution_snapshots.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.syncContributions(context.Background(), body)
	if err != nil {
		t.Fatalf("legacy sync: %v", err)
	}
	if cleanAnyString(result["sync_mode"]) != "upsert" {
		t.Fatalf("unexpected legacy result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
