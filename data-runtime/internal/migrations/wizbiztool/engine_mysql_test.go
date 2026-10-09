package wizbiztool

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
	"strings"
	"testing"
)

type fixtureVault struct{ ensured map[string]string }

func (v *fixtureVault) Close() error { return nil }
func (v *fixtureVault) Ensure(ctx context.Context, obj PreparedObject, row map[string]any, p Profile) error {
	if obj.Values["account_no_secret_ref"] == nil {
		return nil
	}
	code := obj.Key.(string)
	value := "WIZBIZ-TEST-" + sourceText(row, "ba_id")
	hash := Digest([]byte(value))
	if old, ok := v.ensured[code]; ok && old != hash {
		return ErrVault
	}
	v.ensured[code] = hash
	return nil
}
func newFixtureEngine(t *testing.T, f *toolFixture) *engine {
	t.Helper()
	ctx := context.Background()
	source := f.sourceSnapshot(t)
	receipt, err := source.VerifyStage(ctx, f.manifest, f.manifestHash)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := BuildPlan(ctx, source, f.target, f.directory, f.profile, f.profileHash, f.manifest, f.manifestHash, receipt, map[string]IdentityConfirmation{}, f.identityHash, f.build)
	if err != nil {
		t.Fatal(err)
	}
	e := newEngine(source, f.target, f.directory, f.profile, f.profileHash, f.manifest, f.manifestHash, map[string]IdentityConfirmation{}, f.identityHash, plan)
	// No actual host process is inspected or stopped in this isolated test.
	e.stopped = func(context.Context) error { return nil }
	e.build = func() (RuntimeBuildEvidence, error) { return f.build, nil }
	e.vault = &fixtureVault{map[string]string{}}
	return e
}
func TestToolApplyMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	receipt, err := e.apply(ctx)
	if err != nil {
		t.Fatalf("apply failed at completedSteps=%d: %v", len(receipt.Steps), err)
	}
	if receipt.Status != "applied" || len(receipt.Steps) != len(steps) {
		t.Fatal("incomplete apply")
	}
	result, verifyErr := e.verify(ctx, func(ctx context.Context, code, hash, mask string) error {
		v := e.vault.(*fixtureVault)
		if v.ensured[code] != hash {
			return ErrVault
		}
		return nil
	})
	if verifyErr != nil {
		for _, d := range result.Differences {
			t.Logf("verify: %s/%s %s", d.Table, d.SourcePK, d.Check)
		}
		t.Fatal(verifyErr)
	}
	before, err := ReadBaselines(ctx, f.target)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err = e.apply(ctx)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	after, err := ReadBaselines(ctx, f.target)
	if err != nil || factsHash(before) != factsHash(after) {
		t.Fatal("replay changed domain rows")
	}
	var ledgers int
	if f.target.QueryRow("SELECT COUNT(*) FROM mig_source_row").Scan(&ledgers) != nil {
		t.Fatal("ledger read")
	}
	want := 0
	for _, rows := range f.data {
		want += len(rows)
	}
	if ledgers != want {
		t.Fatalf("ledger count %d expected %d", ledgers, want)
	}
	// Synthetic source account material must not appear in any durable ledger
	// cell, reviewed plan, or execution receipt (only hashes/ref/mask may leave memory).
	for _, table := range []string{"mig_batch", "mig_batch_step", "mig_source_row", "mig_object_map", "mig_identity_map", "mig_exception"} {
		rows, err := f.target.Query("SELECT * FROM `" + table + "`")
		if err != nil {
			t.Fatal(err)
		}
		names, err := rows.Columns()
		if err != nil {
			rows.Close()
			t.Fatal(err)
		}
		for rows.Next() {
			raw := make([]sql.RawBytes, len(names))
			args := make([]any, len(names))
			for i := range raw {
				args[i] = &raw[i]
			}
			if rows.Scan(args...) != nil {
				rows.Close()
				t.Fatal("ledger scan")
			}
			for _, cell := range raw {
				if strings.Contains(string(cell), "TEST-ACCOUNT-DO-NOT-READ") {
					rows.Close()
					t.Fatal("source account leaked")
				}
			}
		}
		if rows.Err() != nil {
			rows.Close()
			t.Fatal("ledger read")
		}
		rows.Close()
	}
	if strings.Contains(jsonFacts(e.plan), "TEST-ACCOUNT-DO-NOT-READ") || strings.Contains(jsonFacts(receipt), "TEST-ACCOUNT-DO-NOT-READ") {
		t.Fatal("account in artifact")
	}
}

func TestToolRollbackMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	receipt, err := e.rollback(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != "rolled_back" || receipt.Retained != 0 {
		t.Fatalf("rollback incomplete: %s retained=%d", receipt.Status, receipt.Retained)
	}
	actual, err := ReadBaselines(ctx, f.target)
	if err != nil || factsHash(actual) != factsHash(e.plan.Baseline) {
		t.Fatal("rollback changed baseline")
	}
	var ledger int
	if f.target.QueryRow("SELECT COUNT(*) FROM mig_source_row").Scan(&ledger) != nil || ledger == 0 {
		t.Fatal("rollback lost ledger")
	}
	_, err = e.rollback(ctx)
	if err != nil {
		t.Fatal("rollback replay", err)
	}
}
func TestToolVerifyMutationsMySQL(t *testing.T) {
	f := newToolFixture(t)
	extendMutationFixture(t, f)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ name, sql, restore string }{
		{"M1_ledger_missing", "DELETE FROM mig_source_row WHERE source_table='wb_contract' AND source_pk='1'", ""},
		{"M5_target_missing", "DELETE FROM altoc_customer_migration_snapshot WHERE customer_id=(SELECT id FROM altoc_customer WHERE code='CU-W000002')", ""},
		{"M6_preserved_domain", "INSERT INTO mig_object_map(source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition,batch_id) SELECT 'wizbiz','wb_invoice','1','altoc','altoc_customer','CU-W000002','extra','matched_existing',id FROM mig_batch", ""},
		{"M8_null_effective", "UPDATE altoc_contract SET effective_amount=signed_amount WHERE code='CT-W000002'", ""},
		{"M10_swap_snapshots", "UPDATE altoc_contract_migration_snapshot SET remaining_uninvoiced_amount=CASE WHEN remaining_uninvoiced_amount=30.00 THEN 50.00 ELSE 30.00 END", ""},
		{"M13_parent", "UPDATE altoc_customer SET parent_customer_id=(SELECT id FROM (SELECT id FROM altoc_customer WHERE code='CU-W000003') c) WHERE code='CU-W000002'", ""},
		{"M14_parent_cycle", "UPDATE altoc_customer SET parent_customer_id=CASE WHEN code='CU-W000002' THEN (SELECT id FROM (SELECT id FROM altoc_customer WHERE code='CU-W000003') c) ELSE (SELECT id FROM (SELECT id FROM altoc_customer WHERE code='CU-W000002') c) END WHERE code IN ('CU-W000002','CU-W000003')", ""},
		{"M15_contact_customer", "UPDATE altoc_contact SET customer_id=(SELECT id FROM altoc_customer WHERE code='CU-W000003') WHERE code='CN-W000001'", ""},
		{"M22_unrelated", "UPDATE altoc_customer SET name='altered' WHERE code='BASELINE-ONLY'", ""},
		{"M2_ledger_content", "UPDATE mig_source_row SET row_json=JSON_SET(row_json,'$.org_name','altered') WHERE source_table='wb_organization' AND source_pk='2'", ""},
		{"M4_mapping", "DELETE FROM mig_object_map WHERE source_table='wb_contract' AND map_role='primary'", ""},
		{"M7_category", "UPDATE altoc_contract SET contract_category='other' WHERE code='CT-W000001'", ""},
		{"M9_amount", "UPDATE altoc_contract SET signed_amount=signed_amount+0.01 WHERE code='CT-W000001'", ""},
		{"M11_balance_snapshot", "UPDATE finance_account_balance_snapshot SET balance_amount=500.00", ""},
		{"M12_latest_flag", "UPDATE finance_account_balance_entry SET is_day_latest=1 WHERE entry_ref=2", ""},
		{"M16_primary_contact", "UPDATE altoc_customer SET primary_contact_id=(SELECT id FROM altoc_contact WHERE code='CN-W000002') WHERE code='CU-W000002'", ""},
		{"M17_mask", "UPDATE finance_bank_account SET account_no_masked='altered'", ""},
		{"M18_exception_secret", "UPDATE mig_exception SET detail_json=JSON_SET(detail_json,'$.accountNumber','synthetic-private')", ""},
		{"M19_workflow", "UPDATE altoc_contract SET workflow_instance_id=1 WHERE code='CT-W000001'", ""},
		{"M20_outbox_side_effect", "INSERT INTO altoc_integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256) VALUES('00000000-0000-4000-8000-000000000001','mutation','mutation','C000001','C000001-test-enterprise','altoc','console','mutation','mutation','contract','CT-W000001','mutation','{}',REPEAT('0',64))", ""},
		{"M21_owner", "UPDATE altoc_customer SET owner_uid='system:other'", ""},
		{"M23_timezone", "UPDATE finance_account_balance_entry SET recorded_at=DATE_ADD(recorded_at,INTERVAL 8 HOUR)", ""},
		{"M24_sign_day", "UPDATE altoc_contract SET sign_date=DATE_SUB(sign_date,INTERVAL 1 DAY)", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db := f.target
			if c.name == "M20_outbox_side_effect" {
				mc := mysql.NewConfig()
				mc.User = "root"
				mc.Net = "unix"
				mc.Addr = f.profile.Source.Socket
				mc.DBName = f.profile.Database
				var err error
				db, err = sql.Open("mysql", mc.FormatDSN())
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
			}
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err = tx.Exec(c.sql); err != nil {
				t.Fatal("synthetic mutation", err)
			}
			input, err := fixtureVerifierInput(ctx, e)
			if err != nil {
				t.Fatal(err)
			}
			result, err := independentverify.Verify(ctx, tx, input)
			if err == nil || len(result.Differences) == 0 {
				t.Fatal("mutation undetected")
			}
			for _, difference := range result.Differences {
				if difference.SourcePK != "" {
					return
				}
			}
			t.Fatal("no source-key attribution", fmt.Sprint(result.Differences))
		})
	}
}
func fixtureVerifierInput(ctx context.Context, e *engine) (independentverify.Input, error) {
	data, _, err := e.source.ReadCovered(ctx, e.manifest, e.profile.VaultWrite)
	if err != nil {
		return independentverify.Input{}, err
	}
	input := independentverify.Input{Data: data, Keys: map[string]string{}, Declarations: map[string][]independentverify.Field{}, Identities: map[string]independentverify.Identity{}, SnapshotID: e.manifest.SnapshotID, BatchCode: e.profile.BatchCode, VaultMode: e.profile.VaultWrite, Baseline: map[string][]independentverify.Baseline{}, Vault: func(ctx context.Context, code, hash, mask string) error {
		if e.vault.(*fixtureVault).ensured[code] != hash {
			return ErrVault
		}
		return nil
	}}
	for table, decl := range Declarations() {
		input.Keys[table] = decl.PrimaryKey[0]
		for _, f := range decl.Columns {
			input.Declarations[table] = append(input.Declarations[table], independentverify.Field{Name: f.Name, Disposition: f.Disposition, Target: f.Target})
		}
	}
	for table, rows := range e.plan.Baseline {
		input.Baseline[table] = []independentverify.Baseline{}
		for _, r := range rows {
			input.Baseline[table] = append(input.Baseline[table], independentverify.Baseline{Key: r.Key, SHA256: r.SHA256, PrimaryKey: r.PrimaryKey})
		}
	}
	populateVerifierIDAllocations(&input, e.plan)
	err = e.target.QueryRowContext(ctx, "SELECT id FROM mig_batch WHERE batch_code=?", e.profile.BatchCode).Scan(&input.BatchID)
	return input, err
}

func extendMutationFixture(t *testing.T, f *toolFixture) {
	t.Helper()
	add := func(table string, row map[string]any) {
		columns, marks, args := []string{}, []string{}, []any{}
		for _, c := range Declarations()[table].Columns {
			columns = append(columns, "`"+c.Name+"`")
			marks = append(marks, "?")
			args = append(args, row[c.Name])
		}
		if _, err := f.root.Exec("INSERT INTO `"+f.profile.Source.Database+"`.`"+table+"` ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...); err != nil {
			t.Fatal("extended synthetic row", err)
		}
		f.data[table] = append(f.data[table], row)
		definition := f.manifest.Tables[table]
		definition.Rows = uint64(len(f.data[table]))
		f.manifest.Tables[table] = definition
	}
	customer := cloneRow(f.data["wb_organization"][1])
	customer["org_id"] = "3"
	customer["org_name"] = "TEST Second Customer"
	customer["contactman_id"] = "2"
	add("wb_organization", customer)
	contact := cloneRow(f.data["wb_contactman"][0])
	contact["contactman_id"] = "2"
	contact["org_id"] = "3"
	contact["cm_name"] = "TEST Second Contact"
	add("wb_contactman", contact)
	contract := cloneRow(f.data["wb_contract"][0])
	contract["contract_id"] = "2"
	contract["contract_code"] = "TEST-C002"
	contract["contract_name"] = "TEST Second Contract"
	contract["prime_amount"] = nil
	contract["invoice_amount"] = "50.00"
	add("wb_contract", contract)
	balance := cloneRow(f.data["wb_account_balance"][0])
	balance["ab_id"] = "2"
	balance["balance"] = "500.00"
	balance["operate_time"] = "2024-02-01 08:15:00"
	add("wb_account_balance", balance)
	f.manifestHash = factsHash(f.manifest)
	if _, err := f.root.Exec("INSERT INTO `" + f.profile.Database + "`.altoc_customer(code,name,owner_uid) VALUES('BASELINE-ONLY','Synthetic baseline','fixture')"); err != nil {
		t.Fatal("synthetic baseline", err)
	}
}
func TestToolChangedSourceMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	e.source.Close()
	if _, err := f.root.Exec("UPDATE `" + f.profile.Source.Database + "`.wb_contract SET total_amount=total_amount+1 WHERE contract_id=1"); err != nil {
		t.Fatal(err)
	}
	e.source = f.sourceSnapshot(t)
	if _, err := e.verify(ctx, func(context.Context, string, string, string) error { return nil }); err == nil {
		t.Fatal("M3 changed source accepted")
	}
}

func TestToolResumeAndHistoricalGuardMySQL(t *testing.T) {
	f := newToolFixture(t)
	for i := 3; i <= 205; i++ {
		row := cloneRow(f.data["wb_invoice"][0])
		row[Declarations()["wb_invoice"].PrimaryKey[0]] = fmt.Sprint(i)
		columns, marks, args := []string{}, []string{}, []any{}
		for _, c := range Declarations()["wb_invoice"].Columns {
			columns = append(columns, "`"+c.Name+"`")
			marks = append(marks, "?")
			args = append(args, row[c.Name])
		}
		if _, err := f.root.Exec("INSERT INTO `"+f.profile.Source.Database+"`.wb_invoice ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...); err != nil {
			t.Fatal("synthetic resume row", err)
		}
		f.data["wb_invoice"] = append(f.data["wb_invoice"], row)
	}
	definition := f.manifest.Tables["wb_invoice"]
	definition.Rows = uint64(len(f.data["wb_invoice"]))
	f.manifest.Tables["wb_invoice"] = definition
	f.manifestHash = factsHash(f.manifest)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	calls := 0
	e.stopped = func(context.Context) error {
		calls++
		if calls == 5 {
			return ErrTarget
		}
		return nil
	}
	if _, err := e.apply(ctx); err != ErrTarget {
		t.Fatal("interrupted apply did not stop", err)
	}
	var committed int
	if err := f.target.QueryRow("SELECT COUNT(*) FROM mig_batch_step WHERE status='completed'").Scan(&committed); err != nil || committed == 0 {
		t.Fatal("no durable completed step")
	}
	e.stopped = func(context.Context) error { return nil }
	if _, err := f.target.Exec("UPDATE mig_batch_step SET result_sha256=REPEAT('0',64) WHERE status='completed'"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.apply(ctx); err != ErrStep {
		t.Fatal("tampered step accepted", err)
	}
	for _, step := range e.plan.Steps {
		if _, err := f.target.Exec("UPDATE mig_batch_step SET result_sha256=? WHERE step=? AND status='completed'", step.ExpectedSHA256, step.Step); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.apply(ctx); err != nil {
		t.Fatal("resume", err)
	}
	if _, err := e.verify(ctx, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal("resumed verify", err)
	}
	old := f.build
	e.build = func() (RuntimeBuildEvidence, error) { b := old; b.HistoricalGuardCommit = ""; return b, nil }
	if _, err := e.apply(ctx); err == nil {
		t.Fatal("old Runtime accepted")
	}
}

func TestToolRollbackRetentionAndReplayMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := f.target.Exec("UPDATE altoc_contract SET signed_amount=signed_amount+1 WHERE code='CT-W000001'"); err != nil {
		t.Fatal(err)
	}
	receipt, err := e.rollback(ctx)
	if err != nil || receipt.Status != "rollback_partial" || len(receipt.RetainedObjects) == 0 {
		t.Fatal("modified contract not retained", receipt.Status, err)
	}
	var contracts, customers int
	if f.target.QueryRow("SELECT COUNT(*) FROM altoc_contract").Scan(&contracts) != nil || contracts != 1 {
		t.Fatal("modified contract deleted")
	}
	if f.target.QueryRow("SELECT COUNT(*) FROM altoc_customer").Scan(&customers) != nil || customers != 1 {
		t.Fatal("referenced customer deleted")
	}
	replay, err := e.rollback(ctx)
	if err != nil || replay.Retained != receipt.Retained {
		t.Fatal("partial rollback replay", err, replay.Retained, receipt.Retained)
	}
}
