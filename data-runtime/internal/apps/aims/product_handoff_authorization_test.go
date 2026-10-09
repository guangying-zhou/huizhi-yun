package aims

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductHandoffProjectPermitFreshness(t *testing.T) {
	original := productHandoffProjectFacts{ProjectID: 42, ProjectCode: "PRJ", ActorUID: "pm", DepartmentCode: "DEV", LeaderUID: "lead", CreatedBy: "creator", IsMember: true}
	for _, name := range []string{"valid", "member-revoked", "department-moved", "leader-changed", "creator-changed", "project-replaced", "expired", "future-expiry", "wrong-resource", "wrong-actor"} {
		t.Run(name, func(t *testing.T) {
			a, m, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			p := productHandoffProjectPermit{Resource: "requirements", Action: "edit", Facts: original, ExpiresAt: 11000}
			current := original
			switch name {
			case "member-revoked":
				current.IsMember = false
			case "department-moved":
				current.DepartmentCode = "OTHER"
			case "leader-changed":
				current.LeaderUID = "other"
			case "creator-changed":
				current.CreatedBy = "other"
			case "project-replaced":
				current.ProjectID = 43
			case "expired":
				p.ExpiresAt = 1000
			case "future-expiry":
				p.ExpiresAt = 31001
			case "wrong-resource":
				p.Resource = "projects"
			case "wrong-actor":
				p.Facts.ActorUID = "other"
			}
			early := name == "wrong-resource" || name == "wrong-actor"
			expiry := name == "expired" || name == "future-expiry"
			m.ExpectBegin()
			if !early {
				m.ExpectQuery("SELECT id FROM aims_projects WHERE project_code=\\? FOR UPDATE").WithArgs("PRJ").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
				m.ExpectQuery("SELECT id FROM aims_project_members WHERE project_id=\\? AND uid=\\? FOR UPDATE").WithArgs(int64(42), "pm").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
				m.ExpectQuery("SELECT CAST\\(UNIX_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(1000))
				if !expiry {
					m.ExpectQuery("SELECT p.id,p.project_code.*FROM aims_projects p WHERE p.project_code=\\?").WithArgs("pm", "PRJ").WillReturnRows(sqlmock.NewRows([]string{"id", "code", "dept", "leader", "creator", "member"}).AddRow(current.ProjectID, current.ProjectCode, current.DepartmentCode, current.LeaderUID, current.CreatedBy, current.IsMember))
				}
			}
			m.ExpectRollback()
			tx, err := a.DB().BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			id, err := authorizeProductHandoffProjectTx(context.Background(), tx, "PRJ", "pm", p)
			if name == "valid" {
				if err != nil || id != 42 {
					t.Fatalf("valid permit: %d %v", id, err)
				}
			} else if err == nil {
				t.Fatal("invalid permit accepted")
			}
			if err = tx.Rollback(); err != nil {
				t.Fatal(err)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
