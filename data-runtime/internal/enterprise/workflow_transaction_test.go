package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWorkflowDualTransactionMissingPhysicalTableRollsBackBeforeBusiness(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
	b := fixture("one")
	delete(b.Domains, "assets")
	b.Domains["aims"] = DomainBinding{OwnerDeployment: "enterprise", Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled, Tables: map[string]string{"work_items": "work_items", "unused": "aims_unused"}}
	b.Domains["workflow"] = DomainBinding{OwnerDeployment: "workflow", Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled, Tables: map[string]string{"flow_tasks": "flow_tasks", "unused_wf": "workflow_unused"}}
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	a, w := request(b, "aims"), request(b, "workflow")
	a.Operation = Write
	w.Operation = Write
	m.ExpectBegin()
	m.ExpectQuery("FROM enterprise_schema_registry").WillReturnRows(sqlmock.NewRows([]string{"tenant", "env", "deployment", "schema", "gen"}).AddRow(b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, b.Generation))
	m.ExpectQuery("SELECT DATABASE").WillReturnRows(sqlmock.NewRows([]string{"database"}).AddRow(b.Storage.Database))
	m.ExpectQuery("SELECT ENGINE").WithArgs(b.Storage.Database, "work_items").WillReturnRows(sqlmock.NewRows([]string{"ENGINE"}).AddRow("InnoDB"))
	m.ExpectQuery("SELECT DATABASE").WillReturnRows(sqlmock.NewRows([]string{"database"}).AddRow(b.Storage.Database))
	m.ExpectQuery("SELECT ENGINE").WithArgs(b.Storage.Database, "flow_tasks").WillReturnError(sql.ErrNoRows)
	m.ExpectRollback()
	if tx, rs, err := r.BeginWorkflowWriteTransaction(context.Background(), b, a, w, WorkflowTransactionRequirements{Aims: []string{"work_items"}, Workflow: []string{"flow_tasks"}}); err == nil || tx != nil || rs != nil {
		t.Fatal("missing installation allowed business", err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowUnifiedAtomicAndLockOrderMySQL(t *testing.T) {
	socket := os.Getenv("HZY_AIMS_WORKFLOW_UNIFIED_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.MultiStatements = true
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "wf_atomic_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if _, err = root.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + name + "`")
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := Binding{Key: BindingKey{"isolated", "test", "runtime"}, Storage: Storage{instance, "127.0.0.1:3306", name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]DomainBinding{}}
	aTables := map[string]string{"aims_projects": "aims_projects", "work_items": "aims_work_items", "work_item_completion_requests": "aims_work_item_completion_requests", "service_command_receipt": "aims_service_command_receipt"}
	wTables := map[string]string{"flow_instances": "workflow_flow_instances", "flow_tasks": "workflow_flow_tasks", "flow_actions": "workflow_flow_actions", "service_command_receipt": "workflow_service_command_receipt"}
	b.Domains["aims"] = DomainBinding{"enterprise", aTables, PathUnified, PathUnified, PathDisabled}
	b.Domains["workflow"] = DomainBinding{"workflow", wTables, PathUnified, PathUnified, PathDisabled}
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(30),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB`)
	mustExec(`INSERT INTO enterprise_schema_registry VALUES(1,'isolated','test','runtime','v1',0)`)
	for _, tables := range []map[string]string{aTables, wTables} {
		for logical, physical := range tables {
			if logical == "service_command_receipt" {
				continue
			}
			mustExec("CREATE TABLE `" + physical + "`(id BIGINT PRIMARY KEY,note VARCHAR(30)) ENGINE=InnoDB")
			mustExec("INSERT INTO `" + physical + "` VALUES(1,'before')")
		}
	}
	raw, err := os.ReadFile("../../../workflow/docs/workflow_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(raw), "CREATE TABLE IF NOT EXISTS service_command_receipt (")
	if start < 0 {
		t.Fatal("receipt DDL missing")
	}
	ddl := string(raw)[start:]
	ddl = ddl[:strings.Index(ddl, ";")+1]
	for _, physical := range []string{"aims_service_command_receipt", "workflow_service_command_receipt"} {
		mustExec(strings.ReplaceAll(strings.Replace(ddl, "service_command_receipt (", "`"+physical+"` (", 1), "chk_scr_", physical+"_chk_"))
	}
	// Use the production view planner/installer on a generation-zero fixture.
	for domain, d := range b.Domains {
		var names []string
		for logical, physical := range d.Tables {
			if logical != "service_command_receipt" && logical != physical {
				names = append(names, logical)
			}
		}
		p, err := PlanCompatibilityViews(context.Background(), db, b, domain, names)
		if err != nil {
			t.Fatal(err)
		}
		if err = ApplyCompatibilityViews(context.Background(), db, b, domain, names, p.ReviewHash); err != nil {
			t.Fatal(err)
		}
	}
	mustExec("UPDATE enterprise_schema_registry SET generation=1")
	r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
	if err = r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	a, w := request(b, "aims"), request(b, "workflow")
	a.Operation = Write
	w.Operation = Write
	begin := func() (*sql.Tx, []Resolved) {
		t.Helper()
		tx, rs, err := r.BeginWorkflowWriteTransaction(context.Background(), b, a, w, WorkflowTransactionRequirements{Aims: []string{"aims_projects", "work_items", "work_item_completion_requests"}, Workflow: []string{"flow_instances", "flow_tasks", "flow_actions"}})
		if err != nil {
			t.Fatal(err)
		}
		return tx, rs
	}
	tx, rs := begin()
	if err = LockCompletionObjects(context.Background(), tx, rs[0], rs[1], CompletionLocks{ProjectID: 1, WorkItemIDs: []int64{1}, RequestIDs: []int64{1}, InstanceID: 1, TaskIDs: []int64{1}, ActionIDs: []int64{1}}); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE aims_projects SET note='changed' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE workflow_flow_instances SET note='changed' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"aims_projects", "workflow_flow_instances"} {
		var note string
		if err = db.QueryRow("SELECT note FROM `" + table + "` WHERE id=1").Scan(&note); err != nil || note != "before" {
			t.Fatal("cross-domain rollback failed", note, err)
		}
	}
	// Reverse input order is canonicalized by the shared lock helper. Both
	// concurrent callers acquire identical locks, without an AB/BA deadlock.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			tx, rs, err := r.BeginWorkflowWriteTransaction(ctx, b, a, w, WorkflowTransactionRequirements{Aims: []string{"aims_projects", "work_items", "work_item_completion_requests"}, Workflow: []string{"flow_instances", "flow_tasks", "flow_actions"}})
			if err != nil {
				errs <- err
				return
			}
			defer tx.Rollback()
			err = LockCompletionObjects(ctx, tx, rs[0], rs[1], CompletionLocks{ProjectID: 1, WorkItemIDs: []int64{1, 1}, InstanceID: 1, TaskIDs: []int64{1}})
			if err == nil {
				err = tx.Commit()
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("concurrent canonical lock", err)
		}
	}
	t.Run("view-FOR-UPDATE-locks-physical-row", func(t *testing.T) {
		viewTx, _, err := r.BeginWorkflowWriteTransaction(context.Background(), b, a, w, WorkflowTransactionRequirements{Aims: []string{"work_items"}, Workflow: []string{"flow_tasks"}})
		if err != nil {
			t.Fatal(err)
		}
		defer viewTx.Rollback()
		var id int64
		if err = viewTx.QueryRow("SELECT id FROM flow_tasks WHERE id=1 FOR UPDATE").Scan(&id); err != nil || id != 1 {
			t.Fatal("view lock", err)
		}
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if _, err = conn.ExecContext(context.Background(), "SET SESSION innodb_lock_wait_timeout=1"); err != nil {
			t.Fatal(err)
		}
		_, err = conn.ExecContext(context.Background(), "UPDATE workflow_flow_tasks SET note='must-not-pass-lock' WHERE id=1")
		var mysqlErr *mysql.MySQLError
		if !errors.As(err, &mysqlErr) || mysqlErr.Number != 1205 {
			t.Fatal("bottom row was not locked by view", err)
		}
		if err = viewTx.Rollback(); err != nil {
			t.Fatal(err)
		}
		if _, err = conn.ExecContext(context.Background(), "UPDATE workflow_flow_tasks SET note='after-view-release' WHERE id=1"); err != nil {
			t.Fatal("lock not released", err)
		}
	})
	mustExec("DROP VIEW flow_tasks")
	if tx, rs, err := r.BeginWorkflowWriteTransaction(context.Background(), b, a, w, WorkflowTransactionRequirements{Aims: []string{"aims_projects", "work_items", "work_item_completion_requests"}, Workflow: []string{"flow_instances", "flow_tasks", "flow_actions"}}); err == nil || tx != nil || rs != nil {
		t.Fatal("missing view did not fail closed")
	}
}

func TestWorkflowDualTransactionRejectsUnknownLogicalCollision(t *testing.T) {
	db, m, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	b := fixture("one")
	delete(b.Domains, "assets")
	b.Domains["aims"] = DomainBinding{OwnerDeployment: "enterprise", Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled, Tables: map[string]string{"unknown_name": "aims_unknown"}}
	b.Domains["workflow"] = DomainBinding{OwnerDeployment: "workflow", Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled, Tables: map[string]string{"unknown_name": "workflow_unknown"}}
	r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	a, w := request(b, "aims"), request(b, "workflow")
	a.Operation = Write
	w.Operation = Write
	m.ExpectBegin()
	m.ExpectQuery("FROM enterprise_schema_registry").WillReturnRows(sqlmock.NewRows([]string{"tenant", "env", "deployment", "schema", "gen"}).AddRow(b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, b.Generation))
	m.ExpectRollback()
	if tx, rs, err := r.BeginWorkflowWriteTransaction(context.Background(), b, a, w, WorkflowTransactionRequirements{Aims: []string{"unknown_name"}, Workflow: []string{"unknown_name"}}); err == nil || tx != nil || rs != nil {
		t.Fatal("unregistered logical collision skipped view validation", err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowDualTransactionRequiresExplicitNarrowSets(t *testing.T) {
	r := NewRegistry(nil)
	a, w := ResolveRequest{Domain: "aims", Operation: Write}, ResolveRequest{Domain: "workflow", Operation: Write}
	for _, requirements := range []WorkflowTransactionRequirements{{}, {Aims: []string{"work_items"}}, {Workflow: []string{"flow_tasks"}}} {
		if tx, rs, err := r.BeginWorkflowWriteTransaction(context.Background(), Binding{}, a, w, requirements); err == nil || tx != nil || rs != nil {
			t.Fatal("missing lane set accepted")
		}
	}
}
