package domaininstall

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
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

func fixture(db, instance string) enterprise.Binding {
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "c000001-test-tenant-runtime"}, Storage: enterprise.Storage{Database: db, InstanceID: instance, Address: "127.0.0.1:3306"}, SchemaVersion: "v1", Generation: 7, Domains: map[string]enterprise.DomainBinding{}}
	b.Domains["aims"] = enterprise.DomainBinding{OwnerDeployment: "C000001-test-aims", Tables: map[string]string{"projects": "aims_projects"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled}
	d := enterprise.DomainBinding{OwnerDeployment: "C000001-test-enterprise", Tables: map[string]string{}, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	for _, v := range tables() {
		d.Tables[v.Logical] = v.Physical
	}
	b.Domains["altoc"] = d
	return b
}
func TestManifestAndReviewBoundary(t *testing.T) {
	b := fixture("isolated", "instance")
	if err := validate(b); err != nil {
		t.Fatal(err)
	}
	p := expected(b)
	p.Baseline = "hash"
	p.ReviewHash = hash(p)
	if err := reviewed(p); err != nil {
		t.Fatal(err)
	}
	p.Tables[0].DDL += " DROP TABLE aims_projects"
	if reviewed(p) == nil {
		t.Fatal("DDL tamper accepted")
	}
	b = fixture("isolated", "instance")
	b.Generation = 0
	if validate(b) == nil {
		t.Fatal("zero generation accepted")
	}
	b = fixture("isolated", "instance")
	d := b.Domains["aims"]
	d.Tables["customer"] = "aims_customer"
	b.Domains["aims"] = d
	if validate(b) == nil {
		t.Fatal("name collision accepted")
	}
}
func TestActivatedDomainInstallMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
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
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_domain_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT)")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','c000001-test-tenant-runtime','v1',7)")
	exec("CREATE TABLE aims_projects(id INT PRIMARY KEY,name VARCHAR(100))")
	exec("INSERT INTO aims_projects VALUES(263,'existing')")
	exec("CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW projects AS SELECT id,name FROM aims_projects")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := fixture(name, instance)
	locker, e := root.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	release, e := migrationlock.Acquire(ctx, locker, instance, name)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = PlanInstall(ctx, db, b); e == nil {
		t.Fatal("competing migration lock accepted")
	}
	release()
	locker.Close()
	p, err := PlanInstall(ctx, db, b)
	if err != nil {
		t.Fatal(err)
	}
	var receipt Receipt
	save := func(r Receipt) error { receipt = r; return nil }
	off := func(context.Context) error { return nil }
	if err = Apply(ctx, db, p, func(context.Context) error { return errors.New("running") }, save); err == nil {
		t.Fatal("running Runtime accepted")
	}
	if err = Apply(ctx, db, p, off, save); err != nil {
		t.Fatal(err)
	}
	exec("ALTER TABLE altoc_customer MODIFY name VARCHAR(201) NOT NULL")
	if err = VerifyReceipt(ctx, db, receipt); err == nil {
		t.Fatal("schema drift accepted")
	}
	if err = Rollback(ctx, db, receipt, off); err == nil {
		t.Fatal("rollback dropped altered table")
	}
	exec("ALTER TABLE altoc_customer MODIFY name VARCHAR(200) NOT NULL COMMENT '客户名称'")
	if len(receipt.Created) != 26 {
		t.Fatal("incomplete checkpoint")
	}
	if err = VerifyReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = PlanInstall(ctx, db, b); err == nil {
		t.Fatal("existing tables accepted")
	}
	if err = Apply(ctx, db, p, off, save); err == nil {
		t.Fatal("repeat overwrote objects")
	}
	exec("INSERT INTO altoc_customer(code,name,owner_user_id) VALUES('ZZ-TEST-ALTOC','marker','zhou')")
	if err = VerifyReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	if err = Rollback(ctx, db, receipt, off); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=8 WHERE id=1")
	if _, err = PlanInstall(ctx, db, b); err == nil {
		t.Fatal("generation drift accepted")
	}
	exec("UPDATE enterprise_schema_registry SET generation=7 WHERE id=1")
	after, err := PlanInstall(ctx, db, b)
	if err != nil || after.ReviewHash != p.ReviewHash {
		t.Fatal("rollback changed existing facts", err)
	}
	exec("UPDATE aims_projects SET name='changed' WHERE id=263")
	if err = Apply(ctx, db, p, off, save); err == nil {
		t.Fatal("baseline drift accepted")
	}
	exec("UPDATE aims_projects SET name='existing' WHERE id=263")
	// Interrupted DDL stays stopped and explicit recovery drops only recorded objects.
	calls := 0
	interrupted := func(context.Context) error {
		calls++
		if calls > 4 {
			return errors.New("runtime restarted")
		}
		return nil
	}
	if err = Apply(ctx, db, p, interrupted, save); err == nil {
		t.Fatal("Runtime restart ignored")
	}
	if len(receipt.Created) == 0 || len(receipt.Created) >= 26 {
		t.Fatal("wrong partial receipt")
	}
	if err = Rollback(ctx, db, receipt, off); err != nil {
		t.Fatal(err)
	}
	if _, err = PlanInstall(ctx, db, b); err != nil {
		t.Fatal(err)
	}
}

func TestDeletionEvidenceFixedManifest(t *testing.T) {
	b := fixture("isolated", "instance")
	d := b.Domains["aims"]
	d.OwnerDeployment = "C000001-test-enterprise"
	d.Scheduler = enterprise.PathUnified
	d.Tables["work_item_deletion_evidence"] = "aims_work_item_deletion_evidence"
	b.Domains["aims"] = d
	if err := deletionInstaller.validate(b); err != nil {
		t.Fatal(err)
	}
	p := deletionInstaller.expected(b)
	if len(p.Tables) != 1 || len(p.Views) != 1 || len(p.Tables[0].Columns) != 13 {
		t.Fatal("non-fixed evidence installation")
	}
	p.Baseline = "baseline"
	p.ReviewHash = hash(p)
	if err := deletionInstaller.reviewed(p); err != nil {
		t.Fatal(err)
	}
	if altocInstaller.reviewed(p) == nil {
		t.Fatal("wrong installation lane accepted")
	}
	p.Tables[0].DDL += " DROP TABLE aims_projects"
	if deletionInstaller.reviewed(p) == nil {
		t.Fatal("DDL tamper accepted")
	}
	b.Generation = 0
	if deletionInstaller.validate(b) == nil {
		t.Fatal("zero generation accepted")
	}
}

func TestDeletionEvidenceInstallMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
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
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_domain_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT)")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','c000001-test-tenant-runtime','v1',7)")
	exec("CREATE TABLE aims_projects(id INT PRIMARY KEY,name VARCHAR(100))")
	exec("INSERT INTO aims_projects VALUES(263,'existing')")
	exec("CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW projects AS SELECT id,name FROM aims_projects")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := fixture(name, instance)
	d := b.Domains["aims"]
	d.OwnerDeployment = "C000001-test-enterprise"
	d.Scheduler = enterprise.PathUnified
	d.Tables["work_item_deletion_evidence"] = "aims_work_item_deletion_evidence"
	b.Domains["aims"] = d
	p, err := PlanDeletionEvidence(ctx, db, b)
	if err != nil {
		t.Fatal(err)
	}
	var receipt Receipt
	off := func(context.Context) error { return nil }
	save := func(r Receipt) error { receipt = r; return nil }
	if ApplyDeletionEvidence(ctx, db, p, func(context.Context) error { return errors.New("running") }, save) == nil {
		t.Fatal("running accepted")
	}
	if err = ApplyDeletionEvidence(ctx, db, p, off, save); err != nil {
		t.Fatal(err)
	}
	if err = VerifyDeletionEvidenceReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = PlanDeletionEvidence(ctx, db, b); err == nil {
		t.Fatal("existing object accepted")
	}
	exec("INSERT INTO aims_work_item_deletion_evidence(project_id,work_item_id,expected_version,snapshot_json,snapshot_sha256,detached_children_json,actor_uid,idempotency_key,operation_id,command_sha256,created_at) VALUES(263,1,REPEAT('a',64),'{}',REPEAT('b',64),'{}','fixture','fixture-key','00000000-0000-4000-8000-000000000001',REPEAT('c',64),UTC_TIMESTAMP(6))")
	if RollbackDeletionEvidence(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty frozen evidence removed")
	}
	exec("DELETE FROM aims_work_item_deletion_evidence")
	if err = RollbackDeletionEvidence(ctx, db, receipt, off); err != nil {
		t.Fatal(err)
	}
	after, err := PlanDeletionEvidence(ctx, db, b)
	if err != nil || after.ReviewHash != p.ReviewHash {
		t.Fatal("existing baseline changed")
	}
}
