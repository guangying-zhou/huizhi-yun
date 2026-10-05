package aims

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRequirementDraftJoinsCallerTransaction(t *testing.T) {
	for _, failAfterDraft := range []bool{false, true} {
		name := "commit_with_source_link"
		if failAfterDraft {
			name = "rollback_on_source_link_failure"
		}
		t.Run(name, func(t *testing.T) {
			a, mock, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT project_code FROM aims_projects WHERE id = \\?").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"project_code"}).AddRow("PRJ"))
			mock.ExpectQuery("SELECT COALESCE\\(MAX\\(req_number\\), 0\\) FROM requirement_items WHERE project_id = \\?").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(7))
			mock.ExpectExec("(?s)INSERT INTO requirement_items").WithArgs(int64(42), int64(8), "PRJ-REQ-008", "规划范围", "functional", nil, "P2", "internal", nil, int64(77), "冻结范围", "pm").WillReturnResult(sqlmock.NewResult(88, 1))
			linkFailure := errors.New("source link failure")
			link := mock.ExpectExec("INSERT INTO product_request_delivery_links").WithArgs(int64(88))
			if failAfterDraft {
				link.WillReturnError(linkFailure)
				mock.ExpectRollback()
			} else {
				link.WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			}
			ctx := context.Background()
			tx, err := a.DB().BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			input, err := parseProjectRequirementCreateInput(42, "pm", map[string]any{"title": "规划范围", "scopeNote": "冻结范围"})
			if err != nil {
				t.Fatal(err)
			}
			input.workItemID = sql.NullInt64{Int64: 77, Valid: true}
			draft, err := a.createProjectRequirementTx(ctx, tx, input)
			if err != nil {
				t.Fatal(err)
			}
			if draft["id"] != int64(88) || draft["status"] != "draft" {
				t.Fatalf("draft: %+v", draft)
			}
			// A subsequent command step must still use the same live transaction.
			_, err = tx.ExecContext(ctx, "INSERT INTO product_request_delivery_links(requirement_id) VALUES (?)", draft["id"])
			if failAfterDraft {
				if !errors.Is(err, linkFailure) {
					t.Fatalf("source link error: %v", err)
				}
				if err = tx.Rollback(); err != nil {
					t.Fatal(err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if err = tx.Commit(); err != nil {
					t.Fatal(err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
