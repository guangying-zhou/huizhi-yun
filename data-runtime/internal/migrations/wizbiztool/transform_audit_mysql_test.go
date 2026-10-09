package wizbiztool

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestTransformAuditAggregatesMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	s := f.sourceSnapshot(t)
	p := f.profile
	p.RuntimeConfig = "/nonexistent"
	p.Target.Database = "no_target"
	p.Directory.Database = "no_directory"
	a, e := AuditStageTransforms(ctx, s, f.manifest, p)
	if e != nil || !a.Ready {
		t.Fatalf("source-only valid audit failed: %v / %v", e, a.Blockers)
	}
	// Multiple independent source failures; no first-error short circuit.
	f.data["wb_contactman"][0]["stars"] = "7"
	f.data["wb_bank_account"][0]["ba_type"] = "99"
	f.data["wb_contract"][0]["company_id"] = "999"
	f.data["wb_contract"][0]["parent_id"] = "1"
	f.data["wb_account_balance"][0]["operate_time"] = nil
	a = AuditTransformValues(f.data, f.profile)
	want := map[string]bool{"wb_contactman/stars/rating": false, "wb_bank_account/ba_type/enum": false, "wb_contract/company_id/legal_entity_reference": false, "wb_contract/parent_id/supplement_contract_unsupported": false, "wb_account_balance/operate_time/recorded_at_required": false}
	for _, b := range a.Blockers {
		k := b.Table + "/" + b.Field + "/" + b.Category
		if _, ok := want[k]; ok {
			want[k] = b.Count == 1
		}
	}
	for k, v := range want {
		if !v {
			t.Fatal("missing aggregate", k)
		}
	}
	if a.Ready {
		t.Fatal("invalid audit ready")
	}
	raw, _ := json.Marshal(a)
	if strings.Contains(string(raw), "TEST Customer") || strings.Contains(string(raw), "TEST-ACCOUNT") {
		t.Fatal("source value leaked")
	}
	var n int
	if f.target.QueryRow("SELECT COUNT(*) FROM mig_batch").Scan(&n) != nil || n != 0 {
		t.Fatal("audit wrote target")
	}
}
func TestContactStarsApplyVerifyMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	// Source 0, 1..6 and NULL in one self-cleaning isolated fixture.
	base := f.data["wb_contactman"][0]
	stars := []any{"0", "1", "2", "3", "4", "5", "6", nil}
	fields := []string{}
	for _, d := range Declarations()["wb_contactman"].Columns {
		fields = append(fields, d.Name)
	}
	if _, e := f.root.Exec("DELETE FROM `" + f.profile.Source.Database + "`.wb_contactman"); e != nil {
		t.Fatal(e)
	}
	f.data["wb_contactman"] = nil
	for i, v := range stars {
		row := cloneRow(base)
		row["contactman_id"] = fmt.Sprint(i + 1)
		row["stars"] = v
		f.data["wb_contactman"] = append(f.data["wb_contactman"], row)
		args := []any{}
		quoted := []string{}
		marks := []string{}
		for _, k := range fields {
			args = append(args, row[k])
			quoted = append(quoted, "`"+k+"`")
			marks = append(marks, "?")
		}
		if _, e := f.root.Exec("INSERT INTO `"+f.profile.Source.Database+"`.wb_contactman("+strings.Join(quoted, ",")+") VALUES("+strings.Join(marks, ",")+")", args...); e != nil {
			t.Fatal(e)
		}
	}
	m := f.manifest.Tables["wb_contactman"]
	m.Rows = uint64(len(stars))
	f.manifest.Tables["wb_contactman"] = m
	f.manifestHash = factsHash(f.manifest)
	e := newFixtureEngine(t, f)
	if _, x := e.apply(ctx); x != nil {
		t.Fatal(x)
	}
	if _, x := e.verify(ctx, func(context.Context, string, string, string) error { return nil }); x != nil {
		t.Fatal("verify mapping", x)
	}
	for i, source := range stars {
		var target any
		if x := f.target.QueryRow("SELECT star_level FROM altoc_contact WHERE code=?", fmt.Sprintf("CN-W%06d", i+1)).Scan(&target); x != nil {
			t.Fatal(x)
		}
		if source == nil || source == "0" {
			if target != nil {
				t.Fatal("unrated not NULL")
			}
		} else {
			if fmt.Sprint(target) != fmt.Sprint(source) {
				t.Fatal("rating changed")
			}
		}
	}
	var raw string
	if f.target.QueryRow("SELECT row_json FROM mig_source_row WHERE source_table='wb_contactman' AND source_pk='1'").Scan(&raw) != nil {
		t.Fatal("ledger")
	}
	var ledger map[string]any
	if json.Unmarshal([]byte(raw), &ledger) != nil || ledger["stars"] != "0" {
		t.Fatal("source zero lost")
	}
	for _, mutation := range []struct{ name, query string }{{"zero_to_nonnull", "UPDATE altoc_contact SET star_level=1 WHERE code='CN-W000001'"},
		{"source_zero_to_null_ledger", "UPDATE mig_source_row SET row_json=JSON_SET(row_json,'$.stars',NULL) WHERE source_table='wb_contactman' AND source_pk='1'"}, {"rated_to_null", "UPDATE altoc_contact SET star_level=NULL WHERE code='CN-W000002'"}, {"rated_changed", "UPDATE altoc_contact SET star_level=6 WHERE code='CN-W000002'"}, {"null_to_zero", "UPDATE altoc_contact SET star_level=0 WHERE code='CN-W000008'"}} {
		t.Run(mutation.name, func(t *testing.T) {
			tx, x := f.target.BeginTx(ctx, nil)
			if x != nil {
				t.Fatal(x)
			}
			defer tx.Rollback()
			if _, x = tx.Exec(mutation.query); x != nil {
				t.Fatal(x)
			}
			input, x := fixtureVerifierInput(ctx, e)
			if x != nil {
				t.Fatal(x)
			}
			if _, x = independentverify.Verify(ctx, tx, input); x == nil {
				t.Fatal("rating mutation undetected")
			}
		})
	}
	input, x := fixtureVerifierInput(ctx, e)
	if x != nil {
		t.Fatal(x)
	}
	input.Data["wb_contactman"][0]["stars"] = "7"
	result, verifyErr := independentverify.Verify(ctx, f.target, input)
	if verifyErr == nil {
		t.Fatal("invalid source rating accepted")
	}
	found := false
	for _, difference := range result.Differences {
		if difference.Check == "source_star_level_invalid" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing explicit invalid source rating verdict")
	}
}

func TestTransformAuditValueMatrixMySQL(t *testing.T) {
	f := newToolFixture(t)
	cases := []struct {
		table, field string
		value        any
		category     string
	}{
		{"wb_organization", "org_type", "9", "enum"},
		{"wb_organization", "org_status", "9", "enum"},
		{"wb_organization", "org_name", "", "required_or_length"},
		{"wb_contactman", "org_id", "999", "customer_reference"},
		{"wb_contactman", "stars", "-1", "rating"},
		{"wb_contactman", "chief", "9", "enum"},
		{"wb_contactman", "cm_name", "", "required_or_length"},
		{"wb_contactman", "phone", strings.Repeat("X", 31), "length"},
		{"wb_bank_account", "org_id", "2", "legal_entity_reference"},
		{"wb_bank_account", "ba_status", "9", "enum"},
		{"wb_bank_account", "account_name", "", "required_or_length"},
		{"wb_account_balance", "ba_id", "999", "account_reference"},
		{"wb_account_balance", "balance", "1.234", "amount_format"},
		{"wb_account_balance", "check_date", "2024-99-99", "date_format"},
		{"wb_account_balance", "operate_time", nil, "recorded_at_required"},
		{"wb_contract", "contract_id", "0", "source_key"},
		{"wb_contract", "contract_type", "7", "enum"},
		{"wb_contract", "contract_status", "9", "enum"},
		{"wb_contract", "parent_id", "1", "supplement_contract_unsupported"},
		{"wb_contract", "employee_id", nil, "exception_source_required"},
		{"wb_contract", "customer_id", "1", "customer_reference"},
		{"wb_contract", "company_id", "2", "legal_entity_reference"},
		{"wb_contract", "third_party_id", "1", "customer_reference"},
		{"wb_contract", "ba_id", "999", "account_reference"},
		{"wb_contract", "is_third_party", "9", "enum"},
		{"wb_contract", "contract_name", "", "required_or_length"},
		{"wb_contract", "payment", strings.Repeat("X", 501), "length"},
		{"wb_contract", "sign_date", "0000-00-00 00:00:00", "datetime_format"},
		{"wb_contract", "total_amount", "1", "amount_format"},
		{"wb_contract", "prime_amount", "1", "amount_format"},
		{"wb_contract", "exec_amount", "1", "amount_format"},
		{"wb_project_income", "amount", "1", "amount_format"},
	}
	for _, c := range cases {
		t.Run(c.table+"/"+c.field+"/"+c.category, func(t *testing.T) {
			data := SourceData{}
			for table, rows := range f.data {
				for _, r := range rows {
					data[table] = append(data[table], cloneRow(r))
				}
			}
			data[c.table][0][c.field] = c.value
			a := AuditTransformValues(data, f.profile)
			if a.Ready {
				t.Fatal("invalid ready")
			}
			found := false
			for _, b := range a.Blockers {
				if b.Table == c.table && b.Field == c.field && b.Category == c.category && b.Count == 1 {
					found = true
				}
			}
			if !found {
				t.Fatal("missing classified violation", a.Blockers)
			}
		})
	}
	// Relations are rechecked against all source rows, not just scalar formats.
	data := SourceData{}
	for table, rows := range f.data {
		for _, r := range rows {
			data[table] = append(data[table], cloneRow(r))
		}
	}
	data["wb_organization"][1]["parent_id"] = "2"
	data["wb_contract"][0]["contactman_id"] = "1"
	data["wb_contactman"][0]["org_id"] = "999"
	a := AuditTransformValues(data, f.profile)
	got := map[string]bool{}
	for _, b := range a.Blockers {
		got[b.Category] = true
	}
	if !got["cycle"] || !got["customer_reference"] {
		t.Fatal("relation failures missed")
	}
}

func TestStageTransformAuditCLIIsSourceOnlyMySQL(t *testing.T) {
	f := newToolFixture(t)
	profile := f.profile
	profile.Database = "missing_target"
	profile.Target.Database = profile.Database
	profile.ConsoleDatabase = "missing_directory"
	profile.Directory.Database = profile.ConsoleDatabase
	profile.RuntimeBinary = "/missing/runtime"
	profile.RuntimeConfig = "/missing/config.json"
	profile.SourceRepository = "/missing/source"
	dir := t.TempDir()
	profilePath := filepath.Join(dir, "profile.json")
	manifestPath := filepath.Join(dir, "manifest.json")
	out := filepath.Join(dir, "audit.json")
	exe := filepath.Join(dir, "tool")
	if WriteJSON(profilePath, profile) != nil || WriteJSON(manifestPath, f.manifest) != nil {
		t.Fatal("fixture files")
	}
	module, e := filepath.Abs("../../..")
	if e != nil {
		t.Fatal(e)
	}
	build := exec.Command("go", "build", "-o", exe, "./cmd/hzy-wizbiz-migrate")
	build.Dir = module
	if raw, e := build.CombinedOutput(); e != nil {
		t.Fatalf("synthetic CLI build: %s", raw)
	}
	command := func(output string) ([]byte, error) {
		return exec.Command(exe, "--mode", "stage-transform-audit", "--profile", profilePath, "--snapshot-manifest", manifestPath, "--out", output).CombinedOutput()
	}
	raw, e := command(out)
	if e != nil {
		t.Fatalf("source-only CLI failed: %s", raw)
	}
	var audit TransformAudit
	content, e := os.ReadFile(out)
	if e != nil || json.Unmarshal(content, &audit) != nil || !audit.Ready || audit.SnapshotSHA256 != f.manifest.SQLSHA256 {
		t.Fatal("successful audit missing")
	}
	for _, sql := range []string{"UPDATE wb_contactman SET stars=7", "UPDATE wb_contract SET contract_status='9'"} {
		if _, e := f.root.Exec("USE `" + f.profile.Source.Database + "`"); e != nil {
			t.Fatal(e)
		}
		if _, e := f.root.Exec(sql); e != nil {
			t.Fatal(e)
		}
	}
	blocked := filepath.Join(dir, "blocked.json")
	raw, e = command(blocked)
	if e == nil {
		t.Fatal("CLI did not fail closed")
	}
	content, e = os.ReadFile(blocked)
	if e != nil || json.Unmarshal(content, &audit) != nil || audit.Ready || len(audit.Blockers) != 2 {
		t.Fatalf("not all blockers emitted: %s", content)
	}
	if strings.Contains(string(raw), "TEST Customer") || strings.Contains(string(content), "TEST Contact") {
		t.Fatal("private source data output")
	}
}
