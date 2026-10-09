package workflow

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestPeopleWorkflowReaderUsesCallerTransactionAndRegistry(t *testing.T) {
	for _, kind := range []string{"success", "missing", "dependency", "invalid-form"} {
		t.Run(kind, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectBegin()
			tx, e := db.Begin()
			if e != nil {
				t.Fatal(e)
			}
			q := m.ExpectQuery("SELECT .* FROM `frozen_workflow_instances` WHERE id=\\? FOR UPDATE").WithArgs("1")
			switch kind {
			case "missing":
				q.WillReturnError(sql.ErrNoRows)
			case "dependency":
				q.WillReturnError(errors.New("isolated dependency"))
			default:
				form := `{"snapshotHash":"hash"}`
				if kind == "invalid-form" {
					form = `null`
				}
				q.WillReturnRows(sqlmock.NewRows([]string{"id", "app", "resource", "action", "biz", "actor", "status", "form"}).AddRow("1", "people", "assignments", "change", "ASG-1", "HR", "approved", form))
			}
			a := &Adapter{}
			got, e := a.ReadPeopleWorkflowInstance(context.Background(), tx, func(name string) (string, error) {
				if name != "flow_instances" {
					t.Fatal("wrong logical table")
				}
				return "`frozen_workflow_instances`", nil
			}, "1")
			if (e == nil) != (kind == "success") {
				t.Fatal(kind, e)
			}
			if kind == "success" && (got.Actor != "HR" || got.Status != "approved" || got.Form["snapshotHash"] != "hash") {
				t.Fatal("wrong frozen instance", got)
			}
			m.ExpectRollback()
			tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
