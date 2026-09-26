package enterprisescheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSchedulerRegistryMappedClaimMySQL(t *testing.T) {
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
	schema := "hzy_scheduler_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
			t.Fatal(err)
		}
	}
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	mapping := map[string]string{}
	var renames []string
	for _, name := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt"} {
		marker := "CREATE TABLE IF NOT EXISTS " + name + " ("
		start := strings.Index(string(ddl), marker)
		if start < 0 {
			t.Fatal(name)
		}
		end := strings.Index(string(ddl)[start:], ";\n")
		if end < 0 {
			t.Fatal("DDL terminator")
		}
		exec(string(ddl)[start : start+end])
		mapping[name] = "u_" + name
		renames = append(renames, "`"+name+"` TO `u_"+name+"`")
	}
	exec("RENAME TABLE " + strings.Join(renames, ","))
	schedulerCompletionTables(t, db, mapping)
	// No compatibility view: a conflicting logical table must remain untouched.
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',1)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	register := func(binding e.Binding) *e.Registry {
		t.Helper()
		r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
		if err := r.Register(ctx, binding); err != nil {
			t.Fatal(err)
		}
		return r
	}
	registry := register(b)
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
	service, err := New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-aims-worker", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}
	now := time.Now().UTC().Truncate(time.Millisecond)
	insert := func(table, tenant, deployment, key string) string {
		t.Helper()
		id := uuid.NewString()
		command := json.RawMessage(`{"assetCode":"ASSET-1"}`)
		digest, err := io.ValidateAndDigestCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		exec("INSERT INTO "+table+"(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at) VALUES(?,?,?,?,?,'aims','assets','assets.delivery.link_document.v1','assets.delivery.write','request','R-1',?,?,?,?)", id, key, key, tenant, deployment, key, string(command), digest, now)
		return id
	}
	id := insert("u_integration_operation", "tenant-a", "real-aims-worker", "key-1")
	insert("u_integration_operation", "tenant-b", "real-aims-worker", "other-tenant")
	insert("u_integration_operation", "tenant-a", "other-worker-deployment", "other-deployment")
	insert("integration_operation", "tenant-a", "real-aims-worker", "decoy")
	assertUntouched := func() {
		t.Helper()
		var n int
		for _, query := range []string{"SELECT COUNT(*) FROM u_integration_operation WHERE status<>'pending'", "SELECT COUNT(*) FROM u_integration_operation_attempt"} {
			if err = db.QueryRow(query).Scan(&n); err != nil || n != 0 {
				t.Fatal("unauthorized claim mutation", query, n, err)
			}
		}
	}
	for name, mutate := range map[string]func(*e.SchedulerIdentity){
		"tenant": func(i *e.SchedulerIdentity) { i.Tenant = "tenant-b" }, "deployment": func(i *e.SchedulerIdentity) { i.Deployment = "runtime-a" }, "source": func(i *e.SchedulerIdentity) { i.SourceApp = "enterprise" }, "client": func(i *e.SchedulerIdentity) { i.ClientID = "enterprise.runtime" }, "subject": func(i *e.SchedulerIdentity) { i.Subject = "other" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := identity
			mutate(&bad)
			if _, err := service.Claim(ctx, bad, "", "worker-1", now, time.Minute); !errors.Is(err, e.ErrBindingMismatch) {
				t.Fatal(err)
			}
			assertUntouched()
		})
	}
	// Unified writes are insufficient: scheduler path is independently controlled.
	disabled := b
	disabled.Domains = map[string]e.DomainBinding{"aims": b.Domains["aims"]}
	domain := disabled.Domains["aims"]
	domain.Scheduler = e.PathDisabled
	disabled.Domains["aims"] = domain
	if _, err = New(register(disabled), disabled, source); !errors.Is(err, e.ErrPathDisabled) {
		t.Fatal("disabled scheduler accepted", err)
	}
	// Same identity/generation with a different registered table cannot reuse source.
	altered := b
	altered.Domains = map[string]e.DomainBinding{"aims": b.Domains["aims"]}
	domain = altered.Domains["aims"]
	domain.Tables = map[string]string{}
	for k, v := range mapping {
		domain.Tables[k] = v
	}
	domain.Tables["integration_operation"] = "integration_operation"
	altered.Domains["aims"] = domain
	if _, err = New(register(altered), altered, source); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("foreign source mapping accepted", err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=2")
	if _, err = service.Claim(ctx, identity, "key-1", "worker-1", now, time.Minute); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("stale generation accepted", err)
	}
	assertUntouched()
	// Persistent fence remains authoritative even when the process registry is valid.
	exec("UPDATE enterprise_schema_registry SET generation=1")
	if _, err = service.Claim(ctx, identity, "key-1", "", now, time.Minute); err == nil {
		t.Fatal("empty worker accepted")
	}
	assertUntouched()
	// Failure after the operation lease UPDATE must roll back the lease too.
	exec("CREATE TRIGGER scheduler_attempt_failure BEFORE INSERT ON u_integration_operation_attempt FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='attempt rejected'")
	if out, err := service.Claim(ctx, identity, "key-1", "worker-1", now, time.Minute); err == nil || out != nil {
		t.Fatal("failed transaction returned lease", out, err)
	}
	assertUntouched()
	exec("DROP TRIGGER scheduler_attempt_failure")
	claim, err := service.Claim(ctx, identity, "key-1", "worker-1", now, time.Minute)
	if err != nil || claim == nil || claim.OperationID != id {
		t.Fatal(claim, err)
	}
	// A distinct connection observes committed lease/attempt before Claim returns.
	observer, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	var status string
	var firstVersion, recoveredVersion, storedFence uint64
	var n int
	if err = observer.QueryRow("SELECT status,version_no,fencing_token FROM u_integration_operation WHERE operation_id=?", id).Scan(&status, &firstVersion, &storedFence); err != nil || status != "processing" || storedFence != claim.FencingToken {
		t.Fatal("lease not committed", status, err)
	}
	if err = observer.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt WHERE operation_id=?", id).Scan(&n); err != nil || n != 1 {
		t.Fatal("attempt not committed", n, err)
	}
	if next, err := service.Claim(ctx, identity, "", "worker-2", now.Add(time.Second), time.Minute); err != nil || next != nil {
		t.Fatal("leased or other tenant/deployment/legacy task claimed", next, err)
	}
	recovered, err := service.Claim(ctx, identity, "", "worker-2", now.Add(2*time.Minute), time.Minute)
	if err != nil || recovered == nil || recovered.OperationID != id || recovered.FencingToken <= claim.FencingToken {
		t.Fatal("lease recovery", recovered, err)
	}
	if err = observer.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt WHERE operation_id=?", id).Scan(&n); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	if err = observer.QueryRow("SELECT version_no,fencing_token FROM u_integration_operation WHERE operation_id=?", id).Scan(&recoveredVersion, &storedFence); err != nil || recoveredVersion <= firstVersion || storedFence != recovered.FencingToken {
		t.Fatal("old operation version/fence was not advanced", firstVersion, recoveredVersion, storedFence, err)
	}
	var priorAttemptStatus, priorAttemptError string
	if err = observer.QueryRow("SELECT result_status,error_code FROM u_integration_operation_attempt WHERE operation_id=? AND attempt_no=1", id).Scan(&priorAttemptStatus, &priorAttemptError); err != nil || priorAttemptStatus != "partial_unknown" || priorAttemptError != "lease_expired" {
		t.Fatal("expired old lease was not classified", priorAttemptStatus, priorAttemptError, err)
	}
	for _, query := range []string{"SELECT COUNT(*) FROM integration_operation WHERE status<>'pending'", "SELECT COUNT(*) FROM u_integration_operation WHERE operation_id<>'" + id + "' AND status<>'pending'"} {
		if err = observer.QueryRow(query).Scan(&n); err != nil || n != 0 {
			t.Fatal("mapping/scope leaked", n, err)
		}
	}
	exec("UPDATE enterprise_schema_registry SET generation=2")
	if _, err = service.Claim(ctx, identity, "", "worker-3", now.Add(4*time.Minute), time.Minute); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("old generation recovered lease", err)
	}
	if err = observer.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt WHERE operation_id=?", id).Scan(&n); err != nil || n != 2 {
		t.Fatal("stale generation mutated attempt", n, err)
	}
	t.Log("real Registry generation guard -> mapped shared transaction claim -> committed lease; identity/path/source/table/tenant/deployment rejection and lease recovery passed")
}
