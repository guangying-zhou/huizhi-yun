package people

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestPeopleLifecycleContentActiveLeftActive(t *testing.T) {
	active := peopleLifecycleFact{EmployeeUID: "u1", EmploymentStatus: "active", DeptCode: "A"}
	content, code, capability := peopleLifecycleContent(active)
	if content["lifecycleType"] != "employment" || code != peopleDirectoryEmploymentOperation || capability != peopleDirectoryEmploymentCapability {
		t.Fatalf("active lifecycle = %#v %s %s", content, code, capability)
	}
	left := active
	left.EmploymentStatus = "left"
	content, code, _ = peopleLifecycleContent(left)
	if content["lifecycleType"] != "offboarding" || code != peopleDirectoryOffboardingOperation {
		t.Fatalf("left lifecycle = %#v %s", content, code)
	}
	active.EmploymentStatus = "active"
	content, code, _ = peopleLifecycleContent(active)
	if content["lifecycleType"] != "employment" || code != peopleDirectoryEmploymentOperation {
		t.Fatalf("reactivated lifecycle = %#v %s", content, code)
	}
}

func TestPeopleLifecycleOperationAllowlistSeparatesConsumers(t *testing.T) {
	if !validPeopleIntegrationOperation("console", peopleDirectoryEmploymentOperation, peopleDirectoryEmploymentCapability) {
		t.Fatal("directory employment operation must be allowlisted")
	}
	if validPeopleIntegrationOperation("assets", peopleDirectoryEmploymentOperation, peopleAssetsOffboardingCapability) {
		t.Fatal("assets consumer identity must not match directory lifecycle")
	}
}

func TestDirectoryLifecycleFamilyClaimRecoversExpiredProcessingAttempt(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	operationID := "550e8400-e29b-41d4-a716-446655440000"
	operationKey := "people:directory-lifecycle:employee-u1:r2"
	command := map[string]any{"lifecycleType": "offboarding", "employeeUid": "u1", "sourceRevision": 2}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}

	// 选择器现在与 claim 使用同一套依赖门（避免队头被永久阻塞的操作卡死）。
	mock.ExpectQuery(`(?s)SELECT o.operation_key.*status='processing'.*locked_until<=UTC_TIMESTAMP\(3\).*depends_on_operation_key IS NULL.*dependency.status='succeeded'`).
		WithArgs("tenant-1", "people-deployment", peopleDirectoryEmploymentOperation, peopleDirectoryOffboardingOperation).
		WillReturnRows(sqlmock.NewRows([]string{"operation_key"}).AddRow(operationKey))
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt attempt.*operation\.operation_key = \?.*attempt\.result_status = 'processing'`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "tenant-1", "people-deployment", "people", operationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*operation_key = \?.*status = 'processing'`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "tenant-1", "people-deployment", "people", operationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation o.*o\.operation_key = \?.*FOR UPDATE SKIP LOCKED`).
		WithArgs("tenant-1", "people-deployment", "people", sqlmock.AnyArg(), operationKey).
		WillReturnRows(sqlmock.NewRows([]string{
			"operation_id", "operation_key", "correlation_key", "sequence_no", "depends_on_operation_key",
			"tenant_code", "deployment_code", "source_app", "target_app", "operation_code", "required_capability",
			"source_biz_type", "source_biz_code", "target_biz_type", "target_biz_code", "idempotency_key",
			"command_schema_version", "command_json", "command_sha256", "status", "attempt_count", "max_attempts",
			"fencing_token", "version_no", "original_request_id", "correlation_id", "original_actor_uid",
			"service_client_id", "replay_count", "created_at",
		}).AddRow(
			operationID, operationKey, "people:directory-lifecycle:u1", 1, nil,
			"tenant-1", "people-deployment", "people", "console", peopleDirectoryOffboardingOperation, peopleDirectoryOffboardingCapability,
			"employee", "u1", nil, nil, operationKey, "v1", `{"employeeUid":"u1","lifecycleType":"offboarding","sourceRevision":2}`, commandSHA,
			"partial_unknown", 1, 8, 7, 4, "request-old", nil, nil, "people.runtime", 0, time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC),
		))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'processing'.*fencing_token = \?`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO integration_operation_attempt`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	body := peopleProjectionBody("2026-07-10T12:00:00Z")
	body["operationFamily"] = "directory-lifecycle"
	claimed, err := adapter.claimPeopleIntegrationOperation(context.Background(), "", body)
	if err != nil {
		t.Fatalf("claimPeopleIntegrationOperation: %v", err)
	}
	if claimed["operationKey"] != operationKey || claimed["fencingToken"] != uint64(8) {
		t.Fatalf("recovered claim = %#v", claimed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssignmentUpdateFreezesDirectoryLifecycleInsideMutationTransaction(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	compatValue := reflect.ValueOf(adapter.Adapter).Elem()
	appCodeField := compatValue.FieldByName("appCode")
	reflect.NewAt(appCodeField.Type(), unsafe.Pointer(appCodeField.UnsafeAddr())).Elem().SetString("people")
	resourcesField := compatValue.FieldByName("resources")
	reflect.NewAt(resourcesField.Type(), unsafe.Pointer(resourcesField.UnsafeAddr())).Elem().Set(reflect.ValueOf([]compat.ResourceSpec{{
		Path: "assignments", Table: "people_assignments", CodeColumn: "assignment_code", OwnerColumn: "employee_uid", DepartmentColumn: "dept_code",
	}}))
	columnCacheField := compatValue.FieldByName("columnCache")
	reflect.NewAt(columnCacheField.Type(), unsafe.Pointer(columnCacheField.UnsafeAddr())).Elem().Set(reflect.MakeMap(columnCacheField.Type()))
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS.*TABLE_NAME = \?`).
		WithArgs("people_assignments").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE"}).
			AddRow("id", "bigint", "NO").
			AddRow("assignment_code", "varchar", "NO").
			AddRow("employee_uid", "varchar", "NO").
			AddRow("dept_code", "varchar", "YES").
			AddRow("updated_by", "varchar", "YES"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `people_assignments` SET `dept_code` = \\?, `updated_by` = \\? WHERE `assignment_code` = \\?").
		WithArgs("D-NEW", "operator-1", "ASN-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT employee_uid FROM people_assignments WHERE assignment_code=\? FOR UPDATE`).
		WithArgs("ASN-1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid"}).AddRow("u1"))
	mock.ExpectQuery(`(?s)FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnError(errors.New("freeze witness"))
	mock.ExpectRollback()

	body := peopleProjectionBody("2026-07-10T12:00:00Z")
	body["dept_code"] = "D-NEW"
	_, _, handled, err := adapter.handleDirectoryLifecycleMutation(
		context.Background(), http.MethodPatch, "/v1/people/assignments/ASN-1",
		url.Values{"current_user": []string{"operator-1"}, "current_user_data_access": []string{"all"}}, body,
	)
	if !handled || err == nil || err.Error() != "freeze witness" {
		t.Fatalf("handled=%v err=%v", handled, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("assignment mutation and lifecycle freeze must share one transaction: %v", err)
	}
}

func TestPrepareDueDirectoryLifecycleDoesNotProjectFutureAssignment(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := "2026-07-10T12:00:00Z"
	mock.ExpectQuery(`(?s)FROM people_employees e.*approval_status IN \('none','approved'\).*a\.effective_from<=\?`).
		WithArgs(int64(0), "2026-07-10", 2).
		WillReturnRows(sqlmock.NewRows([]string{"id", "employee_uid"}))
	body := peopleProjectionBody(asOf)
	body["limit"] = 1
	result, err := adapter.prepareDueDirectoryLifecycle(context.Background(), body)
	if err != nil || result["scanned"] != 0 || result["created"] != 0 {
		t.Fatalf("future assignment result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareDueDirectoryLifecycleCreatesOnceThenReusesSnapshot(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := "2026-07-10T12:00:00Z"
	fact := peopleLifecycleFact{
		EmployeeUID: "u1", LoginName: "alice", DisplayName: "Alice", EmploymentStatus: "active",
		DeptCode: "D1", PositionCode: "P1", PositionName: "Engineer", AssignmentCode: "ASN-LEAVE",
		ChangeType: "leave", EffectiveFrom: "2026-07-10",
	}
	content, _, _ := peopleLifecycleContent(fact)
	snapshotHash, err := integrationoperation.ValidateAndDigestCommand(content)
	if err != nil {
		t.Fatal(err)
	}
	operationKey := "people:directory-lifecycle:fixed:r1"
	for run := 0; run < 2; run++ {
		mock.ExpectQuery(`(?s)FROM people_employees e.*a\.effective_from<=\?`).
			WithArgs(int64(0), "2026-07-10", 2).
			WillReturnRows(sqlmock.NewRows([]string{"id", "employee_uid"}).AddRow(1, "u1"))
		mock.ExpectBegin()
		mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "employee_no", "login_name", "display_name", "dept_code", "position_code", "position_name", "employment_status", "leave_date", "identity_subject", "email", "email_state", "mobile", "mobile_state"}).
				AddRow("u1", "E001", "alice", "Alice", "D1", "P1", "Engineer", "active", "", "", "", "absent", "", "absent"))
		mock.ExpectQuery(`(?s)FROM people_assignments.*effective_from<=\?.*ORDER BY effective_from DESC,id DESC`).
			WithArgs("u1", "2026-07-10").
			WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "dept_code", "position_code", "position_name", "change_type", "effective_from"}).
				AddRow("ASN-LEAVE", "D1", "P1", "Engineer", "leave", "2026-07-10"))
		versionQuery := mock.ExpectQuery(`SELECT revision_no,snapshot_hash,operation_key FROM people_directory_lifecycle_versions`).WithArgs("u1")
		if run == 0 {
			versionQuery.WillReturnRows(sqlmock.NewRows([]string{"revision_no", "snapshot_hash", "operation_key"}))
			mock.ExpectExec(regexp.QuoteMeta("INSERT INTO integration_operation (")).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`INSERT INTO people_directory_lifecycle_versions`).WillReturnResult(sqlmock.NewResult(1, 1))
		} else {
			versionQuery.WillReturnRows(sqlmock.NewRows([]string{"revision_no", "snapshot_hash", "operation_key"}).AddRow(1, snapshotHash, operationKey))
		}
		mock.ExpectCommit()

		body := peopleProjectionBody(asOf)
		body["limit"] = 1
		result, err := adapter.prepareDueDirectoryLifecycle(context.Background(), body)
		if err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		if run == 0 && (result["created"] != 1 || result["reused"] != 0) {
			t.Fatalf("first run = %#v", result)
		}
		if run == 1 && (result["created"] != 0 || result["reused"] != 1) {
			t.Fatalf("second run = %#v", result)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDirectoryLifecycleRevisionUsesChainSequenceAndPreviousDependency(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	ctx := context.Background()
	asOf := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	previousOperationKey := "people:directory-lifecycle:fixed:r1"
	trusted := integrationoperation.TrustedContext{
		TenantCode:      "tenant-1",
		DeploymentCode:  "people-deployment",
		SourceApp:       "people",
		ServiceClientID: "client:people.runtime",
		RequestID:       "connector-job-2",
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"employee_uid", "employee_no", "login_name", "display_name",
			"dept_code", "position_code", "position_name", "employment_status",
			"leave_date", "identity_subject", "email", "email_state", "mobile", "mobile_state",
		}).AddRow(
			"u1", "E001", "alice", "Alice",
			"D1", "P1", "Engineer", "left",
			"2026-06-30", "ding-u1", "alice@example.com", "provided", "13800000000", "provided",
		))
	mock.ExpectQuery(`(?s)FROM people_assignments.*effective_from<=\?.*ORDER BY effective_from DESC,id DESC LIMIT 1 FOR UPDATE`).
		WithArgs("u1", "2026-07-23").
		WillReturnRows(sqlmock.NewRows([]string{
			"assignment_code", "dept_code", "position_code", "position_name", "change_type", "effective_from",
		}).AddRow("ASN-DT-LEAVE-U1", "D1", "P1", "Engineer", "leave", "2026-06-30"))
	mock.ExpectQuery(`SELECT revision_no,snapshot_hash,operation_key FROM people_directory_lifecycle_versions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"revision_no", "snapshot_hash", "operation_key"}).
			AddRow(1, "previous-snapshot-hash", previousOperationKey))
	mock.ExpectExec(`(?s)INSERT INTO integration_operation \(.*correlation_key,sequence_no,depends_on_operation_key.*VALUES \(\?,\?,\?,\?,NULLIF\(\?,''\)`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), int64(2), previousOperationKey,
			"tenant-1", "people-deployment",
			peopleDirectoryOffboardingOperation, peopleDirectoryOffboardingCapability,
			"u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			"connector-job-2", nil, "client:people.runtime",
			"client:people.runtime", "client:people.runtime",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_directory_lifecycle_versions`).
		WithArgs("u1", int64(2), sqlmock.AnyArg(), sqlmock.AnyArg(), "offboarding", "2026-06-30").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	tx, err := adapter.DB().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := adapter.freezeDirectoryLifecycleOperationAtTx(
		ctx, tx, "u1", trusted, "", trusted.ServiceClientID, asOf,
	)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	lifecycle, ok := result["directoryLifecycle"].(map[string]any)
	if !ok || lifecycle["sourceRevision"] != uint64(2) {
		t.Fatalf("directory lifecycle revision = %#v", result)
	}
	if operationKey, _ := lifecycle["operationKey"].(string); !strings.HasSuffix(operationKey, ":r2") {
		t.Fatalf("directory lifecycle operation key = %#v", lifecycle["operationKey"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLateOlderEmploymentAssignmentCannotReactivateAfterLeave(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "employee_no", "login_name", "display_name", "dept_code", "position_code", "position_name", "employment_status", "leave_date", "identity_subject", "email", "email_state", "mobile", "mobile_state"}).
			AddRow("u1", "E001", "alice", "Alice", "D1", "P1", "Engineer", "active", "", "", "", "absent", "", "absent"))
	mock.ExpectQuery(`(?s)FROM people_assignments.*effective_from<=\?.*ORDER BY effective_from DESC,id DESC LIMIT 1 FOR UPDATE`).
		WithArgs("u1", "2026-07-10").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "dept_code", "position_code", "position_name", "change_type", "effective_from"}).
			AddRow("ASN-LEAVE", "D1", "P1", "Engineer", "leave", "2026-07-10"))
	mock.ExpectRollback()
	tx, err := adapter.DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	fact, err := loadPeopleLifecycleFactAtTx(context.Background(), tx, "u1", time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	content, code, _ := peopleLifecycleContent(fact)
	if content["lifecycleType"] != "offboarding" || code != peopleDirectoryOffboardingOperation {
		t.Fatalf("late older employment reactivated lifecycle: %#v %s", content, code)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
