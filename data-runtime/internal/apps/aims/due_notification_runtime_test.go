package aims

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAimsDuePhasesUseFrozenAsOfBoundaries(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		stream string
		dueAt  time.Time
		want   string
	}{
		{dueStreamResponse, asOf.Add(4 * time.Hour), "T-4h"},
		{dueStreamResponse, asOf.Add(time.Hour), "T-1h"},
		{dueStreamResolution, asOf, "breached"},
		{dueStreamWorkItem, asOf.AddDate(0, 0, 3), "D3"},
		{dueStreamWorkItem, asOf.AddDate(0, 0, 1), "D1"},
		{dueStreamWorkItem, asOf.AddDate(0, 0, -1), "overdue"},
	}
	for _, test := range tests {
		if got := aimsDuePhase(test.stream, asOf, test.dueAt); got != test.want {
			t.Errorf("aimsDuePhase(%s, %s) = %q, want %q", test.stream, test.dueAt, got, test.want)
		}
	}
}

func TestOpenAimsDueCheckpointStartsFirstConditionGeneration(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	fact := aimsDueFact{
		ID: 7, ProjectID: 3, ProjectCode: "PRJ-3", ProjectName: "Delivery", ItemKey: "PRJ-3-7",
		Title: "Respond", Status: "todo", Priority: "P0", DueAt: asOf.Add(30 * time.Minute),
		AssigneeUID: sql.NullString{String: "u1", Valid: true},
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT condition_generation, state, source_version, event_version`).
		WithArgs(dueStreamResponse, int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"condition_generation", "state", "source_version", "event_version", "phase", "close_reason", "notified_recipient_uid"}))
	mock.ExpectExec(`INSERT IGNORE INTO aims_notification_checkpoint`).
		WithArgs(dueStreamResponse, int64(7), int64(1), "T-1h", sqlmock.AnyArg(), sqlmock.AnyArg(), nil, nil,
			sqlmock.AnyArg(), "aims:work-item:7:response_due:g1", fact.DueAt, "todo", "P0", nil, "u1", nil, nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT state, notification_id, previous_event_version, previous_recipient_uid`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "previous_event_version", "previous_recipient_uid"}).
			AddRow("open", nil, nil, nil))
	mock.ExpectCommit()

	candidate, pending, err := adapter.openDueNotificationCheckpoint(context.Background(), dueStreamResponse, asOf, fact)
	if err != nil {
		t.Fatal(err)
	}
	if !pending || candidate == nil || candidate.ActionableKey != "aims:work-item:7:response_due:g1" {
		t.Fatalf("candidate=%#v pending=%v", candidate, pending)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAimsDueEventIdentityChangesWithDateStatusOrOwner(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	base := aimsDueFact{
		ID: 7, ProjectID: 3, ProjectCode: "PRJ-3", ProjectName: "Delivery", ItemKey: "PRJ-3-7",
		Title: "Respond", Status: "todo", Priority: "P0", DueAt: asOf.Add(30 * time.Minute),
		AssigneeUID: sql.NullString{String: "u1", Valid: true},
	}
	first, ok := buildAimsDueCandidate(dueStreamResponse, asOf, base, 1)
	if !ok {
		t.Fatal("expected candidate")
	}
	second, _ := buildAimsDueCandidate(dueStreamResponse, asOf, base, 1)
	if first.EventVersion != second.EventVersion || first.IdempotencyKey != second.IdempotencyKey {
		t.Fatal("same facts must keep stable event identity")
	}
	variants := []aimsDueFact{base, base, base}
	variants[0].DueAt = base.DueAt.Add(5 * time.Minute)
	variants[1].Status = "in_progress"
	variants[2].AssigneeUID.String = "u2"
	for _, variant := range variants {
		candidate, _ := buildAimsDueCandidate(dueStreamResponse, asOf, variant, 2)
		if candidate.EventVersion == first.EventVersion || candidate.IdempotencyKey == first.IdempotencyKey {
			t.Fatalf("changed source facts reused identity: %#v", candidate)
		}
	}
	if first.ActionableKey != "aims:work-item:7:response_due:g1" {
		t.Fatalf("actionable key = %q", first.ActionableKey)
	}
	nextPhase, _ := buildAimsDueCandidate(dueStreamResponse, asOf.Add(31*time.Minute), base, 1)
	if nextPhase.ActionableKey != first.ActionableKey || nextPhase.EventVersion == first.EventVersion {
		t.Fatalf("phase transition must keep condition key and advance version: first=%#v next=%#v", first, nextPhase)
	}
	nextGeneration, _ := buildAimsDueCandidate(dueStreamResponse, asOf, base, 2)
	if nextGeneration.ActionableKey == first.ActionableKey || nextGeneration.EventVersion == first.EventVersion {
		t.Fatalf("new condition generation reused terminal identity: %#v", nextGeneration)
	}
}

func TestAimsDueCursorRoundTripIsDueAtAndIDOnly(t *testing.T) {
	dueAt := time.Date(2026, 7, 10, 16, 0, 0, 0, time.UTC)
	raw, err := encodeAimsDueCursor(dueAt, 42)
	if err != nil {
		t.Fatal(err)
	}
	cursor, err := decodeAimsDueCursor(raw)
	if err != nil {
		t.Fatal(err)
	}
	if cursor.ID != 42 || cursor.DueAt != dueAt.Format(time.RFC3339) {
		t.Fatalf("cursor = %#v", cursor)
	}
}

func TestEligibleAimsDueAssigneeRequiresLeaderOrActiveProjectMembership(t *testing.T) {
	base := aimsDueFact{
		AssigneeUID:      sql.NullString{String: "assignee", Valid: true},
		ProjectLeaderUID: sql.NullString{String: "leader", Valid: true},
	}
	if got := eligibleAimsDueAssignee(base); got.Valid {
		t.Fatalf("non-member assignee remained eligible: %#v", got)
	}
	activeMember := base
	activeMember.AssigneeIsActiveProjectMember = true
	if got := eligibleAimsDueAssignee(activeMember); !got.Valid || got.String != "assignee" {
		t.Fatalf("active project member was removed: %#v", got)
	}
	leader := base
	leader.AssigneeUID.String = "leader"
	if got := eligibleAimsDueAssignee(leader); !got.Valid || got.String != "leader" {
		t.Fatalf("project leader assignee was removed: %#v", got)
	}
}

func TestAimsDueQueryProvesActiveAssigneeMembership(t *testing.T) {
	content, err := os.ReadFile("due_notification_runtime.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, expected := range []string{
		"EXISTS (SELECT 1 FROM aims_project_members due_pm",
		"due_pm.project_id=wi.project_id",
		"due_pm.uid=wi.assignee_uid",
		"due_pm.status='active'",
		"fact.AssigneeUID = eligibleAimsDueAssignee(fact)",
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("due candidate query is missing %q", expected)
		}
	}
}
