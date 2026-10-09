package wizbiztool

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
)

func TestContractContactAndThirdPartyMappingMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	insert := func(table string, row map[string]any) {
		t.Helper()
		var fields, marks []string
		var args []any
		for _, d := range Declarations()[table].Columns {
			fields = append(fields, "`"+d.Name+"`")
			marks = append(marks, "?")
			args = append(args, row[d.Name])
		}
		if _, err := f.root.Exec("INSERT INTO `"+f.profile.Source.Database+"`."+table+" ("+strings.Join(fields, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...); err != nil {
			t.Fatal(err)
		}
		f.data[table] = append(f.data[table], row)
		definition := f.manifest.Tables[table]
		definition.Rows = uint64(len(f.data[table]))
		f.manifest.Tables[table] = definition
		f.manifestHash = factsHash(f.manifest)
	}
	org := cloneRow(f.data["wb_organization"][1])
	org["org_id"] = "3"
	org["org_name"] = "Synthetic Other Customer"
	org["short_name"] = "OTHER"
	org["contactman_id"] = nil
	insert("wb_organization", org)
	f.data["wb_contactman"][0]["org_id"] = "3"
	if _, err := f.root.Exec("UPDATE `" + f.profile.Source.Database + "`.wb_contactman SET org_id=3 WHERE contactman_id=1"); err != nil {
		t.Fatal(err)
	}
	f.data["wb_contract"][0]["contactman_id"] = "1"
	if _, err := f.root.Exec("UPDATE `" + f.profile.Source.Database + "`.wb_contract SET contactman_id=1 WHERE contract_id=1"); err != nil {
		t.Fatal(err)
	}
	contract := cloneRow(f.data["wb_contract"][0])
	contract["contract_id"] = "2"
	contract["contract_code"] = "TEST-SECOND"
	contract["is_third_party"] = "Y"
	contract["contactman_id"] = nil
	insert("wb_contract", contract)
	if a, err := AuditStageTransforms(ctx, f.sourceSnapshot(t), f.manifest, f.profile); err != nil || !a.Ready {
		t.Fatal("approved values blocked", a.Blockers)
	}
	e := newFixtureEngine(t, f)
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.verify(ctx, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for i, want := range []int{0, 1} {
		var got int
		var contact any
		if err := f.target.QueryRow("SELECT is_third_party,contact_id FROM altoc_contract WHERE code=?", fmt.Sprintf("CT-W%06d", i+1)).Scan(&got, &contact); err != nil || got != want || contact != nil {
			t.Fatal("contract mapping mismatch", err)
		}
	}
	var n int
	if err := f.target.QueryRow("SELECT COUNT(*) FROM mig_exception WHERE kind='contract_contact_mismatch' AND owning_domain='altoc' AND source_table='wb_contract' AND source_pk='1' AND target_table='altoc_contract' AND target_key='CT-W000001'").Scan(&n); err != nil || n != 1 {
		t.Fatal("exception absent", err)
	}
	var raw string
	if err := f.target.QueryRow("SELECT row_json FROM mig_source_row WHERE source_table='wb_contract' AND source_pk='1'").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var row map[string]any
	if json.Unmarshal([]byte(raw), &row) != nil || row["contactman_id"] != "1" || row["is_third_party"] != "N" {
		t.Fatal("source values lost")
	}
	input, err := fixtureVerifierInput(ctx, e)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"UPDATE altoc_contract SET contact_id=(SELECT id FROM altoc_contact WHERE code='CN-W000001') WHERE code='CT-W000001'",
		"UPDATE altoc_contract SET is_third_party=1 WHERE code='CT-W000001'",
		"UPDATE altoc_contract SET is_third_party=0 WHERE code='CT-W000002'",
		"DELETE FROM mig_exception WHERE kind='contract_contact_mismatch'",
		"UPDATE mig_exception SET detail_json=JSON_SET(detail_json,'$.contactSourceOrgId','2') WHERE kind='contract_contact_mismatch'",
		"UPDATE mig_source_row SET row_json=JSON_SET(row_json,'$.contactman_id',NULL) WHERE source_table='wb_contract' AND source_pk='1'",
	} {
		tx, err := f.target.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(q); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		_, err = independentverify.Verify(ctx, tx, input)
		tx.Rollback()
		if err == nil {
			t.Fatal("mutation accepted")
		}
	}
	for _, bad := range []any{nil, "0", "1", "y", "n", "", "?"} {
		data := SourceData{}
		for table, rows := range f.data {
			for _, r := range rows {
				data[table] = append(data[table], cloneRow(r))
			}
		}
		data["wb_contract"][0]["is_third_party"] = bad
		if a := AuditTransformValues(data, f.profile); a.Ready {
			t.Fatal("unknown source enum accepted")
		}
	}
}

func TestContractThirdPartyGolden(t *testing.T) {
	for _, c := range []struct{ source, target, canonical, sha string }{
		{"N", "0", `{"is_third_party":"N"}`, "35b983a91f91bf3c37f53f89021a2a4d9ad9cc037447d3854d0096514a60bb94"},
		{"Y", "1", `{"is_third_party":"Y"}`, "efe64e9baf89d0db39a2cbaf89ebb4291f6702a43f01c58105963068fc6bfc63"},
	} {
		raw, err := CanonicalRow(map[string]any{"is_third_party": c.source})
		if err != nil || string(raw) != c.canonical || Digest(raw) != c.sha {
			t.Fatal("source golden mismatch")
		}
		v, err := fixedEnum(c.source, map[string]string{"N": "0", "Y": "1"})
		if err != nil || v != c.target {
			t.Fatal("mapped golden mismatch")
		}
	}
}
