package aims

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestEnterpriseDocumentUUIDAssociationRequiresAuthoritativeProject(t *testing.T) {
	for _, tc := range []struct {
		name        string
		owner       int64
		deliverable bool
		denied      bool
	}{
		{"project", 42, false, false}, {"otherProject", 99, false, true}, {"deliverable", 0, true, false}, {"unlinked", 0, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, m, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			rows := sqlmock.NewRows([]string{"id", "title"})
			if tc.owner > 0 {
				rows.AddRow(7, "spec")
			}
			m.ExpectQuery("SELECT id,title FROM project_documents WHERE").WithArgs("uuid", "uuid").WillReturnRows(rows)
			if tc.owner > 0 {
				m.ExpectQuery("SELECT portfolio_id,project_id,milestone_id,work_item_id,project_code,parent_id").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"portfolio_id", "project_id", "milestone_id", "work_item_id", "project_code", "parent_id"}).AddRow(nil, tc.owner, nil, nil, "P", nil))
				m.ExpectQuery("(?s)SELECT id, project_code.*FROM aims_projects").WithArgs(tc.owner).WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}).AddRow(tc.owner, "P"))
			}
			if tc.owner != 42 {
				rows := sqlmock.NewRows([]string{"title"})
				if tc.deliverable {
					rows.AddRow("delivered spec")
				}
				m.ExpectQuery("(?s)FROM deliverables WHERE project_id=.*BINARY document_uuid=BINARY").WithArgs("42", "uuid").WillReturnRows(rows)
			}
			title, err := a.EnterpriseProjectDocumentUUIDTitle(context.Background(), "42", "uuid")
			var h httperror.Error
			if tc.denied {
				if !errors.As(err, &h) || h.Status != 403 {
					t.Fatalf("want unlinked 403, got %v", err)
				}
			} else if err != nil || title == "" {
				t.Fatalf("title=%q err=%v", title, err)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
