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
)

func TestConsoleRootDepartmentManagerMutation(t *testing.T) {
	for _, tt := range []struct {
		name       string
		body       map[string]any
		eligible   int
		userExists int
		wantCode   string
		wantStatus int
	}{
		{name: "add company manager", body: map[string]any{"managerId": "U-CEO"}, eligible: 1, userExists: 1},
		{name: "clear company manager", body: map[string]any{"managerId": nil}, eligible: 1},
		{name: "ordinary or source-managed department remains protected", body: map[string]any{"managerId": "U-CEO"}, wantCode: "dingtalk_department_field_managed", wantStatus: http.StatusConflict},
		{name: "root manager exception cannot rename department", body: map[string]any{"managerId": "U-CEO", "deptName": "Changed"}, eligible: 1, wantCode: "dingtalk_department_field_managed", wantStatus: http.StatusConflict},
		{name: "root manager exception cannot change sorting", body: map[string]any{"managerId": "U-CEO", "sortOrder": 5}, eligible: 1, wantCode: "dingtalk_department_field_managed", wantStatus: http.StatusConflict},
		{name: "manager must be an existing user", body: map[string]any{"managerId": "U-MISSING"}, eligible: 1, wantCode: "directory_user_not_found", wantStatus: http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()

			originalRandom := rand.Reader
			rand.Reader = bytes.NewReader(make([]byte, 16))
			t.Cleanup(func() { rand.Reader = originalRandom })
			const receiptID = "00000000-0000-4000-8000-000000000000"
			payload, err := json.Marshal(map[string]any{"code": "COMPANY", "committee": false, "changes": tt.body})
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(payload)
			mock.ExpectBegin()
			mock.ExpectExec(`INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).
				WithArgs("tenant-1", "directory.department.update", "root-manager-1").
				WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
					AddRow(receiptID, hex.EncodeToString(digest[:]), "processing", nil))
			mock.ExpectQuery(`(?s)SELECT org_type,status FROM directory_departments.*FOR UPDATE`).
				WithArgs("COMPANY").WillReturnRows(sqlmock.NewRows([]string{"org_type", "status"}).AddRow("department", "active"))
			mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_department_identities\s+WHERE provider_code='dingtalk' AND dept_code=\?`).
				WithArgs("COMPANY").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
			// The eligibility query must enforce every boundary; a blank manager on
			// an ordinary department or an inactive identity is not an override.
			mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_department_identities identities.*JOIN directory_departments departments.*identities.provider_code='dingtalk'.*identities.external_department_id='1'.*identities.dept_code=\?.*identities.status='active'.*COALESCE\(identities.manager_external_subject,''\)=''.*COALESCE\(departments.parent_dept_code,''\)=''.*departments.org_type='department'.*departments.status='active'`).
				WithArgs("COMPANY").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(tt.eligible))
			if tt.wantCode != "dingtalk_department_field_managed" {
				managerUID := consoleNullableString(tt.body["managerId"])
				if managerUID != "" {
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_users.*uid=\? AND status<>'deleted'`).
						WithArgs(managerUID).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(tt.userExists))
				}
				if tt.wantCode == "" {
					// Preserve source_provider while storing the Console fallback.
					mock.ExpectExec(`UPDATE directory_departments SET manager_uid=\?,synced_at=UTC_TIMESTAMP\(\),updated_at=UTC_TIMESTAMP\(\) WHERE dept_code=\?`).
						WithArgs(nullableConsoleText(managerUID), "COMPANY").WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectExec(`INSERT INTO directory_subject_exports`).WithArgs("COMPANY").WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectExec(`INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectExec(`UPDATE console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
				}
			}
			if tt.wantCode == "" {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}

			result, err := (&Adapter{db: database, tenant: "tenant-1"}).ConsoleUpdateDepartment(context.Background(), "COMPANY", tt.body, false,
				ConsoleMutationMeta{IdempotencyKey: "root-manager-1", ActorID: "admin-1"})
			if tt.wantCode == "" {
				if err != nil || result["receiptId"] != receiptID {
					t.Fatalf("result=%#v err=%v", result, err)
				}
			} else {
				assertDirectoryHTTPError(t, err, tt.wantStatus, tt.wantCode)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDingTalkSyncPreservesOnlyUnmanagedCompanyRootManager(t *testing.T) {
	for _, tt := range []struct {
		name           string
		externalID     string
		parentExternal string
		parentCode     string
		managerSubject string
		preserve       bool
	}{
		{name: "company root without upstream manager", externalID: "1", preserve: true},
		{name: "ordinary department without manager clears projection", externalID: "2", parentExternal: "1", parentCode: "COMPANY"},
		{name: "non-company root is not a fallback", externalID: "2"},
		{name: "company identity with upstream parent is not root", externalID: "1", parentExternal: "2"},
		{name: "company identity with canonical parent is not root", externalID: "1", parentCode: "OTHER"},
		{name: "upstream manager takes over company root", externalID: "1", managerSubject: "ding-ceo"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			mock.ExpectBegin()
			tx, err := database.Begin()
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectQuery(`FROM directory_department_identities i`).WithArgs(tt.externalID).
				WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}).AddRow("DPT-1", 7))
			var managerUID any
			if tt.managerSubject != "" {
				managerUID = "U-CEO"
				mock.ExpectQuery(`(?s)SELECT uid FROM directory_identities.*provider_code='dingtalk'.*provider_subject=\?.*status='active'`).
					WithArgs(tt.managerSubject).WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow(managerUID))
			}
			mock.ExpectExec(`(?s)UPDATE directory_departments.*manager_uid=CASE WHEN \? THEN manager_uid ELSE \? END`).
				WithArgs("公司", nil, tt.parentCode, "/", 1, 100, tt.preserve, managerUID, sqlmock.AnyArg(), int64(7)).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`(?s)UPDATE directory_department_identities.*manager_external_subject=NULLIF\(\?,''\)`).
				WithArgs(sqlmock.AnyArg(), tt.managerSubject, "snapshot-1", tt.externalID, "DPT-1").
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`INSERT INTO directory_subject_exports`).WithArgs("DPT-1").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()
			code, err := upsertDingTalkCanonicalDepartment(context.Background(), tx, tt.externalID, "公司", tt.parentCode, nil, "/", 1, tt.parentExternal, 100, tt.managerSubject, "snapshot-1")
			if err != nil || code != "DPT-1" {
				t.Fatalf("code=%q err=%v", code, err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
