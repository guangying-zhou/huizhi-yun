package lane

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	d "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestLaneCapsuleCannotBeIssuedWithoutRegisteredTransaction(t *testing.T) {
	if h, err := OpenDecision(context.Background(), nil, e.Binding{}, e.CompletionLocks{}, e.WorkflowTransactionRequirements{}, d.WorkflowEmployees{}); h != nil || !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal(h, err)
	}
	var h *transaction
	if tx, _, err := h.AimsTransaction(); tx != nil || err == nil {
		t.Fatal("nil capsule")
	}
	if tx, _, err := h.WorkflowTransaction(); tx != nil || err == nil {
		t.Fatal("nil capsule")
	}
	if h.Employee("any") {
		t.Fatal("nil employee")
	}
	if _, ok := FromContext(context.Background()); ok {
		t.Fatal("forged empty context")
	}
}

// An in-memory Registry with a SQL driver double exercises the real Open,
// including schema-version resolution, persistent fence, installation and locks.
func TestLaneOpenRegisteredDualDomainPositive(t *testing.T) {
	db, m, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	binding := e.Binding{Key: e.BindingKey{Tenant: "T", Environment: "test", RuntimeDeployment: "R"}, Storage: e.Storage{InstanceID: "mysql", Address: "127.0.0.1:3306", Database: "business"}, SchemaVersion: "v1", Generation: 7, Domains: map[string]e.DomainBinding{
		"aims":     {OwnerDeployment: "A", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled, Tables: map[string]string{"aims_projects": "aims_projects", "work_items": "work_items"}},
		"workflow": {OwnerDeployment: "W", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled, Tables: map[string]string{"flow_tasks": "flow_tasks"}}}}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	m.ExpectBegin()
	m.ExpectQuery("FROM enterprise_schema_registry").WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "version", "generation"}).AddRow("T", "test", "R", "v1", 7))
	for _, tables := range [][]string{{"aims_projects", "work_items"}, {"flow_tasks"}} {
		m.ExpectQuery("SELECT DATABASE").WillReturnRows(sqlmock.NewRows([]string{"db"}).AddRow("business"))
		for _, table := range tables {
			m.ExpectQuery("SELECT ENGINE").WithArgs("business", table).WillReturnRows(sqlmock.NewRows([]string{"ENGINE"}).AddRow("InnoDB"))
		}
	}
	m.ExpectQuery("SELECT id FROM `aims_projects` WHERE id").WithArgs(int64(1)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	m.ExpectQuery("SELECT id FROM `work_items` WHERE id").WithArgs(int64(2)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(2))
	h, err := OpenDecision(context.Background(), registry, binding, e.CompletionLocks{ProjectID: 1, WorkItemIDs: []int64{2}}, e.WorkflowTransactionRequirements{Aims: []string{"aims_projects", "work_items"}, Workflow: []string{"flow_tasks"}}, d.WorkflowEmployees{})
	if err != nil {
		t.Fatal(err)
	}
	atx, ars, err := h.AimsTransaction()
	if err != nil {
		t.Fatal(err)
	}
	wtx, wrs, err := h.WorkflowTransaction()
	if err != nil || atx != wtx || ars.SchemaVersion != "v1" || wrs.Generation != 7 {
		t.Fatal(ars, wrs, err)
	}
	if got, ok := FromContext(Context(context.Background(), h)); !ok || got != h {
		t.Fatal("capsule context")
	}
	m.ExpectCommit()
	if err = h.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestLaneRequestRejectsMissingDirectorySnapshotBeforeTransaction(t *testing.T) {
	_, err := OpenRequest(context.Background(), nil, e.Binding{}, e.CompletionLocks{}, e.WorkflowTransactionRequirements{}, d.WorkflowInitiatorSnapshot{}, d.WorkflowEmployees{})
	var http httperror.Error
	if !errors.As(err, &http) || http.Status != 503 {
		t.Fatal(err)
	}
}
