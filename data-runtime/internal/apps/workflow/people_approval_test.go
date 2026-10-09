package workflow

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestPeopleIndependentReaderUsesAdapterDB(t *testing.T) {
	for _, kind := range []string{"running", "approved", "rejected", "missing", "dependency", "invalid-form"} {
		t.Run(kind, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			q := m.ExpectQuery("SELECT .* FROM flow_instances WHERE id=\\?").WithArgs("39")
			switch kind {
			case "dependency":
				q.WillReturnError(errors.New("dependency"))
			case "missing":
				q.WillReturnRows(sqlmock.NewRows([]string{"id"}))
			default:
				form := `{"snapshotHash":"hash"}`
				if kind == "invalid-form" {
					form = `null`
				}
				q.WillReturnRows(sqlmock.NewRows([]string{"id", "instance_no", "app_code", "resource_code", "action_code", "biz_id", "initiator_uid", "status", "callback_url", "form_data"}).AddRow(39, "WF-39", "people", "assignments", "change", "ASN-1", "HR", kind, "/api/v1/service/workflow/callback", form))
			}
			v, e := (&Adapter{db: db}).ReadPeopleApprovalInstance(context.Background(), "39")
			if kind == "dependency" || kind == "invalid-form" {
				if e == nil {
					t.Fatal("error missing")
				}
			} else if e != nil {
				t.Fatal(e)
			} else if kind == "missing" {
				if v != nil {
					t.Fatal(v)
				}
			} else if v.ID != "39" || v.Initiator != "HR" || v.Status != kind {
				t.Fatal(v)
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
