package domaininstall

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

func TestColumnDeclarationBoundary(t *testing.T) {
	x := ForFinanceBankAccountColumns(c000001Expectation).x.column
	b := fixture("isolated", "instance")
	b.Domains["finance"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Tables: map[string]string{"finance_bank_account": "finance_bank_account"}}
	if err := x.validate(b); err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"aims", "assets"} {
		bad := *x
		bad.declaration.Domain = domain
		if bad.validate(b) == nil {
			t.Fatal("view family accepted", domain)
		}
	}
	bad := *x
	bad.declaration = ColumnDeclaration{Domain: "finance", Table: "finance_bank_account", Add: []ColumnDefinition{{Name: "x", Type: "int; DROP TABLE finance_bank_account", Nullable: true}}}
	if bad.validate(b) == nil {
		t.Fatal("arbitrary SQL accepted")
	}
	bad = *x
	bad.declaration = ColumnDeclaration{Domain: "finance", Table: "finance_bank_account", Relax: []ColumnRelaxation{{Name: "account_name", Before: "irrelevant", After: ColumnDefinition{Name: "account_name", Type: "varchar(200)", Nullable: true}}}}
	if bad.validate(b) == nil {
		t.Fatal("non-whitelisted nullable accepted")
	}
}

type columnFixture struct {
	db        *sql.DB
	binding   enterprise.Binding
	installer Installer
	original  Table
}

func columnMySQL(t *testing.T) *columnFixture {
	t.Helper()
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
	var instance, datadir string
	if err = root.QueryRow("SELECT @@server_uuid,@@datadir").Scan(&instance, &datadir); err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(datadir) != filepath.Join(filepath.Dir(socket), "data") {
		t.Fatal("not disposable")
	}
	name := "hzy_columns_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + q(name)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE " + q(name)) })
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	f := &columnFixture{db: db, binding: fixture(name, instance), installer: ForFinanceBankAccountColumns(c000001Expectation)}
	f.binding.Domains["finance"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"finance_bank_account": "finance_bank_account", "altoc_contract": "altoc_contract"}}
	var tables []Table
	if err = json.Unmarshal(apfFinance, &tables); err != nil {
		t.Fatal(err)
	}
	for _, table := range tables {
		if table.Logical == "finance_bank_account" {
			f.original = table
		}
	}
	f.exec(t, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT,mapping_hash VARCHAR(64) NOT NULL DEFAULT 'untouched') ENGINE=InnoDB")
	f.exec(t, "INSERT INTO enterprise_schema_registry(id,tenant_code,environment_code,runtime_deployment,schema_version,generation) VALUES(1,'C000001','test','c000001-test-tenant-runtime','v1',7)")
	f.exec(t, "CREATE TABLE untouched(id INT PRIMARY KEY,value VARCHAR(20)) ENGINE=InnoDB")
	f.exec(t, "INSERT INTO untouched VALUES(1,'keep')")
	f.exec(t, f.original.DDL)
	f.exec(t, "INSERT INTO finance_bank_account(code,account_name) VALUES('FIXTURE','fixture')")
	var version string
	_ = db.QueryRow("SELECT VERSION()").Scan(&version)
	t.Log("isolated MySQL version", version)
	return f
}
func (f *columnFixture) exec(t *testing.T, s string) {
	t.Helper()
	if _, err := f.db.Exec(s); err != nil {
		t.Fatal(err)
	}
}
func stoppedColumns(context.Context) error { return nil }
func (f *columnFixture) plan(t *testing.T) Plan {
	t.Helper()
	p, err := f.installer.PlanInstall(context.Background(), f.db, f.binding)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func (f *columnFixture) apply(t *testing.T, p Plan) Receipt {
	t.Helper()
	var r Receipt
	err := f.installer.Apply(context.Background(), f.db, p, stoppedColumns, func(v Receipt) error { raw, _ := json.Marshal(v); return json.Unmarshal(raw, &r) })
	if err != nil {
		c, _ := f.db.Conn(context.Background())
		ddl, _ := columnDDL(context.Background(), c, f.installer.x.column.declaration.Table)
		c.Close()
		t.Log("actual schema", ddl)
		t.Log("plan schema", p.Column.AfterDefinition)
		t.Fatal(err)
	}
	return r
}

func TestColumnSubsetMySQL(t *testing.T) {
	ctx := context.Background()
	t.Run("full_cycle_fresh_equivalence_and_idempotence", func(t *testing.T) {
		f := columnMySQL(t)
		p := f.plan(t)
		if len(p.Column.Steps) != 7 {
			t.Fatal("missing DDL", len(p.Column.Steps))
		}
		r := f.apply(t, p)
		if err := f.installer.VerifyReceipt(ctx, f.db, r); err != nil {
			t.Fatal(err)
		}
		for _, timing := range r.ColumnTimings {
			if timing.Algorithm != "INPLACE" {
				t.Fatal("algorithm not recorded")
			}
			t.Logf("%s ALGORITHM=%s elapsed=%dms", timing.Key, timing.Algorithm, timing.ElapsedMilliseconds)
		}
		c, _ := f.db.Conn(ctx)
		actual, err := columnDDL(ctx, c, "finance_bank_account")
		c.Close()
		if err != nil {
			t.Fatal(err)
		}
		// No original rows are removed; rename only in this disposable fixture to
		// create the second table with byte-identical canonical name/schema.
		f.exec(t, "RENAME TABLE finance_bank_account TO incremental_bank_account")
		fresh := bankAccountFresh(f.original)
		f.exec(t, fresh.DDL)
		c, _ = f.db.Conn(ctx)
		newDDL, err := columnDDL(ctx, c, "finance_bank_account")
		c.Close()
		if err != nil || actual != newDDL {
			t.Fatalf("fresh/increment mismatch: %v\n%s\n%s", err, actual, newDDL)
		}
		f.exec(t, "DROP TABLE finance_bank_account")
		f.exec(t, "RENAME TABLE incremental_bank_account TO finance_bank_account")
		// SHOW CREATE table name returns original; old data remains byte-equivalent.
		again := f.plan(t)
		if len(again.Column.Steps) != 0 {
			t.Fatal("same definition not recognized")
		}
		r2 := f.apply(t, again)
		if err = f.installer.VerifyReceipt(ctx, f.db, r2); err != nil {
			t.Fatal(err)
		}
		if err = f.installer.Rollback(ctx, f.db, r2, stoppedColumns); err != nil {
			t.Fatal(err)
		} // no-op never deletes preexisting columns
		if err = f.installer.Rollback(ctx, f.db, r, stoppedColumns); err != nil {
			t.Fatal(err)
		}
		c, _ = f.db.Conn(ctx)
		restored, _ := columnDDL(ctx, c, "finance_bank_account")
		c.Close()
		if restored != p.Column.BeforeDefinition {
			t.Fatal("rollback schema mismatch")
		}
	})
	t.Run("definition_mismatch", func(t *testing.T) {
		f := columnMySQL(t)
		f.exec(t, "ALTER TABLE finance_bank_account ADD COLUMN short_name VARCHAR(49) DEFAULT NULL COMMENT '账户简称'")
		if _, err := f.installer.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("mismatch accepted")
		}
	})
	t.Run("view_dependency", func(t *testing.T) {
		f := columnMySQL(t)
		f.exec(t, "CREATE VIEW bank_accounts AS SELECT id FROM finance_bank_account")
		if _, err := f.installer.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("view family accepted")
		}
	})
	t.Run("old_data_change", func(t *testing.T) {
		f := columnMySQL(t)
		p := f.plan(t)
		r := f.apply(t, p)
		f.exec(t, "UPDATE finance_bank_account SET account_name='changed'")
		if f.installer.VerifyReceipt(ctx, f.db, r) == nil {
			t.Fatal("old projection mutation accepted")
		}
		if f.installer.Rollback(ctx, f.db, r, stoppedColumns) == nil {
			t.Fatal("rollback old-data drift accepted")
		}
	})
	t.Run("nondefault_rollback", func(t *testing.T) {
		f := columnMySQL(t)
		r := f.apply(t, f.plan(t))
		f.exec(t, "UPDATE finance_bank_account SET short_name='written'")
		if f.installer.Rollback(ctx, f.db, r, stoppedColumns) == nil {
			t.Fatal("business-write rollback accepted")
		}
		var n int
		_ = f.db.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='finance_bank_account' AND COLUMN_NAME='short_name'").Scan(&n)
		if n != 1 {
			t.Fatal("preflight was destructive")
		}
	})
	t.Run("mapping_registry_and_generation_drift", func(t *testing.T) {
		for _, sql := range []string{"UPDATE enterprise_schema_registry SET mapping_hash='changed'", "UPDATE enterprise_schema_registry SET generation=8", "UPDATE untouched SET value='changed'"} {
			t.Run(fmt.Sprint(len(sql)), func(t *testing.T) {
				f := columnMySQL(t)
				r := f.apply(t, f.plan(t))
				f.exec(t, sql)
				if f.installer.VerifyReceipt(ctx, f.db, r) == nil {
					t.Fatal("baseline drift accepted")
				}
			})
		}
	})
	t.Run("checkpoint_recovery_and_unknown_outcome", func(t *testing.T) {
		f := columnMySQL(t)
		p := f.plan(t)
		var r Receipt
		calls := 0
		err := f.installer.Apply(ctx, f.db, p, stoppedColumns, func(v Receipt) error {
			calls++
			if calls == 3 {
				return errors.New("checkpoint unavailable")
			}
			raw, _ := json.Marshal(v)
			_ = json.Unmarshal(raw, &r)
			return nil
		})
		if err == nil {
			t.Fatal("checkpoint failure ignored")
		}
		if f.installer.Resume(ctx, f.db, r, stoppedColumns, func(Receipt) error { return nil }) == nil {
			t.Fatal("uncheckpointed DDL inferred")
		}
	})
	t.Run("stopped_window_resume", func(t *testing.T) {
		f := columnMySQL(t)
		p := f.plan(t)
		var r Receipt
		checks := 0
		off := func(context.Context) error {
			checks++
			if checks == 4 {
				return errors.New("Runtime restarted")
			}
			return nil
		}
		if f.installer.Apply(ctx, f.db, p, off, func(v Receipt) error { raw, _ := json.Marshal(v); return json.Unmarshal(raw, &r) }) == nil {
			t.Fatal("stop proof lost ignored")
		}
		if len(r.Created) != 2 {
			t.Fatal("checkpoint count", len(r.Created))
		}
		if err := f.installer.Resume(ctx, f.db, r, stoppedColumns, func(v Receipt) error { raw, _ := json.Marshal(v); return json.Unmarshal(raw, &r) }); err != nil {
			t.Fatal(err)
		}
		if err := f.installer.VerifyReceipt(ctx, f.db, r); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("nullable_whitelist_and_null_rollback", func(t *testing.T) {
		f := columnMySQL(t)
		f.exec(t, "CREATE TABLE altoc_contract(id BIGINT PRIMARY KEY,tax_rate DECIMAL(5,2) NOT NULL DEFAULT 6.00) ENGINE=InnoDB")
		f.exec(t, "INSERT INTO altoc_contract VALUES(1,6)")
		f.binding.Domains["altoc"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Tables: map[string]string{"altoc_contract": "altoc_contract"}}
		fd := f.binding.Domains["finance"]
		delete(fd.Tables, "altoc_contract")
		f.binding.Domains["finance"] = fd
		after := ColumnDefinition{Name: "tax_rate", Type: "decimal(5,2)", Nullable: true, Default: strptr("6.00")}
		before := after
		before.Nullable = false
		f.installer = Installer{x: installer{column: &columnInstaller{declaration: ColumnDeclaration{Domain: "altoc", Table: "altoc_contract", Relax: []ColumnRelaxation{{Name: "tax_rate", Before: before.definition(), After: after}}}, expect: c000001Expectation}}}
		r := f.apply(t, f.plan(t))
		if err := f.installer.VerifyReceipt(ctx, f.db, r); err != nil {
			t.Fatal(err)
		}
		f.exec(t, "UPDATE altoc_contract SET tax_rate=NULL")
		if f.installer.Rollback(ctx, f.db, r, stoppedColumns) == nil {
			t.Fatal("NULL restored to NOT NULL")
		}
	})

	t.Run("nullable_preserve_or_remove_default_roundtrip", func(t *testing.T) {
		for _, remove := range []bool{false, true} {
			t.Run(fmt.Sprint(remove), func(t *testing.T) {
				f := columnMySQL(t)
				f.exec(t, "CREATE TABLE altoc_contract(id BIGINT PRIMARY KEY,tax_rate DECIMAL(5,2) NOT NULL DEFAULT 6.00) ENGINE=InnoDB")
				f.exec(t, "INSERT INTO altoc_contract VALUES(1,6)")
				f.binding.Domains["altoc"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Tables: map[string]string{"altoc_contract": "altoc_contract"}}
				fd := f.binding.Domains["finance"]
				delete(fd.Tables, "altoc_contract")
				f.binding.Domains["finance"] = fd
				before := ColumnDefinition{Name: "tax_rate", Type: "decimal(5,2)", Default: strptr("6.00")}
				after := before
				after.Nullable = true
				if remove {
					after.Default = nil
				}
				f.installer = Installer{x: installer{column: &columnInstaller{declaration: ColumnDeclaration{Domain: "altoc", Table: "altoc_contract", Relax: []ColumnRelaxation{{Name: "tax_rate", Before: before.definition(), After: after}}}, expect: c000001Expectation}}}
				r := f.apply(t, f.plan(t))
				if err := f.installer.VerifyReceipt(ctx, f.db, r); err != nil {
					t.Fatal(err)
				}
				if err := f.installer.Rollback(ctx, f.db, r, stoppedColumns); err != nil {
					t.Fatal(err)
				}
			})
		}
	})
	t.Run("preexisting_added_column_data_is_protected", func(t *testing.T) {
		f := columnMySQL(t)
		f.apply(t, f.plan(t))
		p := f.plan(t)
		r := f.apply(t, p)
		f.exec(t, "UPDATE finance_bank_account SET short_name='changed'")
		if f.installer.VerifyReceipt(ctx, f.db, r) == nil {
			t.Fatal("preexisting column excluded from projection")
		}
	})
	t.Run("whole_old_projection_rows_not_just_count", func(t *testing.T) {
		f := columnMySQL(t)
		r := f.apply(t, f.plan(t))
		f.exec(t, "DELETE FROM finance_bank_account")
		f.exec(t, "INSERT INTO finance_bank_account(id,code,account_name) VALUES(1,'FIXTURE','changed')")
		if f.installer.VerifyReceipt(ctx, f.db, r) == nil {
			t.Fatal("same count replacement accepted")
		}
	})
	t.Run("external_fk_and_review_tampering", func(t *testing.T) {
		f := columnMySQL(t)
		p := f.plan(t)
		r := f.apply(t, p)
		f.exec(t, "CREATE TABLE dependency(id INT PRIMARY KEY,short_name VARCHAR(50) COLLATE utf8mb4_unicode_ci,FOREIGN KEY(short_name) REFERENCES finance_bank_account(short_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci")
		if f.installer.Rollback(ctx, f.db, r, stoppedColumns) == nil {
			t.Fatal("external FK accepted")
		}
		p.Column.Steps[0].DDL = "DROP TABLE finance_bank_account"
		if f.installer.Apply(ctx, f.db, p, stoppedColumns, func(Receipt) error { return nil }) == nil {
			t.Fatal("tampered DDL accepted")
		}
	})
	t.Run("migration_lock", func(t *testing.T) {
		f := columnMySQL(t)
		c, _ := f.db.Conn(ctx)
		release, err := migrationlock.Acquire(ctx, c, f.binding.Storage.InstanceID, f.binding.Storage.Database)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		defer release()
		if _, err = f.installer.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("lock ignored")
		}
	})
}
