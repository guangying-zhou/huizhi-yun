package wizbiztool

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
)

func TestBankSortMissingMapsDefaultAndPreservesNullMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	f.data["wb_bank_account"][0]["account_sn"] = nil
	if _, e := f.root.Exec("UPDATE `" + f.profile.Source.Database + "`.wb_bank_account SET account_sn=NULL"); e != nil {
		t.Fatal(e)
	}

	e := newFixtureEngine(t, f)
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.verify(ctx, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	var number int
	var raw string
	if err := f.target.QueryRow("SELECT sort_no FROM finance_bank_account WHERE code='BA-W000001'").Scan(&number); err != nil || number != 0 {
		t.Fatal("missing source order not mapped to default")
	}
	if err := f.target.QueryRow("SELECT row_json FROM mig_source_row WHERE source_table='wb_bank_account' AND source_pk='1'").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var row map[string]any
	if json.Unmarshal([]byte(raw), &row) != nil || row["account_sn"] != nil {
		t.Fatal("source NULL lost")
	}
	input, err := fixtureVerifierInput(ctx, e)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"UPDATE finance_bank_account SET sort_no=1 WHERE code='BA-W000001'", "UPDATE mig_source_row SET row_json=JSON_SET(row_json,'$.account_sn','0') WHERE source_table='wb_bank_account' AND source_pk='1'"} {
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
			t.Fatal("sort mapping mutation accepted")
		}
	}
}
func TestBankSortMappingGolden(t *testing.T) {
	for _, v := range []any{nil, "0", "1", "-1", "42"} {
		want := v
		if v == nil {
			want = "0"
		}
		if bankAccountSortNumber(v) != want {
			t.Fatal("non-null order changed")
		}
	}
	a, _ := CanonicalRow(map[string]any{"account_sn": nil})
	b, _ := CanonicalRow(map[string]any{"account_sn": "0"})
	if string(a) != `{"account_sn":null}` || string(b) != `{"account_sn":"0"}` || Digest(a) == Digest(b) {
		t.Fatal("source NULL and zero merged")
	}
}
