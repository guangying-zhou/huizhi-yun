package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMyWorkItemsPagedUsesSameSnapshotForSummaryAndColumn(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT DISTINCT wi.project_id, p.project_code, p.name").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "project_code", "name"}).AddRow(42, "P-42", "Project"))
	mock.ExpectQuery("SELECT wi.status, COUNT\\(\\*\\)").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"status", "count"}).AddRow("todo", 23).AddRow("in_progress", 2))
	mock.ExpectQuery("SELECT COUNT\\(DISTINCT wi.project_id\\)").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("(?s)SELECT\\s+wi.id.*LIMIT \\? OFFSET \\?").
		WithArgs("u1", "todo", 20, 20).
		WillReturnRows(sqlmock.NewRows([]string{}))
	mock.ExpectCommit()

	result, err := adapter.myWorkItems(context.Background(), url.Values{
		"current_user": {"u1"}, "uid": {"u1"}, "page": {"2"}, "pageSize": {"20"}, "status": {"todo"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["total"] != int64(23) || result["page"] != 2 || result["pageSize"] != 20 {
		t.Fatalf("paged column = %#v", result)
	}
	summary := result["summary"].(map[string]any)
	if summary["total"] != int64(25) || summary["projectCount"] != int64(1) {
		t.Fatalf("full summary = %#v", summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMyWorkItemPageBounds(t *testing.T) {
	for _, query := range []url.Values{
		{"page": {"0"}}, {"page": {"01"}}, {"page": {"-1"}}, {"pageSize": {"101"}}, {"page_size": {"101"}}, {"page": {"1000001"}}, {"pageSize": {"20"}, "page_size": {"20"}},
	} {
		if _, _, err := myWorkItemPage(query); err == nil {
			t.Fatalf("accepted %#v", query)
		}
	}
	if page, size, err := myWorkItemPage(url.Values{"page": {"3"}, "pageSize": {"100"}}); err != nil || page != 3 || size != 100 {
		t.Fatalf("valid page = %d/%d: %v", page, size, err)
	}
}
