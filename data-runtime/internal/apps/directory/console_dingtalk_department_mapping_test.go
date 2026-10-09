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

func TestPreviewDingTalkDepartmentMappingsSuggestsCanonicalTree(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectQuery(`(?s)SELECT d.dept_code,d.dept_name.*FROM directory_departments d.*source_provider='dingtalk'`).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "dept_name", "parent_dept_code", "external_ref", "members"}).
			AddRow("DT-1", "公司", "", "dingtalk:department:1", 0).
			AddRow("DT-2", "研发部", "DT-1", "dingtalk:department:2", 3))
	mock.ExpectQuery(`(?s)SELECT dept_code,dept_name.*FROM directory_departments.*org_type='department'`).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "dept_name", "parent_dept_code"}).
			AddRow("DPT-COMPANY", "公司", "").
			AddRow("DPT-RD", "研发部", "DPT-COMPANY"))
	mock.ExpectQuery(`SELECT external_department_id,dept_code.*directory_department_identities`).
		WillReturnRows(sqlmock.NewRows([]string{"external_department_id", "dept_code"}))
	mock.ExpectQuery(`(?s)SELECT alias.alias_dept_code,alias.canonical_dept_code.*directory_department_aliases`).
		WillReturnRows(sqlmock.NewRows([]string{"alias_dept_code", "canonical_dept_code"}))

	result, err := (&Adapter{db: database}).ConsolePreviewDingTalkDepartmentMappings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 2 {
		t.Fatalf("unexpected preview items: %#v", result["items"])
	}
	if items[0]["state"] != "suggested" || items[0]["suggestedDeptCode"] != "DPT-COMPANY" {
		t.Fatalf("unexpected root suggestion: %#v", items[0])
	}
	if items[1]["state"] != "suggested" || items[1]["suggestedDeptCode"] != "DPT-RD" {
		t.Fatalf("unexpected child suggestion: %#v", items[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApplyDingTalkDepartmentMappingsRejectsLegacyDingTalkTarget(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	originalRandom := rand.Reader
	rand.Reader = bytes.NewReader(make([]byte, 16))
	t.Cleanup(func() { rand.Reader = originalRandom })
	receiptID := "00000000-0000-4000-8000-000000000000"
	rawMappings := []any{map[string]any{
		"externalDepartmentId": "1",
		"canonicalDeptCode":    "DT-2",
	}}
	payloadJSON, err := json.Marshal(map[string]any{"mappings": rawMappings})
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(payloadJSON)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.dingtalk-department-mappings.apply", "mapping-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_departments.*source_provider='dingtalk'.*FOR UPDATE`).
		WithArgs("dingtalk:department:1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("DT-1"))
	mock.ExpectQuery(`(?s)SELECT status,org_type,COALESCE\(source_provider,''\),COALESCE\(external_ref,''\).*directory_departments.*FOR UPDATE`).
		WithArgs("DT-2").
		WillReturnRows(sqlmock.NewRows([]string{"status", "org_type", "source_provider", "external_ref"}).
			AddRow("active", "department", "dingtalk", "dingtalk:department:2"))
	mock.ExpectRollback()

	_, err = newAdapter(database, false, "tenant-1", "", "").ConsoleApplyDingTalkDepartmentMappings(
		context.Background(),
		map[string]any{"mappings": rawMappings},
		ConsoleMutationMeta{IdempotencyKey: "mapping-1", ActorID: "people-admin-1", ActorType: "human"},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "dingtalk_canonical_department_invalid" {
		t.Fatalf("error = %#v", err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApplyDingTalkDepartmentMappingsCommitsAndReplays(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := newAdapter(database, false, "tenant-1", "", "")

	originalRandom := rand.Reader
	rand.Reader = bytes.NewReader(make([]byte, 32))
	t.Cleanup(func() { rand.Reader = originalRandom })
	receiptID := "00000000-0000-4000-8000-000000000000"
	rawMappings := []any{map[string]any{
		"externalDepartmentId": "1",
		"canonicalDeptCode":    "DPT-RD",
	}}
	payloadJSON, err := json.Marshal(map[string]any{"mappings": rawMappings})
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(payloadJSON)
	meta := ConsoleMutationMeta{
		IdempotencyKey: "mapping-success-1",
		RequestID:      "request-1",
		ActorID:        "people-admin-1",
		ActorType:      "human",
	}

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.dingtalk-department-mappings.apply", "mapping-success-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_departments.*source_provider='dingtalk'.*FOR UPDATE`).
		WithArgs("dingtalk:department:1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("DT-1"))
	mock.ExpectQuery(`(?s)SELECT status,org_type,COALESCE\(source_provider,''\),COALESCE\(external_ref,''\).*directory_departments.*FOR UPDATE`).
		WithArgs("DPT-RD").
		WillReturnRows(sqlmock.NewRows([]string{"status", "org_type", "source_provider", "external_ref"}).
			AddRow("active", "department", "people", ""))
	mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_department_identities.*external_department_id=\?.*FOR UPDATE`).
		WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}))
	mock.ExpectQuery(`(?s)SELECT external_department_id FROM directory_department_identities.*dept_code=\?.*status='active'.*FOR UPDATE`).
		WithArgs("DPT-RD").
		WillReturnRows(sqlmock.NewRows([]string{"external_department_id"}))
	mock.ExpectExec(`(?s)INSERT INTO directory_department_identities`).
		WithArgs("1", "DPT-RD", "people-admin-1", "people-admin-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_user_departments.*FROM directory_user_departments AS legacy_membership.*is_primary=GREATEST\(directory_user_departments\.is_primary,VALUES\(is_primary\)\)`).
		WithArgs("DPT-RD", "DPT-RD", "DT-1").
		WillReturnResult(sqlmock.NewResult(1, 2))
	mock.ExpectExec(`(?s)UPDATE directory_user_departments.*WHERE dept_code=\?`).
		WithArgs("DT-1").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`(?s)UPDATE directory_users.*primary_dept_code=\?`).
		WithArgs("DPT-RD", "DT-1").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectQuery(`(?s)SELECT canonical_dept_code FROM directory_department_aliases.*FOR UPDATE`).
		WithArgs("DT-1").
		WillReturnRows(sqlmock.NewRows([]string{"canonical_dept_code"}))
	mock.ExpectExec(`(?s)INSERT INTO directory_department_aliases`).
		WithArgs("DT-1", "DPT-RD", "mapping-success-1", "people-admin-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE directory_departments.*status='inactive'`).
		WithArgs("DT-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE directory_subject_exports.*status='active'`).
		WithArgs("DT-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_subject_exports.*FROM directory_departments`).
		WithArgs("DPT-RD").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_subject_exports.*SELECT 'user'`).
		WillReturnResult(sqlmock.NewResult(1, 2))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ConsoleApplyDingTalkDepartmentMappings(
		context.Background(),
		map[string]any{"mappings": rawMappings},
		meta,
	)
	if err != nil {
		t.Fatalf("ConsoleApplyDingTalkDepartmentMappings: %v", err)
	}
	data, ok := result["data"].(map[string]any)
	aliases, aliasesOK := data["aliases"].([]map[string]any)
	if !ok || !aliasesOK || data["applied"] != 1 || len(aliases) != 1 ||
		aliases[0]["aliasDeptCode"] != "DT-1" || aliases[0]["canonicalDeptCode"] != "DPT-RD" ||
		result["receiptId"] != receiptID || result["replayed"] != false {
		t.Fatalf("result = %#v", result)
	}

	storedResult, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.dingtalk-department-mappings.apply", "mapping-success-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "succeeded", string(storedResult)))
	mock.ExpectCommit()

	replay, err := adapter.ConsoleApplyDingTalkDepartmentMappings(
		context.Background(),
		map[string]any{"mappings": rawMappings},
		meta,
	)
	if err != nil {
		t.Fatalf("ConsoleApplyDingTalkDepartmentMappings replay: %v", err)
	}
	if replay["receiptId"] != receiptID || replay["replayed"] != true {
		t.Fatalf("replay = %#v", replay)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
