package directory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFinalizeDingTalkDepartmentSnapshotRejectsIncompleteFinalBeforeDatabase(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	_, err = newAdapter(database, false, "tenant-1", "", "").FinalizeDingTalkDepartmentSnapshot(
		context.Background(),
		map[string]any{
			"final": true, "objectScopes": []string{"organization"},
			"jobId": "job-1", "watermark": "revision-1",
			"organizationSnapshotComplete": false,
		},
		"connector-1",
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "dingtalk_organization_snapshot_incomplete" {
		t.Fatalf("error = %#v", err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFinalizeDingTalkDepartmentSnapshotFreezesHighRiskMissingDepartment(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := newAdapter(database, false, "tenant-1", "", "")

	rootDigest := dingTalkDepartmentSnapshotLeafHash("1", "汇智云", "", 10, "")
	childDigest := dingTalkDepartmentSnapshotLeafHash("2", "研发部", "1", 10, "manager-1")
	snapshotHash := sha256Hex([]byte("1\n" + rootDigest + "\n2\n" + childDigest))

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id,snapshot_hash,status,risk_level,missing_department_count.*directory_department_snapshot_runs.*FOR UPDATE`).
		WithArgs("revision-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "snapshot_hash", "status", "risk_level", "missing_department_count"}))
	mock.ExpectQuery(`(?s)SELECT external_department_id,source_payload_hash.*directory_department_identities.*last_snapshot_revision=\?`).
		WithArgs("revision-1").
		WillReturnRows(sqlmock.NewRows([]string{"external_department_id", "source_payload_hash"}).
			AddRow("1", rootDigest).
			AddRow("2", childDigest))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*directory_department_identities identities.*departments.parent_dept_code`).
		WithArgs("1", "revision-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT max_missing_department_count,max_missing_department_ratio.*directory_hr_source_policies.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"max_missing_department_count", "max_missing_department_ratio"}).
			AddRow(3, 0.10))
	mock.ExpectQuery(`(?s)SELECT identities.external_department_id,departments.dept_code.*directory_department_identities identities.*last_snapshot_revision`).
		WithArgs("revision-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"external_department_id", "dept_code", "dept_name", "parent_dept_code", "level_no",
			"active_primary_users", "active_children",
		}).AddRow("3", "DPT-OLD", "旧部门", "DPT-ROOT", 2, 0, 0))
	mock.ExpectExec(`(?s)INSERT INTO directory_department_snapshot_runs`).
		WillReturnResult(sqlmock.NewResult(41, 1))
	mock.ExpectExec(`(?s)UPDATE directory_department_snapshot_differences differences.*status='superseded'`).
		WithArgs(int64(41)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE directory_department_snapshot_runs.*status='superseded'`).
		WithArgs(int64(41)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)INSERT INTO directory_department_snapshot_differences`).
		WithArgs(int64(41), "3", "DPT-OLD", "旧部门", "DPT-ROOT", 2, 0, 0).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.FinalizeDingTalkDepartmentSnapshot(context.Background(), map[string]any{
		"final":                        true,
		"objectScopes":                 []any{"organization"},
		"jobId":                        "job-1",
		"watermark":                    "revision-1",
		"organizationSnapshotComplete": true,
		"organizationRootDepartmentId": "1",
		"organizationDepartmentCount":  2,
		"organizationSnapshotHash":     snapshotHash,
	}, "connector-1")
	if err != nil {
		t.Fatalf("FinalizeDingTalkDepartmentSnapshot: %v", err)
	}
	if result["runId"] != int64(41) || result["status"] != "awaiting_confirmation" ||
		result["riskLevel"] != "high" || result["missingDepartmentCount"] != 1 {
		t.Fatalf("result = %#v", result)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleDingTalkDepartmentSnapshotChangesRechecksBlockers(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := newAdapter(database, false, "tenant-1", "", "")
	snapshotHash := string(bytes.Repeat([]byte{'a'}, 64))

	mock.ExpectQuery(`(?s)SELECT id,job_id,snapshot_revision.*directory_department_snapshot_runs.*ORDER BY id DESC`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "job_id", "snapshot_revision", "snapshot_hash", "root_external_department_id",
			"reported_department_count", "seen_department_count", "active_identity_count", "missing_department_count",
			"missing_department_ratio", "policy_max_missing_count", "policy_max_missing_ratio", "risk_level", "root_missing", "status",
		}).AddRow(41, "job-1", "revision-1", snapshotHash, "1", 2, 2, 3, 1, 0.333333, 3, 0.1, "high", false, "awaiting_confirmation"))
	mock.ExpectQuery(`(?s)SELECT differences.external_department_id,differences.dept_code.*directory_department_snapshot_differences differences`).
		WithArgs(int64(41)).
		WillReturnRows(sqlmock.NewRows([]string{
			"external_department_id", "dept_code", "dept_name", "parent_dept_code", "level_no", "status",
			"active_primary_users", "blocking_children",
		}).AddRow("3", "DPT-OLD", "旧部门", "DPT-ROOT", 2, "pending", 1, 0))

	result, err := adapter.ConsoleDingTalkDepartmentSnapshotChanges(context.Background())
	if err != nil {
		t.Fatalf("ConsoleDingTalkDepartmentSnapshotChanges: %v", err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 1 || items[0]["canApply"] != false {
		t.Fatalf("items = %#v", result["items"])
	}
	reasons, ok := items[0]["blockedReasons"].([]string)
	if !ok || len(reasons) != 1 || reasons[0] != "active_primary_users" {
		t.Fatalf("blockedReasons = %#v", items[0]["blockedReasons"])
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleApplyDingTalkDepartmentSnapshotChangesRejectsActivePrimaryUsers(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := newAdapter(database, false, "tenant-1", "", "")

	originalRandom := rand.Reader
	rand.Reader = bytes.NewReader(make([]byte, 16))
	t.Cleanup(func() { rand.Reader = originalRandom })
	receiptID := "00000000-0000-4000-8000-000000000000"
	snapshotHash := string(bytes.Repeat([]byte{'a'}, 64))
	payloadJSON, err := json.Marshal(map[string]any{
		"snapshotRunId": int64(41), "snapshotHash": snapshotHash, "departmentCodes": []string{"DPT-OLD"},
	})
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(payloadJSON)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.dingtalk-department-snapshot.apply", "snapshot-apply-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`(?s)SELECT snapshot_revision,snapshot_hash,status.*directory_department_snapshot_runs.*FOR UPDATE`).
		WithArgs(int64(41)).
		WillReturnRows(sqlmock.NewRows([]string{"snapshot_revision", "snapshot_hash", "status"}).
			AddRow("revision-1", snapshotHash, "awaiting_confirmation"))
	mock.ExpectQuery(`(?s)SELECT differences.dept_code,differences.level_no_snapshot.*directory_department_snapshot_differences differences.*FOR UPDATE`).
		WithArgs(int64(41), "DPT-OLD").
		WillReturnRows(sqlmock.NewRows([]string{
			"dept_code", "level_no", "difference_status", "department_status", "org_type", "identity_status", "last_revision",
		}).AddRow("DPT-OLD", 2, "pending", "active", "department", "active", "revision-0"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_users users.*users.primary_dept_code=\?`).
		WithArgs("DPT-OLD", "DPT-OLD").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectRollback()

	_, err = adapter.ConsoleApplyDingTalkDepartmentSnapshotChanges(context.Background(), map[string]any{
		"snapshotRunId": int64(41), "snapshotHash": snapshotHash, "departmentCodes": []any{"DPT-OLD"},
	}, ConsoleMutationMeta{
		IdempotencyKey: "snapshot-apply-1", ActorID: "people-admin-1", ActorType: "human",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "dingtalk_department_has_active_primary_users" {
		t.Fatalf("error = %#v", err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleApplyDingTalkDepartmentSnapshotChangesCommitsFullApply(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := newAdapter(database, false, "tenant-1", "", "")

	originalRandom := rand.Reader
	rand.Reader = bytes.NewReader(make([]byte, 16))
	t.Cleanup(func() { rand.Reader = originalRandom })
	receiptID := "00000000-0000-4000-8000-000000000000"
	snapshotHash := string(bytes.Repeat([]byte{'a'}, 64))
	payloadJSON, err := json.Marshal(map[string]any{
		"snapshotRunId": int64(41), "snapshotHash": snapshotHash, "departmentCodes": []string{"DPT-OLD"},
	})
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(payloadJSON)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.dingtalk-department-snapshot.apply", "snapshot-apply-success-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`(?s)SELECT snapshot_revision,snapshot_hash,status.*directory_department_snapshot_runs.*FOR UPDATE`).
		WithArgs(int64(41)).
		WillReturnRows(sqlmock.NewRows([]string{"snapshot_revision", "snapshot_hash", "status"}).
			AddRow("revision-1", snapshotHash, "awaiting_confirmation"))
	mock.ExpectQuery(`(?s)SELECT differences.dept_code,differences.level_no_snapshot.*directory_department_snapshot_differences differences.*FOR UPDATE`).
		WithArgs(int64(41), "DPT-OLD").
		WillReturnRows(sqlmock.NewRows([]string{
			"dept_code", "level_no", "difference_status", "department_status", "org_type", "identity_status", "last_revision",
		}).AddRow("DPT-OLD", 2, "pending", "active", "department", "active", "revision-0"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_users users.*users.primary_dept_code=\?`).
		WithArgs("DPT-OLD", "DPT-OLD").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_departments.*parent_dept_code=\?.*FOR UPDATE`).
		WithArgs("DPT-OLD").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}))
	mock.ExpectExec(`(?s)UPDATE directory_user_departments.*WHERE dept_code=\?`).
		WithArgs("DPT-OLD").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE directory_department_identities.*status='inactive'`).
		WithArgs("people-admin-1", "DPT-OLD").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE directory_departments.*status='inactive'`).
		WithArgs("DPT-OLD").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE directory_subject_exports.*status='inactive'`).
		WithArgs("DPT-OLD").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE directory_department_snapshot_differences.*status='applied'`).
		WithArgs("people-admin-1", int64(41), "DPT-OLD").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_subject_exports.*SELECT 'user'`).
		WillReturnResult(sqlmock.NewResult(1, 0))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_department_snapshot_differences.*status='pending'`).
		WithArgs(int64(41)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)UPDATE directory_department_snapshot_runs.*SET status=\?`).
		WithArgs("applied", "people-admin-1", "applied", int64(41)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ConsoleApplyDingTalkDepartmentSnapshotChanges(
		context.Background(),
		map[string]any{
			"snapshotRunId": int64(41), "snapshotHash": snapshotHash,
			"departmentCodes": []any{"DPT-OLD"},
		},
		ConsoleMutationMeta{
			IdempotencyKey: "snapshot-apply-success-1",
			RequestID:      "request-1",
			ActorID:        "people-admin-1",
			ActorType:      "human",
		},
	)
	if err != nil {
		t.Fatalf("ConsoleApplyDingTalkDepartmentSnapshotChanges: %v", err)
	}
	data, ok := result["data"].(map[string]any)
	if !ok || data["runId"] != int64(41) || data["applied"] != 1 || data["remaining"] != 0 || data["status"] != "applied" ||
		result["receiptId"] != receiptID || result["replayed"] != false {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
