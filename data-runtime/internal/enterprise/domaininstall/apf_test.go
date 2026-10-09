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
)

func apfFixture(database, instance string) enterprise.Binding {
	b := fixture(database, instance)
	delete(b.Domains, "altoc")
	b.Domains["aims"].Tables["integration_operation"] = "aims_integration_operation"
	b, _ = WithAPF(b, "C000001-test-enterprise")
	return b
}
func TestAPFManifestAndFrozenMappings(t *testing.T) {
	b := apfFixture("isolated", "instance")
	x := ForAPF(c000001Expectation).x
	if err := x.validate(b); err != nil {
		t.Fatal(err)
	}
	if len(x.tables()) != 53 || len(x.expected(b).Views) != 0 {
		t.Fatal("wrong APF installation set")
	}
	for domain, count := range map[string]int{"altoc": 30, "finance": 13, "people": 10} {
		tables, _ := APFTables(domain)
		if len(tables) != count {
			t.Fatal(domain)
		}
		for _, v := range tables {
			if !strings.HasPrefix(v.Physical, domain+"_") || !apfShared[v.Logical] && v.Physical != v.Logical {
				t.Fatal("unprefixed table")
			}
		}
	}
	if _, err := WithAPF(b, "C000001-test-enterprise"); err == nil {
		t.Fatal("existing domain replaced")
	}
	p := x.expected(b)
	p.Baseline = "baseline"
	p.ReviewHash = hash(p)
	if err := x.reviewed(p); err != nil {
		t.Fatal(err)
	}
	p.Tables[0].DDL += " DROP TABLE aims_projects"
	if x.reviewed(p) == nil {
		t.Fatal("unreviewed DDL accepted")
	}
	for _, domain := range []string{"altoc", "finance", "people"} {
		d := b.Domains[domain]
		d.Write = enterprise.PathUnified
		b.Domains[domain] = d
		if x.validate(b) == nil {
			t.Fatal("installation enabled business writes")
		}
		d.Write = enterprise.PathDisabled
		b.Domains[domain] = d
	}
}

func TestAPFInstallMySQL(t *testing.T) {
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
	t.Cleanup(func() { root.Close() })
	name := "hzy_apf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE " + name) })
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT)")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','c000001-test-tenant-runtime','v1',7)")
	exec("CREATE TABLE aims_projects(id INT PRIMARY KEY,name VARCHAR(100))")
	exec("INSERT INTO aims_projects VALUES(263,'untouched')")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := apfFixture(name, instance)
	installer := ForAPF(c000001Expectation)
	ctx := context.Background()
	p, err := installer.PlanInstall(ctx, db, b)
	if err != nil {
		t.Fatal(err)
	}
	off := func(context.Context) error { return nil }
	var receipt Receipt
	save := func(r Receipt) error { receipt = r; return nil }
	if installer.Apply(ctx, db, p, func(context.Context) error { return errors.New("running") }, save) == nil {
		t.Fatal("running accepted")
	}
	if err = installer.Apply(ctx, db, p, off, save); err != nil {
		t.Fatal(err)
	}
	if err = installer.VerifyReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME='fk_altoc_contract_payment_term_obligation'", name).Scan(&count); err != nil || count != 1 {
		t.Fatalf("folded ALTER missing: %d %v", count, err)
	}
	if installer.Apply(ctx, db, p, off, save) == nil {
		t.Fatal("existing objects overwritten")
	}
	exec("INSERT INTO people_positions(position_code,position_name) VALUES('MARKED','isolated')")
	if installer.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("business data dropped")
	}
	exec("DELETE FROM people_positions")
	if err = installer.Rollback(ctx, db, receipt, off); err != nil {
		t.Fatal(err)
	}
	if _, err = installer.PlanInstall(ctx, db, b); err != nil {
		t.Fatal("rollback did not restore baseline", err)
	}
}
