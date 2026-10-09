package aims

import (
	"context"
	"database/sql"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProjectBoardPageCountsWholeColumnAndTypesBeforeLimit(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? LIMIT 1").WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
	mock.ExpectQuery("(?s)SELECT p\\.id\\s+FROM aims_projects p\\s+WHERE p\\.id = \\?").
		WithArgs(int64(42), "u1", "u1", "u1", "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT wi.status, wi.type, COALESCE").WithArgs(int64(42), "matter").
		WillReturnRows(sqlmock.NewRows([]string{"status", "type", "severity", "count"}).
			AddRow("todo", "task", "", 23).AddRow("in_progress", "bug", "high", 2))
	mock.ExpectQuery("(?s)SELECT\\s+wi.id.*FROM work_items wi").WithArgs(int64(42), "todo", "matter", 20, 20).
		WillReturnRows(sqlmock.NewRows([]string{}))
	mock.ExpectCommit()
	response, err := adapter.projectWorkItems(context.Background(), "42", url.Values{
		"current_user": {"u1"}, "current_user_project_admin_project_codes": {"PRJ-1"},
		"view": {"board"}, "status": {"todo"}, "tier": {"matter"}, "page": {"2"}, "pageSize": {"20"},
	})
	if err != nil {
		t.Fatal(err)
	}
	page := response.(map[string]any)
	if page["total"] != int64(23) || page["page"] != 2 {
		t.Fatalf("column page %#v", page)
	}
	summary := page["summary"].(map[string]any)
	if summary["total"] != int64(25) || summary["type"].(map[string]int64)["bug"] != 2 || summary["severity"].(map[string]int64)["high"] != 2 {
		t.Fatalf("full summary %#v", summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectBoardQuickFilterKeepsUnfilteredWIPCount(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? LIMIT 1").WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
	mock.ExpectQuery("(?s)SELECT p\\.id\\s+FROM aims_projects p\\s+WHERE p\\.id = \\?").
		WithArgs(int64(42), "u1", "u1", "u1", "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(42))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT wi.status, wi.type, COALESCE").WithArgs(int64(42), "u1", "matter").
		WillReturnRows(sqlmock.NewRows([]string{"status", "type", "severity", "count"}).AddRow("todo", "task", "", 2))
	mock.ExpectQuery("SELECT wi.status, COUNT\\(\\*\\) FROM work_items wi").WithArgs(int64(42), "matter").
		WillReturnRows(sqlmock.NewRows([]string{"status", "count"}).AddRow("todo", 8))
	mock.ExpectQuery("(?s)SELECT\\s+wi.id.*FROM work_items wi").WithArgs(int64(42), "todo", "u1", "matter", 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{}))
	mock.ExpectCommit()
	response, err := adapter.projectWorkItems(context.Background(), "42", url.Values{
		"current_user": {"u1"}, "current_user_project_admin_project_codes": {"PRJ-1"},
		"view": {"board"}, "status": {"todo"}, "tier": {"matter"}, "quickFilter": {"my_assigned"}, "page": {"1"}, "pageSize": {"20"},
	})
	if err != nil {
		t.Fatal(err)
	}
	page := response.(map[string]any)
	if page["total"] != int64(2) {
		t.Fatalf("filtered count %#v", page)
	}
	wip := page["summary"].(map[string]any)["wipStatus"].(map[string]int64)
	if wip["todo"] != 8 {
		t.Fatalf("WIP count %#v", wip)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectWorkItemAncestorsReturnsFullSameProjectClosure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id,parent_id,item_key,title FROM work_items WHERE project_id=\\? AND id IN").
		WithArgs(int64(42), int64(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_id", "item_key", "title"}).AddRow(2, 1, "W-2", "Parent"))
	mock.ExpectQuery("SELECT id,parent_id,item_key,title FROM work_items WHERE project_id=\\? AND id IN").
		WithArgs(int64(42), int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_id", "item_key", "title"}).AddRow(1, nil, "W-1", "Root"))
	mock.ExpectCommit()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	parent := int64(2)
	ancestors, err := projectWorkItemAncestors(context.Background(), tx, 42, []projectWorkItemRow{{ID: 3, ParentID: &parent}})
	if err != nil {
		t.Fatal(err)
	}
	if len(ancestors) != 2 {
		t.Fatalf("closure = %#v", ancestors)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectWorkItemAncestorsRejectsOutOfProjectParent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id,parent_id,item_key,title FROM work_items WHERE project_id=\\? AND id IN").
		WithArgs(int64(42), int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_id", "item_key", "title"}))
	mock.ExpectRollback()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	parent := int64(9)
	if _, err := projectWorkItemAncestors(context.Background(), tx, 42, []projectWorkItemRow{{ID: 3, ParentID: &parent}}); err == nil {
		t.Fatal("cross-project/missing ancestor accepted")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
