package directory

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestConsolePeopleLifecycleCommitsReceiptProjectionOutboxAndAuditAtomically(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")
	body := consoleLifecycleTestBody(t, "people", ConsoleLifecycleEmployment)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "operation_id", "required_capability", "command_schema_version",
			"command_sha256", "status", "target_biz_type", "target_biz_code",
			"response_http_status", "response_summary_sha256", "version_no",
		}))
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT IGNORE INTO directory_lifecycle_scope_versions`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT applied_revision,snapshot_hash.*directory_lifecycle_scope_versions.*FOR UPDATE`).
		WithArgs("employee-1").
		WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash"}).
			AddRow(0, strings.Repeat("0", 64)))
	mock.ExpectExec(`(?s)INSERT INTO directory_users`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE directory_user_departments`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)INSERT INTO directory_subject_exports`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO integration_operation.*next_attempt_at.*'pending',UTC_TIMESTAMP\(3\)`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE directory_lifecycle_scope_versions`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*status = 'succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ConsoleApplyPeopleLifecycle(
		context.Background(),
		"employee-1",
		ConsoleLifecycleEmployment,
		"tenant-1-console",
		body,
	)
	if err != nil {
		t.Fatalf("ConsoleApplyPeopleLifecycle: %v", err)
	}
	data, _ := result["result"].(map[string]any)
	if result["receiptStatus"] != "succeeded" || result["idempotent"] != false ||
		data["platformStatus"] != "pending" {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsolePeopleLifecycleRejectsUntrustedSourceBeforeDatabase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")
	body := consoleLifecycleTestBody(t, "aims", ConsoleLifecycleEmployment)

	_, err = adapter.ConsoleApplyPeopleLifecycle(
		context.Background(),
		"employee-1",
		ConsoleLifecycleEmployment,
		"tenant-1-console",
		body,
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "service_command_source_forbidden" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleEmploymentLifecycleCreatesDingTalkIdentityAfterDirectoryUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO directory_users`).
		WithArgs("employee-1", nil, "张三", "张三", "zhangsan@example.com", "13800001234", "1234", nil, "", "employee-1", "provided", "provided", "provided").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT uid FROM directory_identities`).
		WithArgs("dingtalk", "ding-user-1").
		WillReturnRows(sqlmock.NewRows([]string{"uid"}))
	mock.ExpectExec(`INSERT INTO directory_identities`).
		WithArgs("employee-1", "dingtalk", "ding-user-1", "", "zhangsan@example.com", "1234", "provided", "provided").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE directory_departments departments`).
		WithArgs("employee-1", "ding-user-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE directory_user_departments`).
		WithArgs("employee-1", "", "").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	err = applyConsoleEmploymentTx(context.Background(), tx, "employee-1", map[string]any{
		"displayName": "张三", "email": "zhangsan@example.com", "mobile": "13800001234",
		"identityProvider": "dingtalk", "identitySubject": "ding-user-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleLifecycleFieldStateRequiresAnExplicitEmptyBeforeClearing(t *testing.T) {
	for _, test := range []struct {
		state any
		value any
		want  string
	}{
		{"absent", "", "absent"},
		{"empty", "", "empty"},
		{"provided", "13800000000", "provided"},
		{"", "13800000000", "provided"},
		{"", "", "absent"},
	} {
		if got := consoleLifecycleFieldState(test.state, test.value); got != test.want {
			t.Fatalf("state=%v value=%v got=%q want=%q", test.state, test.value, got, test.want)
		}
	}
}

func TestConsoleEmploymentLifecycleMobileTailFollowsSourcePresence(t *testing.T) {
	for _, test := range []struct {
		name, state, mobile, tail, expectedState string
	}{
		{"provided replaces mobile and tail", "provided", "13800001234", "1234", "provided"},
		{"explicit empty clears mobile and tail", "empty", "", "", "empty"},
		{"absent preserves mobile and tail", "absent", "", "", "absent"},
		{"legacy empty preserves mobile and tail", "", "", "", "absent"},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectExec(`(?s)INSERT INTO directory_users.*mobile,mobile_tail4.*mobile=CASE WHEN \?='absent' THEN mobile ELSE VALUES\(mobile\) END,\s+mobile_tail4=CASE WHEN \?='absent' THEN mobile_tail4 ELSE VALUES\(mobile_tail4\) END`).
				WithArgs("employee-1", nil, "张三", "张三", "", test.mobile, test.tail, nil, "", "employee-1", "absent", test.expectedState, test.expectedState).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`UPDATE directory_user_departments`).
				WithArgs("employee-1", "", "").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectRollback()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			err = applyConsoleEmploymentTx(context.Background(), tx, "employee-1", map[string]any{
				"displayName": "张三", "mobile": test.mobile, "mobileSourceState": test.state,
			})
			if err != nil {
				t.Fatal(err)
			}
			_ = tx.Rollback()
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConsoleEmploymentLifecycleRetiresEveryOtherFormalPrimaryMembership(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO directory_users`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE directory_user_departments memberships.*departments.org_type='department'.*memberships.source_provider='people' OR memberships.is_primary=1.*memberships.dept_code<>\?`).
		WithArgs("employee-1", "DPT-RD", "DPT-RD").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_departments`).
		WithArgs("DPT-RD").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery(`SELECT status,org_type FROM directory_departments`).
		WithArgs("DPT-RD").
		WillReturnRows(sqlmock.NewRows([]string{"status", "org_type"}).AddRow("active", "department"))
	mock.ExpectExec(`INSERT INTO directory_user_departments`).
		WithArgs("employee-1", "DPT-RD", "employee-1:DPT-RD:member").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectRollback()

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	err = applyConsoleEmploymentTx(context.Background(), tx, "employee-1", map[string]any{
		"displayName": "张三",
		"deptCode":    "DPT-RD",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleLifecycleReceiptErrorsExposeOnlyStableSafeCategories(t *testing.T) {
	tests := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{integrationoperation.ErrInvalidOperationID, http.StatusBadRequest, "service_command_operation_id_invalid"},
		{integrationoperation.ErrInvalidIdentity, http.StatusForbidden, "service_command_identity_invalid"},
		{integrationoperation.ErrUnsafePersistenceContent, http.StatusUnprocessableEntity, "service_command_payload_unsafe"},
		{integrationoperation.ErrIdempotencyPayloadMismatch, http.StatusConflict, "idempotency_payload_mismatch"},
	}
	for _, tt := range tests {
		var httpErr httperror.Error
		if !errors.As(consoleLifecycleReceiptError(tt.err), &httpErr) {
			t.Fatalf("%v was not mapped to an HTTP error", tt.err)
		}
		if httpErr.Status != tt.wantStatus || httpErr.Code != tt.wantCode {
			t.Fatalf("%v mapped to status=%d code=%q", tt.err, httpErr.Status, httpErr.Code)
		}
	}
}

func consoleLifecycleTestBody(
	t *testing.T,
	sourceApp string,
	kind ConsoleLifecycleKind,
) map[string]any {
	t.Helper()
	contract, err := consoleLifecycleContractFor(kind)
	if err != nil {
		t.Fatal(err)
	}
	command := map[string]any{
		"employeeUid": "employee-1", "displayName": "Employee One",
		"deptCode": "", "sourceRevision": float64(7),
		"snapshotHash":     "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"originalActorUid": "hr-1",
	}
	commandHash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		integrationoperation.TrustedRequestIDKey:                      "request-1",
		integrationoperation.TrustedServiceCommandTenantKey:           "tenant-1",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "people-prod",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "console-prod",
		integrationoperation.TrustedServiceCommandSourceAppKey:        sourceApp,
		integrationoperation.TrustedServiceCommandTargetAppKey:        "console",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "people.runtime",
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"operationId": "550e8400-e29b-41d4-a716-446655440000",
			"targetApp":   "console", "operationCode": contract.operationCode,
			"requiredCapability":   contract.capability,
			"idempotencyKey":       "people:directory:employee-1:r7",
			"commandSchemaVersion": "v1", "commandSha256": commandHash,
			"command": command,
		},
	}
}
