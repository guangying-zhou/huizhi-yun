package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestCompletionLockOrderCanonicalAndCopiesIDs(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	m.ExpectBegin()
	tx, _ := db.Begin()
	a := Resolved{DB: db, Domain: "aims", Generation: 1, tables: map[string]string{"aims_projects": "aims_projects", "work_items": "work_items", "work_item_completion_requests": "work_item_completion_requests"}}
	w := Resolved{DB: db, Domain: "workflow", Generation: 1, tables: map[string]string{"flow_instances": "flow_instances", "flow_tasks": "flow_tasks", "flow_actions": "flow_actions"}}
	ids := CompletionLocks{ProjectID: 1, WorkItemIDs: []int64{3, 2, 3}, RequestIDs: []int64{4}, InstanceID: 5, TaskIDs: []int64{7, 6}, ActionIDs: []int64{8}}
	for _, x := range []struct {
		table string
		id    int64
	}{{"aims_projects", 1}, {"work_items", 2}, {"work_items", 3}, {"work_item_completion_requests", 4}, {"flow_instances", 5}, {"flow_tasks", 6}, {"flow_tasks", 7}, {"flow_actions", 8}} {
		m.ExpectQuery("SELECT id FROM `" + x.table + "`").WithArgs(x.id).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(x.id))
	}
	if err := LockCompletionObjects(context.Background(), tx, a, w, ids); err != nil {
		t.Fatal(err)
	}
	if ids.WorkItemIDs[0] != 3 {
		t.Fatal("caller slice mutated")
	}
	m.ExpectRollback()
	_ = tx.Rollback()
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionLockMissingRowReturnsSafeSentinel(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	m.ExpectBegin()
	tx, _ := db.Begin()
	a := Resolved{DB: db, Domain: "aims", Generation: 1, tables: map[string]string{"aims_projects": "aims_projects"}}
	w := Resolved{DB: db, Domain: "workflow", Generation: 1}
	m.ExpectQuery("SELECT id FROM `aims_projects`").WithArgs(int64(1)).WillReturnError(sql.ErrNoRows)
	err := LockCompletionObjects(context.Background(), tx, a, w, CompletionLocks{ProjectID: 1})
	if !errors.Is(err, ErrCompletionObjectMissing) || errors.Is(err, sql.ErrNoRows) {
		t.Fatal("missing row not mapped to safe sentinel", err)
	}
	m.ExpectRollback()
	tx.Rollback()
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
