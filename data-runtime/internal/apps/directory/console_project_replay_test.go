package directory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// Exercise the existing receipt and real project operations against SQL
// fixtures only. On replay no Directory write or audit may execute again.
func TestConsoleProjectWritesCommitAndReplay(t *testing.T) {
	for _, action := range []string{"create", "update", "delete", "members.replace"} {
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
			body := map[string]any{"projectCode": "P1", "name": "Project"}
			payload := body
			if action == "update" {
				body = map[string]any{"name": "Renamed"}
				payload = map[string]any{"projectCode": "P1", "changes": body}
			}
			if action == "delete" {
				payload = map[string]any{"projectCode": "P1"}
			}
			if action == "members.replace" {
				body = map[string]any{"members": []any{map[string]any{"uid": "U1", "role": "member"}}}
				payload = map[string]any{"projectCode": "P1", "members": body}
			}
			encoded, _ := json.Marshal(payload)
			digest := sha256.Sum256(encoded)
			hash := hex.EncodeToString(digest[:])
			operation := "directory.project." + action
			meta := ConsoleMutationMeta{IdempotencyKey: "project-test-0001", ActorID: "user-1", ActorType: "human"}
			expectReceipt := func(status string, result any) {
				mock.ExpectBegin()
				mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).WithArgs("tenant-1", operation, meta.IdempotencyKey).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).AddRow(receipt, hash, status, result))
			}
			invoke := func() (map[string]any, error) {
				switch action {
				case "create":
					return adapter.ConsoleCreateProject(context.Background(), body, meta)
				case "update":
					return adapter.ConsoleUpdateProject(context.Background(), "P1", body, meta)
				case "members.replace":
					return adapter.ConsoleReplaceProjectMembers(context.Background(), "P1", body, meta)
				default:
					return adapter.ConsoleDeleteProject(context.Background(), "P1", meta)
				}
			}
			expectReceipt("processing", nil)
			if action == "create" {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_projects`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				mock.ExpectExec(`(?s)INSERT INTO directory_projects`).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(`(?s)UPDATE directory_project_members`).WillReturnResult(sqlmock.NewResult(0, 0))
			} else if action == "members.replace" {
				mock.ExpectQuery(`(?s)SELECT project_code FROM directory_projects.*FOR UPDATE`).WillReturnRows(sqlmock.NewRows([]string{"project_code"}).AddRow("P1"))
				mock.ExpectExec(`(?s)UPDATE directory_project_members`).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_users`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				mock.ExpectExec(`(?s)INSERT INTO directory_project_members`).WillReturnResult(sqlmock.NewResult(1, 1))
			} else {
				mock.ExpectQuery(`(?s)SELECT status FROM directory_projects.*FOR UPDATE`).WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("active"))
				if action == "delete" {
					mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM directory_projects`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
					mock.ExpectExec(`(?s)UPDATE directory_project_members`).WillReturnResult(sqlmock.NewResult(0, 1))
				}
				mock.ExpectExec(`(?s)UPDATE directory_projects`).WillReturnResult(sqlmock.NewResult(0, 1))
			}
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
