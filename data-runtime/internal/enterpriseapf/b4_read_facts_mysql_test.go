package enterpriseapf

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
)

func TestAPFB4EffectiveMetricsMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CU-B4','Synthetic','person')")
	for _, q := range []string{
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,currency_code,amount_tax_inclusive,effective_amount) VALUES(1,'CT-B4-P','Synthetic',1,'person','CNY',100,80),(2,'CT-B4-C','Synthetic',1,'person','CNY',30,20),(3,'CT-B4-U','Synthetic',1,'person','CNY',10,NULL),(4,'CT-B4-USD','Synthetic',1,'person','USD',50,40),(5,'CT-B4-H','Synthetic',1,'other','CNY',999,999),(6,'CT-B4-HC','Synthetic',1,'person','CNY',9,9)",
		"UPDATE altoc_contract SET parent_contract_id=1 WHERE id=2", "UPDATE altoc_contract SET parent_contract_id=5 WHERE id=6"} {
		w3Exec(t, db, q)
	}
	read := func(q altoc.BasicReadQuery) []map[string]any {
		v, e := s.ContractRead(ctx, "", "person", altoc.BasicReadScope{Access: "self"}, q)
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)["summary"].(map[string]any)["effectiveMetrics"].([]map[string]any)
	}
	got := read(altoc.BasicReadQuery{Page: 1, PageSize: 1})
	if len(got) != 2 || got[0]["effective_amount"] != "89.00" || got[0]["contract_count"] != int64(3) || got[0]["missing_count"] != int64(1) || got[1]["effective_amount"] != "40.00" {
		t.Fatal("scoped currency/root metrics", got)
	}
	// Child remains a root of the filtered set when its parent is filtered out.
	got = read(altoc.BasicReadQuery{Page: 1, PageSize: 20, Search: "CT-B4-C"})
	if len(got) != 1 || got[0]["effective_amount"] != "20.00" {
		t.Fatal("filtered parent exclusion", got)
	}
}
func TestAPFB4BalancesAsOfMySQL(t *testing.T) {
	s, db := financeFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}
	for id := 1; id <= 5; id++ {
		if _, err := db.Exec("INSERT INTO finance_bank_account(id,code,account_name,currency_code) VALUES(?,?,?,?)", id, fmt.Sprintf("BA-B4-%d", id), "Synthetic", map[bool]string{true: "USD", false: "CNY"}[id == 5]); err != nil {
			t.Fatal(err)
		}
	}
	w3Exec(t, db, "INSERT INTO finance_account_balance_snapshot(bank_account_id,snapshot_date,balance_amount,currency_code,source_type) VALUES(1,'2026-01-01',10,'CNY','import'),(1,'2026-01-01',12,'CNY','manual'),(1,'2026-02-01',99,'CNY','manual'),(3,'2025-01-01',3,'CNY','import'),(4,'2026-01-01',1,'CNY','import'),(4,'2026-01-01',2,'CNY','manual'),(5,'2026-01-01',5,'USD','import')")
	// Authoritative manual conflict remains unknown, not an ID-selected winner.
	w3Exec(t, db, "UPDATE finance_account_balance_snapshot SET distinct_amounts=2 WHERE bank_account_id=4 AND source_type='manual'")
	read := func(state string) map[string]any {
		v, e := s.Finance(ctx, "accounts-list", FinanceInput{Page: 1, PageSize: 2, AsOfDate: "2026-01-15", StaleBefore: "2026-01-01", BalanceState: state}, who)
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	out := read("")
	if out["total"] != int64(5) || len(out["data"].([]map[string]any)) != 2 {
		t.Fatal(out)
	}
	totals := out["balanceTotals"].([]map[string]any)
	if len(totals) != 2 || totals[0]["amount"] != "15.00" || totals[0]["missing_count"] != int64(1) || totals[0]["conflict_count"] != int64(1) || totals[0]["stale_count"] != int64(1) {
		t.Fatal("cutoff/manual/conflict/currency", totals)
	}
	for _, state := range []string{"missing", "conflict", "stale"} {
		if read(state)["total"] != int64(1) {
			t.Fatal(state)
		}
	}
}
