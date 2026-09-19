package enterprisescheduler

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestSchedulerRegistryMappedMilestoneRolloverMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_SCHEDULER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "hzy_rollover_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(q, err)
		}
	}
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	createRenamed := func(mapping map[string]string, names ...string) {
		t.Helper()
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		run := func(q string) {
			t.Helper()
			if _, err := conn.ExecContext(context.Background(), q); err != nil {
				t.Fatal(q, err)
			}
		}
		run("SET FOREIGN_KEY_CHECKS=0")
		for _, name := range names {
			if _, done := mapping[name]; done {
				continue
			}
			start := strings.Index(string(ddl), "CREATE TABLE IF NOT EXISTS `"+name+"` (")
			if start < 0 {
				start = strings.Index(string(ddl), "CREATE TABLE IF NOT EXISTS "+name+" (")
			}
			if start < 0 {
				t.Fatal("missing real DDL", name)
			}
			end := strings.Index(string(ddl)[start:], ";\n")
			if end < 0 {
				t.Fatal("missing terminator", name)
			}
			statement := string(ddl)[start : start+end]
			// Parents may already be renamed physical tables behind views; point
			// the fixture's foreign keys at the physical names, as the copy does.
			for _, parent := range append(append([]string{}, names...), keys(mapping)...) {
				statement = strings.ReplaceAll(statement, "REFERENCES `"+parent+"`", "REFERENCES `u_"+parent+"`")
			}
			run(statement)
			run("RENAME TABLE `" + name + "` TO `u_" + name + "`")
			mapping[name] = "u_" + name
		}
		run("SET FOREIGN_KEY_CHECKS=1")
	}

	mapping := map[string]string{}
	createRenamed(mapping, "integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt")
	schedulerCompletionTables(t, db, mapping)
	createRenamed(mapping, aimsapp.EnterpriseMilestoneRolloverViewNames()...)
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',1)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	q := e.ResolveRequest{Key: b.Key, Domain: "aims", OwnerDeployment: "aims-owner", SchemaVersion: "v1", Generation: 1, Operation: e.Scheduler}
	resolved, err := registry.Resolve(q)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(q, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	schedulerCompletionViews(t, db, b)
	// Views are installed while the persistent generation is parked, exactly as
	// a controlled migration does; request transactions never perform DDL.
	var rolloverOnly []string
	for _, name := range aimsapp.EnterpriseMilestoneRolloverViewNames() {
		if !contains(CompletionViewNames(), name) {
			rolloverOnly = append(rolloverOnly, name)
		}
	}
	exec("UPDATE enterprise_schema_registry SET generation=0 WHERE id=1")
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", rolloverOnly)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", rolloverOnly, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	service, err := New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-aims-worker", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}

	exec("INSERT INTO u_aims_projects(project_code,name,short_name,leader_uid,created_by) VALUES('P-ROLL','Rollover project','ROLL','leader-1','seed')")
	var projectID int64
	if err = db.QueryRow("SELECT id FROM u_aims_projects WHERE project_code='P-ROLL'").Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO u_milestones(project_id,name,mode,start_date,end_date,status,template_key,recurrence_rule,created_by) VALUES(?,'2026-08','periodic',DATE_SUB(CURDATE(),INTERVAL 1 MONTH),DATE_SUB(CURDATE(),INTERVAL 1 DAY),'active','ops-monthly','monthly','seed')", projectID)
	var sourceID int64
	if err = db.QueryRow("SELECT id FROM u_milestones WHERE project_id=?", projectID).Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	counts := func() (milestones, snapshots int, sourceStatus string) {
		t.Helper()
		if err := db.QueryRow("SELECT COUNT(*) FROM u_milestones").Scan(&milestones); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM u_milestone_cycle_snapshots").Scan(&snapshots); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT status FROM u_milestones WHERE id=?", sourceID).Scan(&sourceStatus); err != nil {
			t.Fatal(err)
		}
		return
	}
	assertUntouched := func(stage string) {
		t.Helper()
		if m, s, status := counts(); m != 1 || s != 0 || status != "active" {
			t.Fatalf("%s mutated rollover facts: milestones=%d snapshots=%d status=%s", stage, m, s, status)
		}
	}

	// A borrowed identity is rejected before any transaction.
	bad := identity
	bad.ClientID = "enterprise.runtime"
	if _, err = service.RolloverDueMilestones(ctx, bad, 100, "auto"); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("borrowed identity accepted", err)
	}
	assertUntouched("borrowed identity")

	// The persistent generation is authoritative even with a valid process registry.
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	if _, err = service.RolloverDueMilestones(ctx, identity, 100, "auto"); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("stale generation accepted", err)
	}
	assertUntouched("stale generation")
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")

	out, err := service.RolloverDueMilestones(ctx, identity, 100, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if out["scanned"] != 1 || out["rolled_over"] != 1 || out["pending"] != 0 || out["failed"] != 0 {
		t.Fatalf("unexpected rollover result: %+v", out)
	}
	m, s, status := counts()
	if m != 2 || s != 1 || status != "completed" {
		t.Fatalf("rollover not committed: milestones=%d snapshots=%d status=%s", m, s, status)
	}
	var snapshotActor, idempotencyKey string
	if err = db.QueryRow("SELECT COALESCE(actor_uid,''),idempotency_key FROM u_milestone_cycle_snapshots WHERE source_milestone_id=?", sourceID).Scan(&snapshotActor, &idempotencyKey); err != nil {
		t.Fatal(err)
	}
	if snapshotActor != "system" || !strings.HasPrefix(idempotencyKey, "aims:milestone:P-ROLL:ops-monthly:") {
		t.Fatalf("snapshot evidence: actor=%q key=%q", snapshotActor, idempotencyKey)
	}

	// The next period is not yet due and the source is completed: a rerun is a no-op.
	again, err := service.RolloverDueMilestones(ctx, identity, 100, "auto")
	if err != nil || again["scanned"] != 0 {
		t.Fatalf("rerun was not idempotent: %+v %v", again, err)
	}
	if m, s, _ := counts(); m != 2 || s != 1 {
		t.Fatalf("rerun wrote again: milestones=%d snapshots=%d", m, s)
	}

	// A missing compatibility view fails this entry point instead of reading another store.
	exec("DROP VIEW `milestone_cycle_snapshots`")
	_, err = service.RolloverDueMilestones(ctx, identity, 100, "auto")
	var domainError httperror.Error
	if !errors.As(err, &domainError) || domainError.Status != 503 || domainError.Code != "enterprise_milestone_rollover_views_unavailable" {
		t.Fatal("missing view did not fail closed", err)
	}
	t.Log("real Registry generation guard -> mapped scheduler transactions -> committed rollover with fixed system actor; identity/stale generation rejection, idempotent rerun and missing-view refusal passed")
}

func keys(values map[string]string) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	return out
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
