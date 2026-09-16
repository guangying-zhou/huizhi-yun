package people

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestOffboardingDuePhaseCursorAndCandidateContract(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		due   time.Time
		phase string
	}{{asOf, "expired"}, {asOf.Add(24 * time.Hour), "D1"}, {asOf.Add(7 * 24 * time.Hour), "D7"}, {asOf.Add(30 * 24 * time.Hour), "D30"}, {asOf.Add(31 * 24 * time.Hour), ""}} {
		if got := offboardingDuePhase(asOf, tc.due); got != tc.phase {
			t.Fatalf("phase for %v got %q want %q", tc.due, got, tc.phase)
		}
	}
	encoded, err := encodeOffboardingDueCursor(asOf, 42)
	if err != nil {
		t.Fatal(err)
	}
	cursor, err := decodeOffboardingDueCursor(encoded)
	if err != nil || cursor.ID != 42 || cursor.DueAt != asOf.Format(time.RFC3339) {
		t.Fatalf("cursor=%#v err=%v", cursor, err)
	}
	if _, err := decodeOffboardingDueCursor("bad"); err == nil {
		t.Fatal("invalid cursor accepted")
	}

	fact := offboardingDueFact{ID: 9, TaskCode: "OBT-9", CaseCode: "OBC-9", TaskType: offboardingTaskHandover, ResponsibleUID: "owner-9", DueAt: asOf.Add(7 * 24 * time.Hour)}
	d30 := buildOffboardingDueCandidate(offboardingHandoverDueStream, "D30", fact, 2)
	d7 := buildOffboardingDueCandidate(offboardingHandoverDueStream, "D7", fact, 2)
	if d30.SourceType != "offboarding_task" || d30.SourceCode != d30.TaskCode || d30.CaseCode != "OBC-9" || d30.TaskType != offboardingTaskHandover {
		t.Fatalf("candidate extension contract: %#v", d30)
	}
	if len(d30.RecipientCandidates) != 1 || d30.RecipientCandidates[0] != "owner-9" {
		t.Fatalf("candidate must use direct responsible only: %#v", d30.RecipientCandidates)
	}
	if d30.ActionableKey != d7.ActionableKey || d30.EventVersion == d7.EventVersion || d30.IdempotencyKey == d7.IdempotencyKey {
		t.Fatalf("phase identity contract d30=%#v d7=%#v", d30, d7)
	}
	if len(d30.IdempotencyKey) > 191 || len(d30.ActionableKey) > 191 {
		t.Fatal("candidate identity exceeds persistence boundary")
	}
}

func TestQueryOffboardingDueFactsUsesPendingDirectResponsibleOnly(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	due := asOf.Add(6 * 24 * time.Hour)
	mock.ExpectQuery(`(?s)FROM people_offboarding_tasks t.*JOIN people_offboarding_cases c.*t.task_type=\?.*t.status='pending'.*c.status='active'.*ORDER BY t.due_at ASC,t.id ASC`).
		WithArgs(offboardingTaskHandover, asOf.AddDate(0, 0, 30), 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "task_code", "case_code", "task_type", "responsible_uid", "due_at"}).
			AddRow(int64(1), "OBT-1", "OBC-1", offboardingTaskHandover, "owner-1", due).
			AddRow(int64(2), "OBT-2", "OBC-2", offboardingTaskHandover, "@all", due))
	facts, err := adapter.queryOffboardingDueFacts(context.Background(), offboardingHandoverDueStream, asOf, nil, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[0].ResponsibleUID != "owner-1" {
		t.Fatalf("unexpected direct facts: %#v", facts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenOffboardingCheckpointPersistsStableDirectCandidate(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	fact := offboardingDueFact{ID: 7, TaskCode: "OBT-7", CaseCode: "OBC-7", TaskType: offboardingTaskHandover, ResponsibleUID: "owner-7", DueAt: asOf.Add(6 * 24 * time.Hour)}
	want := buildOffboardingDueCandidate(offboardingHandoverDueStream, "D7", fact, 1)
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT condition_generation,state,source_version,event_version,phase.*FROM people_offboarding_notification_checkpoint.*FOR UPDATE`).
		WithArgs(offboardingHandoverDueStream, int64(7)).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT IGNORE INTO people_offboarding_notification_checkpoint.*VALUES \(\?,'offboarding_task',.*'open'\)`).
		WithArgs(offboardingHandoverDueStream, int64(7), int64(1), "D7", offboardingDueSourceVersion(offboardingHandoverDueStream, fact), want.EventVersion,
			nil, nil, want.IdempotencyKey, want.ActionableKey, fact.DueAt, "OBC-7", "OBT-7", offboardingTaskHandover, "Offboarding handover", `["owner-7"]`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT state,notification_id,previous_event_version,previous_recipient_uid`).WithArgs(want.EventVersion).
		WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "previous_event_version", "previous_recipient_uid"}).AddRow("open", nil, nil, nil))
	mock.ExpectCommit()
	candidate, pending, err := adapter.openOffboardingDueCheckpoint(context.Background(), offboardingHandoverDueStream, asOf, fact)
	if err != nil || !pending || candidate.EventVersion != want.EventVersion || candidate.ActionableKey != want.ActionableKey {
		t.Fatalf("candidate=%#v pending=%v err=%v", candidate, pending, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAcknowledgeOffboardingNotificationRecoversAckLossAndRejectsOutsider(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE people_offboarding_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-1", "owner-1", "v1:event", "owner-1", "notice-1", "owner-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event").
		WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "notified_recipient_uid"}).AddRow("open", "notice-1", "owner-1"))
	result, err := adapter.acknowledgeOffboardingDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner-1"})
	if err != nil || result["idempotent"] != true {
		t.Fatalf("ack recovery result=%#v err=%v", result, err)
	}
	mock.ExpectExec(`(?s)UPDATE people_offboarding_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-2", "outsider", "v1:event-2", "outsider", "notice-2", "outsider").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event-2").WillReturnError(sql.ErrNoRows)
	if _, err := adapter.acknowledgeOffboardingDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event-2", "notificationId": "notice-2", "recipientUid": "outsider"}); err == nil {
		t.Fatal("recipient outside checkpoint evidence was accepted")
	}
}

func TestPendingOffboardingClosureKeepsExactTaskTrace(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT cp.event_version,delivered.event_version.*cp.case_code,cp.task_code,cp.task_type.*FROM people_offboarding_notification_checkpoint`).
		WithArgs(offboardingHandoverDueStream, 100).
		WillReturnRows(sqlmock.NewRows([]string{"event_version", "expected_version", "actionable_key", "source_type", "source_id", "case_code", "task_code", "task_type", "recipient_uid", "close_reason"}).
			AddRow("v1:closed", "v1:delivered", "people:task:1", "offboarding_task", int64(1), "OBC-1", "OBT-1", offboardingTaskHandover, "owner-1", "condition_resolved"))
	items, err := adapter.pendingOffboardingDueClosures(context.Background(), offboardingHandoverDueStream, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].CaseCode != "OBC-1" || items[0].TaskCode != "OBT-1" || items[0].TaskType != offboardingTaskHandover || items[0].State != "resolved" {
		t.Fatalf("closure trace contract: %#v", items)
	}
}

func TestOffboardingNotificationDetailAuthorizationIsCurrentDirectPendingOnly(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{"current_user": {"owner-1"}, "hzy_runtime_actor_purpose": {offboardingNotificationDetailActorPurpose}}
	mock.ExpectQuery(`(?s)SELECT t.id,CASE WHEN t.status='pending'.*c.status='active'.*t.responsible_uid=\?.*WHERE t.task_code=\?`).
		WithArgs("owner-1", "OBT-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(1), 1))
	result, operation, handled, err := adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/people/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "offboarding_task", "id": "OBT-1"}})
	if err != nil || !handled || operation != "people.notification_details.authorize" {
		t.Fatalf("handled=%v operation=%q err=%v", handled, operation, err)
	}
	response := result.(map[string]any)
	if response["authorized"] != true || response["reasonCode"] != "allowed" || response["resource"] != "offboarding_task" || response["id"] != "OBT-1" {
		t.Fatalf("unexpected response: %#v", response)
	}

	mock.ExpectQuery(`(?s)SELECT t.id,CASE WHEN.*WHERE t.task_code=\?`).WithArgs("owner-1", "OBT-MISSING").WillReturnError(sql.ErrNoRows)
	result, _, _, err = adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/people/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "offboarding_task", "id": "OBT-MISSING"}})
	if err != nil || result.(map[string]any)["reasonCode"] != "not_found" {
		t.Fatalf("not-found response=%#v err=%v", result, err)
	}

	adminQuery := url.Values{"current_user": {"admin-1"}, "current_user_scopes": {"people:offboarding_tasks:admin"}, "hzy_runtime_actor_purpose": {offboardingNotificationDetailActorPurpose}}
	mock.ExpectQuery(`(?s)SELECT t.id,CASE WHEN.*WHERE t.task_code=\?`).WithArgs("admin-1", "OBT-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(1), 0))
	result, _, _, err = adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/people/notification-details/authorize", adminQuery, map[string]any{"descriptor": map[string]any{"resource": "offboarding_task", "id": "OBT-1"}})
	if err != nil || result.(map[string]any)["reasonCode"] != "not_authorized" {
		t.Fatalf("admin fallback must be denied: response=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOffboardingNotificationDetailAuthorizationRejectsUntrustedOrInexactDescriptor(t *testing.T) {
	adapter, _, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	_, _, handled, err := adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/people/notification-details/authorize", url.Values{"current_user": {"owner-1"}},
		map[string]any{"descriptor": map[string]any{"resource": "offboarding_task", "id": "OBT-1"}})
	if !handled || err == nil {
		t.Fatal("missing purpose was accepted")
	}
	_, _, _, err = adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/people/notification-details/authorize",
		url.Values{"current_user": {"owner-1"}, "hzy_runtime_actor_purpose": {offboardingNotificationDetailActorPurpose}},
		map[string]any{"descriptor": map[string]any{"resource": "offboarding_task", "id": "OBT-1", "extra": true}})
	if err == nil {
		t.Fatal("descriptor with extra fields was accepted")
	}
}
