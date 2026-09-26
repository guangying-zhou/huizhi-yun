package aims

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"net/url"
	"testing"
)

func TestProjectDocumentCreationReplayDoesNotMutateExistingRows(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(map[bool]string{false: "same input", true: "conflicting input"}[conflict], func(t *testing.T) {
			adapter, mock, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			mock.ExpectQuery("(?s)SELECT id, project_code.*FROM aims_projects").WithArgs(int64(42)).
				WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}).AddRow(42, "PRJ-1"))
			mock.ExpectExec("INSERT INTO project_documents").WillReturnError(&mysql.MySQLError{Number: 1062})
			lookup := mock.ExpectQuery("(?s)SELECT id FROM project_documents WHERE.*created_by = .*updated_by")
			if conflict {
				lookup.WillReturnError(sql.ErrNoRows)
			} else {
				lookup.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(88))
			}
			result, err := adapter.createDirectDocument(context.Background(), url.Values{"current_user": {"person-a"}, "current_user_is_project_admin": {"1"}},
				map[string]any{"uuid": "document-1", "projectId": 42, "title": "Spec", "isFolder": true})
			if conflict && err == nil {
				t.Fatal("conflicting UUID accepted")
			}
			if !conflict && (err != nil || result["id"] != int64(88)) {
				t.Fatalf("replay: %#v %v", result, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
