package codocs

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestEnterpriseProjectDocumentUsesSamePolicyCore(t *testing.T) {
	uuid := "11111111-1111-4111-8111-111111111111"
	for _, tc := range []struct {
		name, stage, level, grant, reason string
		member, cross, allow              bool
	}{
		{"default member", "draft", "L2", "", "source_project_member", true, false, true},
		{"default nonmember", "draft", "L2", "", "draft_requires_project_member", false, false, false},
		{"user share", "formal", "L2", "user", "granted_by_user", false, false, true},
		{"cross denied", "formal", "L2", "project", "no_matching_grant", false, false, false},
		{"cross allowed", "formal", "L2", "project", "granted_by_project", false, true, true},
		{"L3 blocks cross", "formal", "L3", "project", "no_matching_grant", false, true, false},
		{"department", "formal", "L2", "dept", "granted_by_dept", false, false, true},
		{"archived readonly", "archived", "L2", "user", "granted_by_user", false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, m, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			a := &Adapter{db: db}
			m.ExpectQuery("SELECT \\* FROM documents WHERE uuid").WithArgs(uuid).WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "status"}).AddRow(1, uuid, 1))
			for range 3 {
				m.ExpectQuery("(?s)SELECT TABLE_NAME.*information_schema.TABLES").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("fixture"))
			}
			m.ExpectQuery("(?s)SELECT id, document_ref_type.*FROM document_access_policies").WillReturnRows(sqlmock.NewRows([]string{"id", "ref", "uuid", "app", "project", "stage", "level", "permission", "internal", "cross", "readonly", "creator", "updater", "created", "updated"}).AddRow(1, "codocs_document", uuid, "aims", "P1", tc.stage, tc.level, "none", false, tc.cross, false, "creator", "creator", "time", "time"))
			grants := sqlmock.NewRows([]string{"id", "policy_id", "subject_type", "subject_code", "permission", "expires_at", "created_by", "created_at"})
			if tc.grant != "" {
				subject := "actor"
				if tc.grant == "project" {
					subject = "P2"
				}
				if tc.grant == "dept" {
					subject = "D1"
				}
				grants.AddRow(1, 1, tc.grant, subject, "view", nil, "owner", "time")
			}
			m.ExpectQuery("(?s)SELECT id, policy_id.*FROM document_access_grants").WillReturnRows(grants)
			m.ExpectExec("INSERT INTO document_access_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
			projects := []string{"P2"}
			if tc.member {
				projects = append(projects, "P1")
			}
			out, err := a.CheckEnterpriseProjectDocument(context.Background(), uuid, "codocs_document", EnterpriseProjectDocumentFacts{ActorUID: "actor", ProjectCode: "P1", ProjectCodes: projects, DeptCodes: []string{"D1"}, Roles: []string{"employee"}})
			if err != nil {
				t.Fatal(err)
			}
			if out["allowed"] != tc.allow || out["reason"] != tc.reason {
				t.Fatalf("wrong decision: %v", out)
			}
			if tc.stage == "archived" && out["readonly"] != true {
				t.Fatal("readonly lost")
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestEnterpriseProjectDocumentMissingReferenceOmitted(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	m.ExpectQuery("SELECT \\* FROM documents WHERE uuid").WillReturnError(sql.ErrNoRows)
	out, err := (&Adapter{db: db}).CheckEnterpriseProjectDocument(context.Background(), "11111111-1111-4111-8111-111111111111", "codocs_document", EnterpriseProjectDocumentFacts{ActorUID: "actor", ProjectCode: "P1"})
	if err != nil || out["allowed"] != false {
		t.Fatal("missing reference not omitted", err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
