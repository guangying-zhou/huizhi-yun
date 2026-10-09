package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

type mysqlFixture struct {
	root, db *sql.DB
	args     []string
	cfg      []byte
	output   bytes.Buffer
	b        enterprise.Binding
}

func fixtureMySQL(t *testing.T) *mysqlFixture {
	t.Helper()
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	if socket == "" {
		t.Skip("disposable MySQL required")
	}
	socket = filepath.Clean(socket)
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe test socket")
	}
	mc := mysql.NewConfig()
	mc.Net = "unix"
	mc.Addr = socket
	mc.User = "root"
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	var instance, datadir string
	var port int
	if err = root.QueryRow("SELECT @@server_uuid,@@datadir,@@port").Scan(&instance, &datadir, &port); err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(datadir) != filepath.Join(filepath.Dir(socket), "data") {
		t.Fatal("not disposable data directory")
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	database := "hzy_apf_cli_" + suffix
	user := "apf_" + suffix[:20]
	mustExec(t, root, "CREATE DATABASE "+database)
	t.Cleanup(func() { root.Exec("DROP DATABASE " + database) })
	mustExec(t, root, "CREATE USER '"+user+"'@'127.0.0.1' IDENTIFIED BY 'isolated-fixture-only'")
	t.Cleanup(func() { root.Exec("DROP USER '" + user + "'@'127.0.0.1'") })
	mustExec(t, root, "GRANT SELECT,CREATE,DROP,ALTER,REFERENCES,INDEX,SHOW VIEW,CREATE VIEW ON "+database+".* TO '"+user+"'@'127.0.0.1'")
	mc.DBName = database
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mustExec(t, db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB")
	mustExec(t, db, "INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','c000001-test-tenant-runtime','v1',7)")
	mustExec(t, db, "CREATE TABLE aims_projects(id INT PRIMARY KEY,name VARCHAR(100)) ENGINE=InnoDB")
	mustExec(t, db, "INSERT INTO aims_projects VALUES(263,'untouched aims')")
	mustExec(t, db, "CREATE TABLE assets_products(id INT PRIMARY KEY,name VARCHAR(100)) ENGINE=InnoDB")
	mustExec(t, db, "INSERT INTO assets_products VALUES(45,'untouched assets')")
	raw := sourceFixture(database, instance, port)
	var cfg config.Config
	_ = json.Unmarshal(raw, &cfg)
	b, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	basePath := filepath.Join(dir, "base.json")
	migrationPath := filepath.Join(dir, "migration.json")
	if err = writeBytes(basePath, raw); err != nil {
		t.Fatal(err)
	}
	admin := cfg.Enterprise.DB
	admin.User = user
	admin.Password = "isolated-fixture-only"
	if err = writeJSON(migrationPath, admin); err != nil {
		t.Fatal(err)
	}
	return &mysqlFixture{root: root, db: db, cfg: raw, b: b, args: []string{"--config", basePath, "--migration-db-config", migrationPath, "--proposed-config", filepath.Join(dir, "candidate.json"), "--plan", filepath.Join(dir, "plan.json"), "--receipt", filepath.Join(dir, "receipt.json")}}
}
func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatal(err)
	}
}
func (f *mysqlFixture) run(mode string, off domaininstall.Stopped) error {
	args := append(append([]string{}, f.args...), "--mode", mode)
	if mode != "plan" {
		var p reviewPlan
		o, _ := parse(f.args)
		if err := readJSON(o.plan, &p); err != nil {
			return err
		}
		args = append(args, "--review-hash", p.ReviewHash)
	}
	return execute(context.Background(), args, dependencies{stopped: off, open: openMigration, output: &f.output})
}
func alwaysStopped(context.Context) error { return nil }
func (f *mysqlFixture) receipt(t *testing.T) receipt {
	t.Helper()
	o, _ := parse(f.args)
	var r receipt
	if err := readJSON(o.receipt, &r); err != nil {
		t.Fatal(err)
	}
	return r
}
func (f *mysqlFixture) existing(t *testing.T) string {
	t.Helper()
	var generation int
	var aims, assets string
	if err := f.db.QueryRow("SELECT generation FROM enterprise_schema_registry WHERE id=1").Scan(&generation); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT name FROM aims_projects WHERE id=263").Scan(&aims); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT name FROM assets_products WHERE id=45").Scan(&assets); err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("%d/%s/%s", generation, aims, assets)
}
func (f *mysqlFixture) objects(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME REGEXP '^(altoc_|finance_|people_)'").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAPFCLIInstallMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	before := f.existing(t)
	if err := f.run("plan", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	o, _ := parse(f.args)
	var plan reviewPlan
	if err := readJSON(o.plan, &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Installation.Tables) != 53 || len(plan.Installation.Views) != 0 || f.objects(t) != 0 {
		t.Fatal("plan wrote database")
	}
	candidate, err := privateRead(o.proposed)
	if err != nil {
		t.Fatal(err)
	}
	if f.run("plan", alwaysStopped) == nil {
		t.Fatal("plan artifacts overwritten")
	}
	if err = f.run("apply", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	if f.objects(t) != 53 || f.existing(t) != before {
		t.Fatal("wrong object set / existing state changed")
	}
	if err = f.run("verify", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	saved := f.receipt(t)
	if len(saved.Installation.Created) != 53 {
		t.Fatal("missing per-CREATE checkpoints")
	}
	if f.run("apply", alwaysStopped) == nil {
		t.Fatal("repeated apply overwrote receipt/tables")
	}
	if !reflect.DeepEqual(f.receipt(t), saved) {
		t.Fatal("repeated apply damaged receipt")
	}
	// Even with a fresh exclusive receipt path, core refuses existing objects.
	originalArgs := append([]string{}, f.args...)
	for i := range f.args {
		if f.args[i] == "--receipt" {
			f.args[i+1] = filepath.Join(filepath.Dir(o.receipt), "repeat.json")
		}
	}
	if f.run("apply", alwaysStopped) == nil {
		t.Fatal("existing APF schema overwritten")
	}
	f.args = originalArgs
	if f.objects(t) != 53 || f.existing(t) != before {
		t.Fatal("repeat apply changed objects")
	}
	afterSource, _ := privateRead(o.config)
	afterCandidate, _ := privateRead(o.proposed)
	if !bytes.Equal(f.cfg, afterSource) || !bytes.Equal(candidate, afterCandidate) {
		t.Fatal("live/candidate configuration modified")
	}
	// Verify must honor the same migration lock before object inspection.
	conn, err := f.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	lockName := migrationlock.Name(f.b.Storage.InstanceID, f.b.Storage.Database)
	var held int
	if err = conn.QueryRowContext(context.Background(), "SELECT GET_LOCK(?,0)", lockName).Scan(&held); err != nil || held != 1 {
		t.Fatal("fixture lock unavailable")
	}
	if f.run("verify", alwaysStopped) == nil {
		t.Fatal("verify bypassed migration lock")
	}
	_, _ = conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK(?)", lockName)
	conn.Close()
	// Nonempty APF tables cannot be silently discarded.
	mustExec(t, f.db, "INSERT INTO people_positions(position_code,position_name) VALUES('ZZ-TEST-CLI','fixture')")
	if f.run("rollback", alwaysStopped) == nil || f.objects(t) != 53 {
		t.Fatal("nonempty APF data dropped")
	}
	mustExec(t, f.db, "DELETE FROM people_positions WHERE position_code='ZZ-TEST-CLI'")
	if err = f.run("rollback", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	if f.objects(t) != 0 || f.existing(t) != before {
		t.Fatal("rollback damaged baseline")
	}
	if strings.Contains(f.output.String(), "fixture-runtime-only") || strings.Contains(f.output.String(), "isolated-fixture-only") {
		t.Fatal("secret leaked")
	}
}

func TestAPFCLILegacyAltocMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	before := f.existing(t)
	raw, err := os.ReadFile("../../internal/enterprise/domaininstall/altoc.json")
	if err != nil {
		t.Fatal(err)
	}
	var tables []domaininstall.Table
	if err = json.Unmarshal(raw, &tables); err != nil {
		t.Fatal(err)
	}
	b := f.b
	d := enterprise.DomainBinding{OwnerDeployment: owner, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{}}
	for _, table := range tables {
		d.Tables[table.Logical] = table.Physical
	}
	b.Domains["altoc"] = d
	old := domaininstall.ForAltoc(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: owner, Address: b.Storage.Address})
	p, err := old.PlanInstall(context.Background(), f.db, b)
	if err != nil {
		t.Fatal(err)
	}
	var r domaininstall.Receipt
	if err = old.Apply(context.Background(), f.db, p, alwaysStopped, func(got domaininstall.Receipt) error { r = got; return nil }); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, "INSERT INTO altoc_customer(code,name,owner_user_id) VALUES('ZZ-TEST-CLI','fixture','test')")
	// Removing the config domain alone never makes old objects safe to overwrite.
	if f.run("plan", alwaysStopped) == nil {
		t.Fatal("old 13 tables/views coexist with APF")
	}
	if err = old.Rollback(context.Background(), f.db, r, alwaysStopped); err != nil {
		t.Fatal(err)
	}
	// Remaining unprefixed view and old-only table each block a new plan.
	for _, ddl := range []string{"CREATE VIEW quotation AS SELECT 1 AS id", "CREATE TABLE altoc_lead(id INT PRIMARY KEY)"} {
		mustExec(t, f.db, ddl)
		if f.run("plan", alwaysStopped) == nil {
			t.Fatal("legacy remainder accepted", ddl)
		}
		if strings.Contains(ddl, "VIEW") {
			mustExec(t, f.db, "DROP VIEW quotation")
		} else {
			mustExec(t, f.db, "DROP TABLE altoc_lead")
		}
	}
	if f.existing(t) != before {
		t.Fatal("old rollback changed existing domains")
	}
	if err = f.run("plan", alwaysStopped); err != nil {
		t.Fatal("clean old rollback did not permit APF plan", err)
	}
}

func TestAPFCLIPartialReceiptAndGenerationMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	if err := f.run("plan", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	checks := 0
	fail := func(context.Context) error {
		checks++
		if checks >= 4 {
			return errors.New("Runtime started")
		}
		return nil
	}
	if f.run("apply", fail) == nil {
		t.Fatal("stop drift accepted")
	}
	r := f.receipt(t)
	if len(r.Installation.Created) != 1 || f.objects(t) != 1 {
		t.Fatal("partial DDL not checkpointed")
	}
	if f.run("verify", alwaysStopped) == nil {
		t.Fatal("partial receipt verified")
	}
	if err := f.run("rollback", alwaysStopped); err != nil {
		t.Fatal("checkpointed partial rollback failed", err)
	}
	o, _ := parse(f.args)
	_ = os.Remove(o.receipt)
	if err := f.run("apply", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	checks = 0
	drift := func(context.Context) error {
		checks++
		if checks == 3 {
			mustExec(t, f.db, "UPDATE enterprise_schema_registry SET generation=8 WHERE id=1")
		}
		return nil
	}
	if f.run("rollback", drift) == nil || f.objects(t) != 53 {
		t.Fatal("generation change before DROP accepted")
	}
	mustExec(t, f.db, "UPDATE enterprise_schema_registry SET generation=7 WHERE id=1")
	if err := f.run("rollback", alwaysStopped); err != nil {
		t.Fatal(err)
	}
}

func TestAPFCLIIncrementalChainMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	before := f.existing(t)
	for _, mode := range []string{"plan", "apply", "verify"} {
		if e := f.run(mode, alwaysStopped); e != nil {
			t.Fatal("base", mode, e)
		}
	}
	baseArgs := append([]string{}, f.args...)
	baseOptions, _ := parse(baseArgs)
	previous := baseOptions.proposed
	var chain [][]string
	subsets := []string{"aims-portfolio-members", "people-private", "people-facts", "people-offboarding", "altoc-sales-B2", "altoc-tenders", "altoc-services", "altoc-tickets", "altoc-renewals", "altoc-feedback", "finance-B3", "finance-13a", "finance-13b", "finance-cost"}
	for n, name := range subsets {
		dir := t.TempDir()
		f.args = []string{"--subset", name, "--config", previous, "--migration-db-config", baseOptions.migration, "--proposed-config", filepath.Join(dir, "candidate.json"), "--plan", filepath.Join(dir, "plan.json"), "--receipt", filepath.Join(dir, "receipt.json")}
		for _, mode := range []string{"plan", "apply", "verify"} {
			if e := f.run(mode, alwaysStopped); e != nil {
				t.Fatal(name, mode, e)
			}
		}
		o, _ := parse(f.args)
		r := f.receipt(t)
		if r.Plan.Subset != name || r.Plan.Installation.Binding.Generation != 7 {
			t.Fatal("subset/generation identity lost")
		}
		for _, path := range []string{o.plan, o.proposed, o.receipt} {
			info, e := os.Lstat(path)
			if e != nil || info.Mode().Perm() != 0600 {
				t.Fatal("unsafe artifact", e)
			}
		}
		if name == "altoc-renewals" {
			mustExec(t, f.db, "INSERT INTO altoc_renewal_opportunity(code,customer_id,name,owner_uid,created_by,updated_by) VALUES('ISOLATED-RENEWAL',1,'标记续约','fixture','fixture','fixture')")
			if f.run("rollback", alwaysStopped) == nil {
				t.Fatal("nonempty renewal rollback")
			}
			mustExec(t, f.db, "DELETE FROM altoc_renewal_opportunity WHERE code='ISOLATED-RENEWAL'")
		}
		chain = append(chain, append([]string{}, f.args...))
		previous = o.proposed
		if name == "people-facts" || (name == "altoc-tenders" || name == "altoc-services" || name == "altoc-tickets" || name == "altoc-renewals" || name == "altoc-feedback") {
			// The prior subset has later objects in its baseline: cannot roll it
			// back out of order, nor weaken generation checks to make it work.
			latest := f.args
			if name == "altoc-tenders" || name == "altoc-services" || name == "altoc-tickets" || name == "altoc-renewals" || name == "altoc-feedback" {
				f.args = chain[n-1] // tender must roll back before its sales prerequisite
			} else {
				f.args = chain[1]
			}
			if f.run("rollback", alwaysStopped) == nil {
				t.Fatal("out of order rollback")
			}
			f.args = latest
		}
	}
	if f.existing(t) != before {
		t.Fatal("existing domains/Registry changed")
	}
	mustExec(t, f.db, "UPDATE enterprise_schema_registry SET generation=8 WHERE id=1")
	if f.run("verify", alwaysStopped) == nil {
		t.Fatal("generation drift accepted")
	}
	mustExec(t, f.db, "UPDATE enterprise_schema_registry SET generation=7 WHERE id=1")
	mustExec(t, f.db, "INSERT INTO finance_project_cost_period(project_code,period_month) VALUES('ISOLATED','2026-10')")
	if f.run("rollback", alwaysStopped) == nil {
		t.Fatal("nonempty cost rollback")
	}
	mustExec(t, f.db, "DELETE FROM finance_project_cost_period")
	for n := len(chain) - 1; n >= 0; n-- {
		f.args = chain[n]
		if e := f.run("verify", alwaysStopped); e != nil {
			t.Fatal("pre-rollback", subsets[n], e)
		}
		if e := f.run("rollback", alwaysStopped); e != nil {
			t.Fatal("rollback", subsets[n], e)
		}
		if n > 0 {
			f.args = chain[n-1]
			if e := f.run("verify", alwaysStopped); e != nil {
				t.Fatal("remaining prefix", e)
			}
		}
	}
	f.args = baseArgs
	if e := f.run("verify", alwaysStopped); e != nil {
		t.Fatal("base not restored", e)
	}
	if f.objects(t) != 53 || f.existing(t) != before {
		t.Fatal("baseline damaged")
	}
	if e := f.run("rollback", alwaysStopped); e != nil {
		t.Fatal(e)
	}
	if f.objects(t) != 0 || f.existing(t) != before {
		t.Fatal("base rollback damaged existing objects")
	}
	if strings.Contains(f.output.String(), "isolated-fixture-only") {
		t.Fatal("secret leaked")
	}
}

func TestAimsPortfolioMembersSubsetMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	mustExec(t, f.db, "ALTER TABLE enterprise_schema_registry ADD COLUMN mapping_hash VARCHAR(64) NOT NULL DEFAULT 'existing-mapping-hash'")
	mustExec(t, f.db, "CREATE VIEW projects AS SELECT id,name FROM aims_projects")
	before := f.existing(t)
	f.args = append(f.args, "--subset", "aims-portfolio-members")
	for _, mode := range []string{"plan", "apply", "verify"} {
		if err := f.run(mode, alwaysStopped); err != nil {
			t.Fatal(mode, err)
		}
	}
	r := f.receipt(t)
	if len(r.Plan.Installation.Tables) != 2 || len(r.Plan.Installation.Views) != 0 {
		t.Fatal("not table-only")
	}
	var mapping, view string
	if err := f.db.QueryRow("SELECT mapping_hash FROM enterprise_schema_registry WHERE id=1").Scan(&mapping); err != nil || mapping != "existing-mapping-hash" {
		t.Fatal("Registry mapping hash changed", err)
	}
	if err := f.db.QueryRow("SELECT name FROM projects WHERE id=263").Scan(&view); err != nil || view != "untouched aims" {
		t.Fatal("existing view changed", err)
	}
	if f.existing(t) != before {
		t.Fatal("existing data changed")
	}
	mustExec(t, f.db, "INSERT INTO aims_portfolio_doc_repos(portfolio_id,integration_code,repo_path,created_by,updated_by,created_at,updated_at) VALUES(1,'gitlab.default','group/project','fixture','fixture',NOW(3),NOW(3))")
	if f.run("rollback", alwaysStopped) == nil {
		t.Fatal("nonempty table rollback accepted")
	}
	mustExec(t, f.db, "DELETE FROM aims_portfolio_doc_repos")
	if err := f.run("rollback", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('aims_portfolio_members','aims_portfolio_doc_repos')").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("rollback did not remove only subset", err)
	}
	if f.existing(t) != before {
		t.Fatal("rollback altered baseline")
	}
}

func TestAimsPortfolioMembersSubsetRejectsExistingTableMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	mustExec(t, f.db, domaininstall.AimsPortfolioMembersTables()[0].DDL)
	f.args = append(f.args, "--subset", "aims-portfolio-members")
	if f.run("plan", alwaysStopped) == nil {
		t.Fatal("existing subset table accepted")
	}
	var n int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='aims_portfolio_doc_repos'").Scan(&n); err != nil || n != 0 {
		t.Fatal("plan created peer table", err)
	}
}

func TestProductionPortfolioSubsetMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	var cfg config.Config
	if err := json.Unmarshal(f.cfg, &cfg); err != nil {
		t.Fatal(err)
	}
	p := prodFixture()
	p.Database = cfg.Enterprise.DB.Database
	p.DatabaseAddress = fmt.Sprintf("127.0.0.1:%d", cfg.Enterprise.DB.Port)
	p.InstanceID = cfg.Enterprise.InstanceID
	cfg.Deployment = p.RuntimeDeployment
	cfg.DeploymentBindings["enterprise"] = p.OwnerDeployment
	cfg.Server.Port = p.RuntimePort
	cfg.Enterprise.Environment = "prod"
	for name, d := range cfg.Enterprise.Domains {
		d.OwnerDeployment = p.OwnerDeployment
		cfg.Enterprise.Domains[name] = d
	}
	raw, _ := json.Marshal(cfg)
	f.args[1] = filepath.Join(t.TempDir(), "production-source.json")
	if err := writeBytes(f.args[1], raw); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, "UPDATE enterprise_schema_registry SET environment_code='prod',runtime_deployment='c000001-prod-tenant-runtime'")
	profile := filepath.Join(t.TempDir(), "production.json")
	if err := writeJSON(profile, p); err != nil {
		t.Fatal(err)
	}
	args := append(append([]string{}, f.args...), "--profile", profile, "--subset", "aims-portfolio-members")
	run := func(mode string, extra ...string) error {
		return execute(context.Background(), append(append([]string{"--mode", mode}, args...), extra...), dependencies{stopped: func(context.Context) error { t.Fatal("legacy stop proof used"); return rejected }, productionStopped: func(_ context.Context, actual *productionProfile) error {
			if !reflect.DeepEqual(actual, &p) {
				t.Fatal("profile mismatch")
			}
			return nil
		}, open: openMigration, output: &f.output})
	}
	if err := run("plan"); err != nil {
		t.Fatal(err)
	}
	var plan reviewPlan
	raw, err := os.ReadFile(f.args[7])
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"apply", "verify", "rollback"} {
		if err := run(mode, "--review-hash", plan.ReviewHash); err != nil {
			t.Fatalf("%s: %v", mode, err)
		}
	}
}

func TestFinanceBankAccountColumnSubsetCLIMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	// Test-only schema account gains ALTER, not any global privilege or DML.
	var admin config.DBConfig
	o, _ := parse(f.args)
	if err := readJSON(o.migration, &admin); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.root, "GRANT ALTER ON "+f.b.Storage.Database+".* TO '"+admin.User+"'@'127.0.0.1'")
	b, err := domaininstall.WithAPF(f.b, owner)
	if err != nil {
		t.Fatal(err)
	}
	// Create only the pre-W1 canonical bank table. APFTables now deliberately
	// gives new installations the final reviewed column declaration.
	tables, _ := domaininstall.APFTables("finance")
	for _, table := range tables {
		if table.Logical == "finance_bank_account" {
			ddl := table.DDL
			for _, name := range []string{"short_name", "bank_branch_code", "legal_entity_code", "sort_no", "account_subtype"} {
				lines := strings.Split(ddl, "\n")
				var keep []string
				for _, line := range lines {
					if !strings.HasPrefix(strings.TrimSpace(line), "`"+name+"`") {
						keep = append(keep, line)
					}
				}
				ddl = strings.Join(keep, "\n")
			}
			lines := strings.Split(ddl, "\n")
			var keep []string
			for _, line := range lines {
				if !strings.Contains(line, "uk_finance_bank_account_short_name") && !strings.Contains(line, "idx_finance_bank_account_entity") {
					keep = append(keep, line)
				}
			}
			ddl = strings.Join(keep, "\n")
			ddl = strings.ReplaceAll(ddl, ",\n) ENGINE=", "\n) ENGINE=")
			mustExec(t, f.db, ddl)
		}
	}
	// Existing runtime configuration is preserved byte-for-byte for column subsets.
	var root, ent, domains map[string]json.RawMessage
	_ = json.Unmarshal(f.cfg, &root)
	_ = json.Unmarshal(root["enterprise"], &ent)
	_ = json.Unmarshal(ent["domains"], &domains)
	for _, name := range []string{"altoc", "finance", "people"} {
		d := b.Domains[name]
		domains[name], _ = json.Marshal(config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler})
	}
	ent["domains"], _ = json.Marshal(domains)
	root["enterprise"], _ = json.Marshal(ent)
	source, _ := json.Marshal(root)
	if err := os.WriteFile(o.config, source, 0600); err != nil {
		t.Fatal(err)
	}
	f.args = append(f.args, "--subset", "finance-bank-account-columns")
	if err = f.run("plan", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	candidate, err := privateRead(o.proposed)
	if err != nil || !bytes.Equal(candidate, source) {
		t.Fatal("column config changed")
	}
	if err = f.run("apply", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	if err = f.run("apply", alwaysStopped); err != nil {
		t.Fatal("completed checkpoint replay", err)
	}
	if err = f.run("verify", alwaysStopped); err != nil {
		t.Fatal(err)
	}
	if err = f.run("rollback", alwaysStopped); err != nil {
		t.Fatal(err)
	}
}
