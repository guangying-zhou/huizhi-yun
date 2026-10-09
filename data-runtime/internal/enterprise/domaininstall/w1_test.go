package domaininstall

import (
	"context"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func w1Fixture(t *testing.T, fresh bool) *columnFixture {
	f := columnMySQL(t)
	// The isolated database and Registry are owned by columnMySQL cleanup.
	fd := f.binding.Domains["finance"]
	fd.Tables = map[string]string{"finance_bank_account": "finance_bank_account"}
	f.binding.Domains["finance"] = fd
	f.binding.Domains["altoc"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Tables: map[string]string{}}
	for _, domain := range []string{"altoc", "finance"} {
		var tables []Table
		if err := json.Unmarshal(apfManifests[domain], &tables); err != nil {
			t.Fatal(err)
		}
		d := f.binding.Domains[domain]
		for _, table := range tables {
			d.Tables[table.Logical] = table.Physical
			if table.Physical == "finance_bank_account" {
				continue
			}
			if fresh {
				table = w1Fresh(table)
			}
			f.exec(t, table.DDL)
		}
		f.binding.Domains[domain] = d
	}
	if fresh {
		for _, domain := range []string{"altoc", "finance"} {
			tables, _ := APFTables(domain)
			for _, table := range tables {
				for _, fk := range table.ForeignKeys {
					f.exec(t, "ALTER TABLE "+q(table.Physical)+" ADD "+fk.definition())
				}
			}
		}
	}
	return f
}
func TestAPFW1SubsetsMySQL(t *testing.T) {
	ctx := context.Background()
	for _, name := range []string{"w1-migration-ledger", "w1-finance-legal-entity", "w1-finance-balance-entry", "w1-altoc-contract-snapshot", "w1-altoc-customer-snapshot"} {
		t.Run(name, func(t *testing.T) {
			f := w1Fixture(t, false)
			b, err := WithW1(f.binding, name, c000001Expectation.OwnerDeployment)
			if err != nil {
				t.Fatal(err)
			}
			i, err := ForW1(name, c000001Expectation)
			if err != nil {
				t.Fatal(err)
			}
			p, err := i.PlanInstall(ctx, f.db, b)
			if err != nil {
				t.Fatal(err)
			}
			var r Receipt
			err = i.Apply(ctx, f.db, p, stoppedColumns, func(v Receipt) error { raw, _ := json.Marshal(v); return json.Unmarshal(raw, &r) })
			if err != nil {
				t.Fatal(err)
			}
			if err = i.VerifyReceipt(ctx, f.db, r); err != nil {
				t.Fatal(err)
			}
			if err = i.Rollback(ctx, f.db, r, stoppedColumns); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, name := range []string{"w1-finance-balance-columns", "w1-altoc-contract-columns", "w1-altoc-customer-columns", "w1-altoc-contact-columns"} {
		t.Run(name, func(t *testing.T) {
			f := w1Fixture(t, false)
			f.installer, _ = ForW1(name, c000001Expectation)
			p := f.plan(t)
			r := f.apply(t, p)
			if err := f.installer.VerifyReceipt(ctx, f.db, r); err != nil {
				t.Fatal(err)
			}
			// Compare SHOW CREATE against fresh installation from the identical declaration.
			table := f.installer.x.column.declaration.Table
			c, _ := f.db.Conn(ctx)
			actual, err := columnDDL(ctx, c, table)
			c.Close()
			if err != nil {
				t.Fatal(err)
			}
			f2 := w1Fixture(t, true)
			c, _ = f2.db.Conn(ctx)
			fresh, err := columnDDL(ctx, c, table)
			c.Close()
			if err != nil {
				t.Fatal(err)
			}
			if actual != fresh {
				t.Fatalf("increment/fresh mismatch\n%s\n%s", actual, fresh)
			}
			if err = f.installer.Rollback(ctx, f.db, r, stoppedColumns); err != nil {
				t.Fatal(err)
			}

		})
	}
}

func TestAPFW1ConstraintPreflightMySQL(t *testing.T) {
	ctx := context.Background()
	t.Run("missing_reference_before_any_ddl", func(t *testing.T) {
		f := columnMySQL(t)
		d := f.binding.Domains["finance"]
		d.Tables = map[string]string{"finance_bank_account": "finance_bank_account"}
		f.binding.Domains["finance"] = d
		f.binding.Domains["altoc"] = enterprise.DomainBinding{OwnerDeployment: c000001Expectation.OwnerDeployment, Read: enterprise.PathUnified, Tables: map[string]string{"altoc_customer": "altoc_customer"}}
		f.exec(t, "CREATE TABLE altoc_customer(id bigint unsigned PRIMARY KEY) ENGINE=InnoDB")
		i, _ := ForW1("w1-altoc-customer-columns", c000001Expectation)
		if _, err := i.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("missing reference accepted")
		}
	})
	t.Run("invalid_check_existing_data", func(t *testing.T) {
		f := w1Fixture(t, false)
		for _, c := range contractColumnsW1().Add {
			f.exec(t, "ALTER TABLE altoc_contract ADD COLUMN "+c.definition())
		}
		f.exec(t, "INSERT INTO altoc_customer(code,name,owner_uid) VALUES('CU-W000123','fixture','actor')")
		f.exec(t, "INSERT INTO altoc_contract(code,name,customer_id,owner_uid,origin_type) VALUES('CT-W000123','fixture',1,'actor','invalid')")
		i, _ := ForW1("w1-altoc-contract-columns", c000001Expectation)
		if _, err := i.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("invalid old row accepted")
		}
		var n int
		_ = f.db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_altoc_contract_origin'").Scan(&n)
		if n != 0 {
			t.Fatal("plan mutated schema")
		}
	})
	t.Run("orphan_fk_existing_data", func(t *testing.T) {
		f := w1Fixture(t, false)
		d := W1Columns("w1-altoc-customer-columns")
		for _, c := range d.Add {
			f.exec(t, "ALTER TABLE altoc_customer ADD COLUMN "+c.definition())
		}
		f.exec(t, "INSERT INTO altoc_customer(code,name,owner_uid,primary_contact_id) VALUES('CU-W000123','fixture','actor',999)")
		i, _ := ForW1("w1-altoc-customer-columns", c000001Expectation)
		if _, err := i.PlanInstall(ctx, f.db, f.binding); err == nil {
			t.Fatal("orphan accepted")
		}
	})
}
