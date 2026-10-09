package aims

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestVersionDetachLocksAndInvalidatesAcceptance(t *testing.T) {
	for _, state := range []string{"released", "archived", "planning", "developing", "revision-failure"} {
		t.Run(state, func(t *testing.T) {
			a, m, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			m.ExpectBegin()
			status := state
			if state == "revision-failure" {
				status = "developing"
			}
			m.ExpectQuery(`SELECT status FROM product_versions WHERE id = \? FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(status))
			allowed := status == "planning" || status == "developing"
			if allowed {
				m.ExpectExec(`UPDATE work_items SET version_id = NULL, feature_id = NULL`).WithArgs(int64(9), int64(42), int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
				update := m.ExpectExec(`UPDATE product_versions SET revision = revision \+ 1, scope_revision = scope_revision \+ 1`).WithArgs(int64(7))
				if state == "revision-failure" {
					update.WillReturnError(errors.New("injected"))
				} else {
					update.WillReturnResult(sqlmock.NewResult(0, 1))
				}
			}
			success := allowed && state != "revision-failure"
			if success {
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			_, err := a.detachVersionItemTransaction(context.Background(), 42, 7, 9)
			if (err == nil) != success {
				t.Fatalf("unexpected %v", err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
