package enterprisescheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type dueTestCandidate struct {
	EventVersion  string `json:"eventVersion"`
	ActionableKey string `json:"actionableKey"`
	Phase         string `json:"phase"`
}

type dueTestClosure struct {
	CheckpointEventVersion string `json:"checkpointEventVersion"`
	RecipientUID           string `json:"recipientUid"`
	NextVersion            string `json:"nextVersion"`
	State                  string `json:"state"`
}

type dueTestPage struct {
	Items    []dueTestCandidate `json:"items"`
	Closures []dueTestClosure   `json:"closures"`
}

func TestSchedulerRegistryMappedDueNotificationMySQL(t *testing.T) {
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
	schema := "hzy_due_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	mapping := map[string]string{}
	schedulerRenamedTables(t, db, string(ddl), mapping, "integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt")
	schedulerCompletionTables(t, db, mapping)
	schedulerRenamedTables(t, db, string(ddl), mapping, aimsapp.EnterpriseDueNotificationViewNames()...)
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
	var dueOnly []string
	for _, name := range aimsapp.EnterpriseDueNotificationViewNames() {
		if !contains(CompletionViewNames(), name) {
			dueOnly = append(dueOnly, name)
		}
	}
	exec("UPDATE enterprise_schema_registry SET generation=0 WHERE id=1")
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", dueOnly)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", dueOnly, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	service, err := New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-aims-worker", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}

	asOf := time.Now().UTC().Truncate(time.Second)
	exec("INSERT INTO u_aims_projects(project_code,name,short_name,leader_uid,created_by) VALUES('P-DUE','Due project','DUE','leader-1','seed')")
	var projectID int64
	if err = db.QueryRow("SELECT id FROM u_aims_projects WHERE project_code='P-DUE'").Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO u_work_items(project_id,item_number,item_key,type,title,status,priority,assignee_uid,due_date) VALUES(?,1,'P-DUE-1','task','Urgent task','todo','P0','leader-1',?)", projectID, asOf.AddDate(0, 0, 1).Format("2006-01-02"))
	var workItemID int64
	if err = db.QueryRow("SELECT id FROM u_work_items WHERE item_key='P-DUE-1'").Scan(&workItemID); err != nil {
		t.Fatal(err)
	}
	checkpoints := func() int {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM u_aims_notification_checkpoint").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	scanBody := func() map[string]any {
		return map[string]any{"stream": "work_item_due", "asOf": asOf.Format(time.RFC3339), "limit": float64(50)}
	}
	scan := func() dueTestPage {
		t.Helper()
		out, err := service.DueNotification(ctx, identity, "scan-due", scanBody())
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatal(err)
		}
		var page dueTestPage
		if err = json.Unmarshal(raw, &page); err != nil {
			t.Fatal(err)
		}
		return page
	}

	bad := identity
	bad.ClientID = "enterprise.runtime"
	if _, err = service.DueNotification(ctx, bad, "scan-due", scanBody()); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("borrowed identity accepted", err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	if _, err = service.DueNotification(ctx, identity, "scan-due", scanBody()); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("stale generation accepted", err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	if n := checkpoints(); n != 0 {
		t.Fatalf("rejected scans wrote %d checkpoints", n)
	}

	page := scan()
	if len(page.Items) != 1 || page.Items[0].Phase != "D1" || page.Items[0].ActionableKey != "aims:work-item:"+itoa(workItemID)+":work_item_due:g1" {
		t.Fatalf("unexpected first scan: %+v", page)
	}
	candidate := page.Items[0]
	if again := scan(); len(again.Items) != 1 || again.Items[0].EventVersion != candidate.EventVersion || checkpoints() != 1 {
		t.Fatalf("rescan was not idempotent: %+v checkpoints=%d", again, checkpoints())
	}

	ack := map[string]any{"eventVersion": candidate.EventVersion, "notificationId": "n-1", "recipientUid": "leader-1"}
	if out, err := service.DueNotification(ctx, identity, "acknowledge", ack); err != nil || out["acknowledged"] != true {
		t.Fatal("acknowledge", out, err)
	}
	if out, err := service.DueNotification(ctx, identity, "acknowledge", ack); err != nil || out["idempotent"] != true {
		t.Fatal("acknowledge replay", out, err)
	}
	conflict := map[string]any{"eventVersion": candidate.EventVersion, "notificationId": "n-2", "recipientUid": "leader-1"}
	var domainError httperror.Error
	if _, err = service.DueNotification(ctx, identity, "acknowledge", conflict); !errors.As(err, &domainError) || domainError.Status != 409 {
		t.Fatal("conflicting acknowledgement accepted", err)
	}
	if after := scan(); len(after.Items) != 0 {
		t.Fatalf("acknowledged candidate still pending: %+v", after)
	}

	// Completing the item closes the condition; the closure is handed back once
	// and its acknowledgement is recorded in the same fenced store.
	exec("UPDATE u_work_items SET status='completed' WHERE id=?", workItemID)
	closed := scan()
	if len(closed.Closures) != 1 || closed.Closures[0].RecipientUID != "leader-1" || closed.Closures[0].State != "resolved" {
		t.Fatalf("closure not produced: %+v", closed)
	}
	closure := closed.Closures[0]
	if out, err := service.DueNotification(ctx, identity, "acknowledge-closure", map[string]any{"eventVersion": closure.CheckpointEventVersion, "nextVersion": closure.NextVersion}); err != nil || out["acknowledged"] != true {
		t.Fatal("closure acknowledge", out, err)
	}
	if final := scan(); len(final.Closures) != 0 || len(final.Items) != 0 {
		t.Fatalf("closure still pending: %+v", final)
	}

	exec("DROP VIEW `aims_notification_checkpoint`")
	domainError = httperror.Error{}
	if _, err = service.DueNotification(ctx, identity, "scan-due", scanBody()); !errors.As(err, &domainError) || domainError.Status != 503 || domainError.Code != "enterprise_due_notification_views_unavailable" {
		t.Fatal("missing view did not fail closed", err)
	}
	t.Log("real Registry generation guard -> fenced due scan/checkpoint/ack/closure; identity and stale generation zero-write, idempotent rescan, ack replay/conflict and missing-view refusal passed")
}

// schedulerRenamedTables creates real Aims DDL, repoints foreign keys at the
// renamed physical tables and records the logical-to-physical mapping.
func schedulerRenamedTables(t *testing.T, db *sql.DB, ddl string, mapping map[string]string, names ...string) {
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
		start := strings.Index(ddl, "CREATE TABLE IF NOT EXISTS `"+name+"` (")
		if start < 0 {
			start = strings.Index(ddl, "CREATE TABLE IF NOT EXISTS "+name+" (")
		}
		if start < 0 {
			t.Fatal("missing real DDL", name)
		}
		end := strings.Index(ddl[start:], ";\n")
		if end < 0 {
			t.Fatal("missing terminator", name)
		}
		statement := ddl[start : start+end]
		for _, parent := range append(append([]string{}, names...), keys(mapping)...) {
			statement = strings.ReplaceAll(statement, "REFERENCES `"+parent+"`", "REFERENCES `u_"+parent+"`")
		}
		run(statement)
		run("RENAME TABLE `" + name + "` TO `u_" + name + "`")
		mapping[name] = "u_" + name
	}
	run("SET FOREIGN_KEY_CHECKS=1")
}

func itoa(v int64) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}
