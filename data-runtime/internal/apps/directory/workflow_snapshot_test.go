package directory

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestWorkflowSnapshotConsistentImmutableFailureMatrix(t *testing.T) {
	for _, scenario := range []string{"valid", "no-primary", "inactive", "missing", "wrong-case", "two-primary", "no-department", "dependency", "parent-unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db}
			m.ExpectBegin()
			uid, status, primary := "Actor", "active", "D"
			switch scenario {
			case "no-primary":
				primary = ""
			case "inactive":
				status = "inactive"
			case "wrong-case":
				uid = "actor"
			}
			q := m.ExpectQuery("SELECT id,uid,status").WithArgs("Actor")
			if scenario == "missing" {
				q.WillReturnError(sql.ErrNoRows)
			} else {
				q.WillReturnRows(sqlmock.NewRows([]string{"id", "uid", "status", "user_type", "name", "primary", "updated"}).AddRow(1, uid, status, "employee", "姓名", primary, "2026-10-01 01:00:00"))
			}
			early := scenario == "no-primary" || scenario == "inactive" || scenario == "missing" || scenario == "wrong-case"
			if !early {
				q := m.ExpectQuery("FROM directory_user_departments").WithArgs("Actor")
				rows := sqlmock.NewRows([]string{"rid", "dept", "ru", "did", "name", "type", "level", "manager", "leader", "parent", "du"})
				parent := ""
				if scenario == "parent-unavailable" {
					parent = "P"
				}
				if scenario != "no-department" {
					rows.AddRow(2, "D", "2026-10-01 01:01:00", 3, "部门", "department", 1, "Manager", "Leader", parent, "2026-10-01 01:02:00")
				}
				if scenario == "two-primary" {
					rows.AddRow(4, "OTHER", "2026-10-01 01:01:00", 5, "另一部门", "department", 1, "M", "L", "", "2026-10-01 01:02:00")
				}
				if scenario == "dependency" {
					q.WillReturnError(errors.New("private dependency detail"))
				} else {
					q.WillReturnRows(rows)
				}
				if scenario == "parent-unavailable" {
					m.ExpectQuery("FROM directory_departments WHERE").WithArgs("P").WillReturnError(sql.ErrNoRows)
				}
			}
			if scenario == "valid" {
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			got, err := a.ReadWorkflowInitiatorSnapshot(context.Background(), "Actor")
			if scenario == "valid" {
				if err != nil || len(got.SHA256()) != 64 {
					t.Fatal(got, err)
				}
				bytes := got.JSON()
				bytes[0] = 'x'
				facts := got.Context()
				facts["initiator_uid"] = "forged"
				if got.Context()["initiator_uid"] != "Actor" || got.JSON()[0] != '{' {
					t.Fatal("mutable snapshot")
				}
			} else if scenario == "inactive" || scenario == "missing" {
				var h httperror.Error
				if !errors.As(err, &h) || h.Status != 403 {
					t.Fatal(err)
				}
			} else if err == nil || !snapshotSafeError(err) || got.SHA256() != "" {
				t.Fatal("not failed closed/safe", err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func snapshotSafeError(err error) bool {
	var http httperror.Error
	return errors.As(err, &http) && http.Status == 503 && http.Code == "workflow_directory_snapshot_unavailable" && http.Message == "Workflow directory snapshot unavailable"
}

func TestWorkflowInitiatorNonEmployeeIs403BeforeDepartmentValidation(t *testing.T) {
	for _, kind := range []string{"system", "external", "service", "agent", "unknown", ""} {
		t.Run(kind, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db}
			m.ExpectBegin()
			m.ExpectQuery("SELECT id,uid,status").WithArgs("Actor").WillReturnRows(sqlmock.NewRows([]string{"id", "uid", "status", "user_type", "name", "primary", "updated"}).AddRow(1, "Actor", "inactive", kind, "", "", ""))
			m.ExpectRollback()
			_, err := a.ReadWorkflowInitiatorSnapshot(context.Background(), "Actor")
			var http httperror.Error
			if !errors.As(err, &http) || http.Status != 403 || http.Code != "workflow_subject_type_not_allowed" {
				t.Fatal(err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestWorkflowEmployeesTargetedReadFailureMatrix(t *testing.T) {
	for _, kind := range []string{"employee", "inactive", "system", "external", "service", "agent", "unknown", "", "NULL", "missing", "dependency", "wrong-case"} {
		t.Run(kind, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db}
			m.ExpectBegin()
			q := m.ExpectQuery("SELECT uid,status,user_type FROM directory_users WHERE BINARY uid=BINARY").WithArgs("Actor")
			var value any = kind
			uid, status := "Actor", "active"
			if kind == "NULL" {
				value = nil
			}
			if kind == "inactive" {
				value = "employee"
				status = "inactive"
			}
			if kind == "wrong-case" {
				value = "employee"
				uid = "actor"
			}
			if kind == "missing" {
				q.WillReturnError(sql.ErrNoRows)
			} else if kind == "dependency" {
				q.WillReturnError(errors.New("private SQL detail"))
			} else {
				q.WillReturnRows(sqlmock.NewRows([]string{"uid", "status", "user_type"}).AddRow(uid, status, value))
			}
			if kind == "employee" {
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			set, err := a.ReadWorkflowEmployees(context.Background(), []string{"Actor", "Actor"})
			if kind == "employee" {
				if err != nil || !set.Allows("Actor") || set.Allows("actor") || set.Allows("Unrequested") {
					t.Fatal(set, err)
				}
			} else if kind == "dependency" {
				if !snapshotSafeError(err) {
					t.Fatal(err)
				}
			} else {
				var h httperror.Error
				if !errors.As(err, &h) || h.Status != 403 {
					t.Fatal(err)
				}
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
	db, m, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	m.ExpectBegin()
	m.ExpectRollback()
	if _, err := a.ReadWorkflowEmployees(context.Background(), []string{"system:employee"}); err == nil {
		t.Fatal("system accepted")
	}
	if _, err := a.ReadWorkflowEmployees(context.Background(), make([]string, 1001)); !snapshotSafeError(err) {
		t.Fatal(err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
