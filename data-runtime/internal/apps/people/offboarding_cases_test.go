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

func TestParseOffboardingCreateInputIsExactAndStable(t *testing.T) {
	input, err := parseOffboardingCreateInput(map[string]any{
		"leaveAssignmentCode": "ASN-LEAVE-1",
		"handover": map[string]any{
			"responsibleUid": "owner-1",
			"dueAt":          "2026-07-20T12:30:00.987Z",
		},
		"assetRecoveryCoordination": map[string]any{
			"responsibleUid": "asset-coordinator",
			"dueAt":          "2026-07-18T08:00:00Z",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Handover.DueAt.Nanosecond() != 0 {
		t.Fatalf("DATETIME input must be normalized to seconds: %v", input.Handover.DueAt)
	}
	if stableOffboardingCaseCode(input.LeaveAssignmentCode) != stableOffboardingCaseCode(input.LeaveAssignmentCode) {
		t.Fatal("generated case code is unstable")
	}
	if stableOffboardingTaskCode("OBC-1", offboardingTaskHandover) == stableOffboardingTaskCode("OBC-1", offboardingTaskAssetRecovery) {
		t.Fatal("task types must have distinct stable codes")
	}

	bad := map[string]any{
		"leaveAssignmentCode": "ASN-LEAVE-1",
		"handover":            map[string]any{"responsibleUid": "owner-1\n", "dueAt": "2026-07-20T12:30:00Z"},
	}
	if _, err := parseOffboardingCreateInput(bad); err == nil {
		t.Fatal("control characters in responsibleUid were accepted")
	}
	bad["handover"] = map[string]any{"responsibleUid": "@all", "dueAt": "2026-07-20T12:30:00Z"}
	if _, err := parseOffboardingCreateInput(bad); err == nil {
		t.Fatal("@all responsible was accepted")
	}
	bad["handover"] = map[string]any{"responsibleUid": "owner-1", "dueAt": "2026-07-20T12:30:00Z", "extra": true}
	if _, err := parseOffboardingCreateInput(bad); err == nil {
		t.Fatal("extra task input field was accepted")
	}
}

func TestOffboardingRuntimeUsesExactResourceScopes(t *testing.T) {
	adapter, _, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	for _, tc := range []struct {
		name   string
		method string
		path   string
		scope  string
	}{
		{"create", http.MethodPost, "/v1/people/offboarding-cases", "people.write"},
		{"list", http.MethodGet, "/v1/people/offboarding-cases", "people.read"},
		{"confirm", http.MethodPost, "/v1/people/offboarding-tasks/OBT-1:confirm", "people:offboarding_tasks:view"},
		{"cancel", http.MethodPost, "/v1/people/offboarding-tasks/OBT-1:cancel", "people:offboarding_tasks:admin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{"current_user": {"actor-1"}, "current_user_scopes": {tc.scope}}
			_, _, handled, err := adapter.handleOffboardingRuntime(context.Background(), tc.method, tc.path, query, map[string]any{})
			if !handled || err == nil {
				t.Fatalf("scope %q unexpectedly passed route %s", tc.scope, tc.path)
			}
		})
	}
	if !peopleRuntimeHasScope(url.Values{"current_user_scopes": {"people:offboarding_tasks:view people:offboarding_tasks:admin"}}, "people:offboarding_tasks:admin") {
		t.Fatal("exact admin scope was not recognized")
	}
}

func TestCreateOffboardingCaseWritesCaseAndTasksAtomically(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	caseCode := stableOffboardingCaseCode("ASN-LEAVE-1")
	taskCode := stableOffboardingTaskCode(caseCode, offboardingTaskHandover)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_assignments.*change_type='leave'.*approval_status IN \('none','approved'\).*FOR UPDATE`).
		WithArgs("ASN-LEAVE-1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid"}).AddRow("leaving-user"))
	mock.ExpectQuery(`(?s)SELECT id,case_code,leave_assignment_code.*FROM people_offboarding_cases.*leave_assignment_code=\? OR case_code=\?.*FOR UPDATE`).
		WithArgs("ASN-LEAVE-1", caseCode).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO people_offboarding_cases.*VALUES \(\?, \?, \?, 'active', 1, \?, \?\)`).
		WithArgs(caseCode, "ASN-LEAVE-1", "leaving-user", "hr-admin", "hr-admin").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO people_offboarding_tasks.*VALUES \(\?, \?, \?, \?, \?, 'pending', 1, \?, \?\)`).
		WithArgs(taskCode, caseCode, offboardingTaskHandover, "handover-owner", due, "hr-admin", "hr-admin").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id,case_code,leave_assignment_code.*FROM people_offboarding_cases.*WHERE case_code=\?`).
		WithArgs(caseCode).
		WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "leave_assignment_code", "employee_uid", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
			AddRow(int64(1), caseCode, "ASN-LEAVE-1", "leaving-user", "active", int64(1), nil, nil, nil, nil, nil, now, now))
	mock.ExpectQuery(`(?s)SELECT id,task_code,case_code.*FROM people_offboarding_tasks WHERE case_code=\?.*ORDER BY id ASC`).
		WithArgs(caseCode).
		WillReturnRows(sqlmock.NewRows([]string{"id", "task_code", "case_code", "task_type", "responsible_uid", "due_at", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
			AddRow(int64(10), taskCode, caseCode, offboardingTaskHandover, "handover-owner", due, "pending", int64(1), nil, nil, nil, nil, nil, now, now))
	mock.ExpectCommit()

	result, err := adapter.createOffboardingCase(context.Background(), url.Values{"current_user": {"hr-admin"}}, map[string]any{
		"leaveAssignmentCode": "ASN-LEAVE-1",
		"handover":            map[string]any{"responsibleUid": "handover-owner", "dueAt": due.Format(time.RFC3339)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["idempotent"] != false || result["case"].(map[string]any)["objectVersion"] != "v1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateOffboardingCaseRejectsLeavingEmployeeAsResponsible(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_assignments`).WithArgs("ASN-LEAVE-1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid"}).AddRow("leaving-user"))
	mock.ExpectRollback()
	_, err := adapter.createOffboardingCase(context.Background(), url.Values{"current_user": {"hr-admin"}}, map[string]any{
		"leaveAssignmentCode": "ASN-LEAVE-1",
		"handover":            map[string]any{"responsibleUid": "leaving-user", "dueAt": "2026-07-20T12:00:00Z"},
	})
	if err == nil {
		t.Fatal("leaving employee was accepted as task responsible")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateOffboardingCaseReusesExactPayloadAndRejectsMismatch(t *testing.T) {
	for _, tc := range []struct {
		name        string
		storedOwner string
		wantReuse   bool
	}{
		{name: "exact replay", storedOwner: "handover-owner", wantReuse: true},
		{name: "payload mismatch", storedOwner: "different-owner", wantReuse: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
			defer closeDB()
			now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
			due := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
			caseCode := stableOffboardingCaseCode("ASN-LEAVE-1")
			taskCode := stableOffboardingTaskCode(caseCode, offboardingTaskHandover)
			mock.ExpectBegin()
			mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_assignments`).WithArgs("ASN-LEAVE-1").
				WillReturnRows(sqlmock.NewRows([]string{"employee_uid"}).AddRow("leaving-user"))
			mock.ExpectQuery(`(?s)SELECT id,case_code,leave_assignment_code.*FROM people_offboarding_cases.*FOR UPDATE`).
				WithArgs("ASN-LEAVE-1", caseCode).
				WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "leave_assignment_code", "employee_uid", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
					AddRow(int64(1), caseCode, "ASN-LEAVE-1", "leaving-user", "active", int64(1), nil, nil, nil, nil, nil, now, now))
			mock.ExpectQuery(`(?s)SELECT id,task_code,case_code.*FROM people_offboarding_tasks.*FOR UPDATE`).WithArgs(caseCode).
				WillReturnRows(sqlmock.NewRows([]string{"id", "task_code", "case_code", "task_type", "responsible_uid", "due_at", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
					AddRow(int64(10), taskCode, caseCode, offboardingTaskHandover, tc.storedOwner, due, "pending", int64(1), nil, nil, nil, nil, nil, now, now))
			if tc.wantReuse {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			result, err := adapter.createOffboardingCase(context.Background(), url.Values{"current_user": {"hr-admin"}}, map[string]any{
				"leaveAssignmentCode": "ASN-LEAVE-1",
				"handover":            map[string]any{"responsibleUid": "handover-owner", "dueAt": due.Format(time.RFC3339)},
			})
			if tc.wantReuse {
				if err != nil || result["idempotent"] != true {
					t.Fatalf("result=%#v err=%v", result, err)
				}
			} else if err == nil {
				t.Fatal("different payload was idempotently reused")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConfirmOffboardingTaskAtomicallyAdvancesTaskAndCase(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	completed := now.Add(time.Minute)
	columns := []string{"task_id", "task_code", "task_case_code", "task_type", "responsible_uid", "due_at", "task_status", "task_object_version", "task_completed_at", "task_completed_by", "task_cancelled_at", "task_cancelled_by", "task_cancellation_reason", "task_created_at", "task_updated_at", "case_id", "case_code", "leave_assignment_code", "employee_uid", "case_status", "case_object_version", "case_completed_at", "case_completed_by", "case_cancelled_at", "case_cancelled_by", "case_cancellation_reason", "case_created_at", "case_updated_at"}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM people_offboarding_tasks t JOIN people_offboarding_cases c.*WHERE t.task_code=\?.*FOR UPDATE`).
		WithArgs("OBT-1").
		WillReturnRows(sqlmock.NewRows(columns).AddRow(int64(10), "OBT-1", "OBC-1", offboardingTaskHandover, "owner-1", due, "pending", int64(1), nil, nil, nil, nil, nil, now, now, int64(1), "OBC-1", "ASN-1", "leaving-user", "active", int64(1), nil, nil, nil, nil, nil, now, now))
	mock.ExpectExec(`(?s)UPDATE people_offboarding_tasks.*status='completed'.*object_version=object_version\+1`).
		WithArgs("owner-1", "owner-1", int64(10), int64(1)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT SUM\(status='pending'\),SUM\(status='cancelled'\)`).WithArgs("OBC-1").
		WillReturnRows(sqlmock.NewRows([]string{"pending", "cancelled"}).AddRow(0, 0))
	mock.ExpectExec(`(?s)UPDATE people_offboarding_cases SET status='completed'.*object_version=object_version\+1`).
		WithArgs("owner-1", "owner-1", int64(1)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT id,case_code,leave_assignment_code.*WHERE case_code=\?`).WithArgs("OBC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "leave_assignment_code", "employee_uid", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
			AddRow(int64(1), "OBC-1", "ASN-1", "leaving-user", "completed", int64(2), completed, "owner-1", nil, nil, nil, now, completed))
	mock.ExpectQuery(`(?s)SELECT id,task_code,case_code.*WHERE case_code=\?`).WithArgs("OBC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "task_code", "case_code", "task_type", "responsible_uid", "due_at", "status", "object_version", "completed_at", "completed_by", "cancelled_at", "cancelled_by", "cancellation_reason", "created_at", "updated_at"}).
			AddRow(int64(10), "OBT-1", "OBC-1", offboardingTaskHandover, "owner-1", due, "completed", int64(2), completed, "owner-1", nil, nil, nil, now, completed))
	mock.ExpectCommit()

	result, err := adapter.transitionOffboardingTask(context.Background(), "OBT-1", "confirm", url.Values{"current_user": {"owner-1"}}, map[string]any{"expectedVersion": "v1"})
	if err != nil {
		t.Fatal(err)
	}
	if result["task"].(map[string]any)["objectVersion"] != "v2" || result["case"].(map[string]any)["status"] != "completed" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelOffboardingTaskReplayRequiresSameReason(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	columns := []string{"task_id", "task_code", "task_case_code", "task_type", "responsible_uid", "due_at", "task_status", "task_object_version", "task_completed_at", "task_completed_by", "task_cancelled_at", "task_cancelled_by", "task_cancellation_reason", "task_created_at", "task_updated_at", "case_id", "case_code", "leave_assignment_code", "employee_uid", "case_status", "case_object_version", "case_completed_at", "case_completed_by", "case_cancelled_at", "case_cancelled_by", "case_cancellation_reason", "case_created_at", "case_updated_at"}
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM people_offboarding_tasks t JOIN people_offboarding_cases c.*WHERE t.task_code=\?.*FOR UPDATE`).
		WithArgs("OBT-1").
		WillReturnRows(sqlmock.NewRows(columns).AddRow(int64(10), "OBT-1", "OBC-1", offboardingTaskHandover, "owner-1", due, "cancelled", int64(2), nil, nil, now, "specialist-1", "original reason", now, now, int64(1), "OBC-1", "ASN-1", "leaving-user", "cancelled", int64(2), nil, nil, now, "specialist-1", "original reason", now, now))
	mock.ExpectRollback()
	_, err := adapter.transitionOffboardingTask(context.Background(), "OBT-1", "cancel", url.Values{"current_user": {"specialist-2"}}, map[string]any{"expectedVersion": "v1", "reason": "different reason"})
	if err == nil {
		t.Fatal("cancellation replay with a different reason was accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOffboardingObjectVersionParserRejectsNonCanonicalValues(t *testing.T) {
	for _, value := range []string{"", "1", "v0", "v01", "v-1", "v1 "} {
		if _, err := parseOffboardingObjectVersion(value); err == nil {
			t.Fatalf("invalid expectedVersion %q accepted", value)
		}
	}
}

func TestOffboardingListLimitIsStrict(t *testing.T) {
	for value, want := range map[string]int{"": 50, "1": 1, "100": 100} {
		got, err := parseOffboardingListLimit(value)
		if err != nil || got != want {
			t.Fatalf("limit %q got=%d err=%v want=%d", value, got, err, want)
		}
	}
	for _, value := range []string{"0", "-1", "101", "abc", "01", " 5"} {
		if _, err := parseOffboardingListLimit(value); err == nil {
			t.Fatalf("invalid limit %q accepted", value)
		}
	}
}
