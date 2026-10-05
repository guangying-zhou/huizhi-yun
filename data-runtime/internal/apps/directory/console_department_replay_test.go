package directory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

// Exercise the existing receipt and real department operations against SQL
// fixtures only. On replay no Directory write or audit may execute again.
func TestConsoleDepartmentWritesCommitAndReplay(t *testing.T) {
	for _, action := range []string{"create", "update", "delete"} {
		t.Run(action, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			adapter := newAdapter(db, false, "tenant-1", "", "")
			old := rand.Reader
			rand.Reader = bytes.NewReader(make([]byte, 32))
			defer func() { rand.Reader = old }()
			receipt := "00000000-0000-4000-8000-000000000000"
			body := map[string]any{"deptCode": "D1", "name": "Department"}
			payload := map[string]any{"code": "D1", "committee": false, "body": body}
			if action == "update" {
				body = map[string]any{"name": "Renamed"}
				payload = map[string]any{"code": "D1", "committee": false, "changes": body}
			}
			if action == "delete" {
				payload = map[string]any{"code": "D1", "committee": false}
			}
			encoded, _ := json.Marshal(payload)
			digest := sha256.Sum256(encoded)
			hash := hex.EncodeToString(digest[:])
			operation := "directory.department." + action
			meta := ConsoleMutationMeta{IdempotencyKey: "department-test-0001", ActorID: "user-1", ActorType: "human"}
			expectReceipt := func(status string, result any) {
				mock.ExpectBegin()
				mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).WithArgs("tenant-1", operation, meta.IdempotencyKey).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).AddRow(receipt, hash, status, result))
			}
			invoke := func() (map[string]any, error) {
				switch action {
				case "create":
					return adapter.ConsoleCreateDepartment(context.Background(), body, false, meta)
				case "update":
					return adapter.ConsoleUpdateDepartment(context.Background(), "D1", body, false, meta)
				default:
					return adapter.ConsoleDeleteDepartment(context.Background(), "D1", false, meta)
				}
			}
			expectReceipt("processing", nil)
			if action == "create" {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_departments`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				mock.ExpectExec(`(?s)INSERT INTO directory_departments`).WillReturnResult(sqlmock.NewResult(1, 1))
			} else {
				mock.ExpectQuery(`(?s)SELECT org_type,status FROM directory_departments.*FOR UPDATE`).WillReturnRows(sqlmock.NewRows([]string{"org_type", "status"}).AddRow("department", "active"))
				if action == "delete" {
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_department_identities`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_departments`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_user_departments`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				} else {
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_department_identities`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				}
				mock.ExpectExec(`(?s)UPDATE directory_departments`).WillReturnResult(sqlmock.NewResult(0, 1))
			}
			mock.ExpectExec(`(?s)INSERT INTO directory_subject_exports`).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`(?s)INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`(?s)UPDATE console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
			first, err := invoke()
			if err != nil {
				t.Fatalf("first: %v", err)
			}
			stored, _ := json.Marshal(first)
			expectReceipt("succeeded", string(stored))
			mock.ExpectCommit()
			replay, err := invoke()
			if err != nil {
				t.Fatalf("replay: %v", err)
			}
			if replay["replayed"] != true || replay["receiptId"] != receipt {
				t.Fatalf("invalid replay: %#v", replay)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
