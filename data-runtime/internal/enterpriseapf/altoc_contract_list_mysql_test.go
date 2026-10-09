package enterpriseapf

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
)

func TestAPFContractSignedDatePagesMySQL(t *testing.T) {
	s, db := customerFixture(t) // Cleanup drops this disposable database, not shared fixtures.
	ctx := context.Background()
	w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CU-B1','Synthetic','person')")
	type expected struct {
		id   int
		date string
	}
	want := []expected{}
	for id := 1; id <= 45; id++ {
		date := time.Date(2026, 1, 1+(id%17), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		origin := "native"
		var native, signed any = date, nil
		if id%2 == 0 {
			origin = "historical_import"
			signed = date + " 16:30:00"
			date = time.Date(2026, 1, 2+(id%17), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
			native = "2025-01-01"
		}
		if id%11 == 0 {
			native = nil
			signed = nil
			date = ""
		}
		if id == 43 {
			origin = "historical_import"
			native = "2026-01-18"
			date = "2026-01-18"
		} // History with no timestamp falls back to valid DATE.
		_, e := db.Exec("INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,origin_type,imported_batch_code,amount_basis,sign_date,signed_at,currency_code,amount_tax_inclusive) VALUES(?,?,?,1,'person',?,IF(?='historical_import','B1-synthetic',NULL),'header',?,?,'CNY',10)", id, fmt.Sprintf("CT-B1-%d", id), "Synthetic", origin, origin, native, signed)
		if e != nil {
			t.Fatal(e)
		}
		want = append(want, expected{id, date})
	}
	// Invisible row outranks everything, but must affect neither count nor summary.
	w3Exec(t, db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,sign_date,currency_code,amount_tax_inclusive) VALUES(99,'CT-B1-hidden','Synthetic',1,'other','2027-01-01','CNY',999)")
	sort.Slice(want, func(i, j int) bool {
		if want[i].date == want[j].date {
			return want[i].id > want[j].id
		}
		return want[i].date > want[j].date
	})
	scope := altoc.BasicReadScope{Access: "self"}
	read := func(q altoc.BasicReadQuery) map[string]any {
		v, e := s.ContractRead(ctx, "", "person", scope, q)
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	for page := 1; page <= 3; page++ {
		out := read(altoc.BasicReadQuery{Page: page, PageSize: 20})
		if out["total"] != 45 {
			t.Fatal("scope count", out["total"])
		}
		summary := out["summary"].(map[string]any)
		amounts := summary["amounts"].([]map[string]any)
		if summary["count"] != 45 || len(amounts) != 1 || amounts[0]["amount"] != "450.00" {
			t.Fatal(summary)
		}
		rows := out["items"].([]map[string]any)
		for i, row := range rows {
			w := want[(page-1)*20+i]
			if fmt.Sprint(row["id"]) != fmt.Sprint(w.id) || (w.date == "" && row["signed_date"] != nil) || (w.date != "" && row["signed_date"] != w.date) {
				t.Fatalf("page %d row %d wrong id/date: %v expected %+v", page, i, row, w)
			}
		}
	}
	filtered := []expected{}
	for _, row := range want {
		if row.date >= "2026-01-10" && row.date <= "2026-01-12" {
			filtered = append(filtered, row)
		}
	}
	out := read(altoc.BasicReadQuery{Page: 1, PageSize: 20, SignedDateFrom: "2026-01-10", SignedDateTo: "2026-01-12"})
	if out["total"] != len(filtered) || out["summary"].(map[string]any)["count"] != len(filtered) {
		t.Fatal("filtered count", out)
	}
	if out["summary"].(map[string]any)["amounts"].([]map[string]any)[0]["amount"] != fmt.Sprintf("%d.00", 10*len(filtered)) {
		t.Fatal("filtered summary", out)
	}
	again := read(altoc.BasicReadQuery{Page: 1, PageSize: 20})
	if fmt.Sprint(again["items"]) != fmt.Sprint(read(altoc.BasicReadQuery{Page: 1, PageSize: 20})["items"]) {
		t.Fatal("return list order changed")
	}
	empty := read(altoc.BasicReadQuery{Page: 1, PageSize: 20, SignedDateFrom: "2030-01-01"})
	if empty["total"] != 0 || len(empty["items"].([]map[string]any)) != 0 {
		t.Fatal("empty filter", empty)
	}
}

func TestAPFContractCustomerProjectionAndFiltersMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid,owner_dept_code) VALUES(1,'CU-visible','Customer visible','person','D1'),(2,'CU-hidden','Customer secret','other','D2')")
	for id := 1; id <= 25; id++ {
		customer := 1
		if id%2 == 0 {
			customer = 2
		}
		if _, e := db.Exec("INSERT INTO altoc_contract(id,code,name,contract_no,customer_id,owner_uid,sign_date,primary_type,direction,amount_tax_inclusive) VALUES(?,?, 'Contract', ?,?, 'person','2026-10-01','service','sales',?)", id, fmt.Sprintf("CT-%d", id), fmt.Sprintf("DOC-%d", id), customer, id); e != nil {
			t.Fatal(e)
		}
	}
	read := func(q altoc.BasicReadQuery, customer altoc.BasicReadScope) map[string]any {
		v, e := s.ContractRead(ctx, "", "person", altoc.BasicReadScope{Access: "self"}, q, customer)
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	q := altoc.BasicReadQuery{Page: 1, PageSize: 20}
	out := read(q, altoc.BasicReadScope{Access: "self"})
	if out["total"] != 25 {
		t.Fatal(out["total"])
	}
	for _, row := range out["items"].([]map[string]any) {
		visible := fmt.Sprint(row["customer_id"]) == "1"
		if row["customer_visible"] != visible || (!visible && row["customer_name"] != nil) || (visible && row["customer_name"] != "Customer visible") {
			t.Fatal("customer scope projection", row)
		}
	}
	out = read(q, altoc.BasicReadScope{Access: "none"})
	for _, row := range out["items"].([]map[string]any) {
		if row["customer_visible"] != false || row["customer_name"] != nil {
			t.Fatal("customer name leaked")
		}
	}
	q.Search = "secret"
	if out = read(q, altoc.BasicReadScope{Access: "self"}); out["total"] != 0 {
		t.Fatal("search disclosed hidden customers")
	}
	if out = read(q, altoc.BasicReadScope{Access: "all"}); out["total"] != 12 {
		t.Fatal("customer search", out["total"])
	}
	q.Search = "DOC-25"
	if out = read(q, altoc.BasicReadScope{Access: "none"}); out["total"] != 1 {
		t.Fatal("contract number search")
	}
	q = altoc.BasicReadQuery{Page: 1, PageSize: 20, OwnerUID: "person", Direction: "sales", ContractType: "service", AmountMin: "10.01", AmountMax: "20.00"}
	out = read(q, altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}})
	if out["total"] != 10 || len(out["items"].([]map[string]any)) != 10 || out["summary"].(map[string]any)["count"] != 10 {
		t.Fatal("filters not before pagination/count", out)
	}
	q.OwnerUID = "Person"
	if out = read(q, altoc.BasicReadScope{Access: "all"}); out["total"] != 0 {
		t.Fatal("owner case folded")
	}
	for _, q := range []altoc.BasicReadQuery{{Page: 1, PageSize: 20, AmountMin: "-1"}, {Page: 1, PageSize: 20, AmountMin: "10", AmountMax: "1"}, {Page: 1, PageSize: 20, Direction: "invalid"}, {Page: 1, PageSize: 20, OwnerUID: "person", OwnerUnassigned: true}} {
		if _, e := s.ContractRead(ctx, "", "person", altoc.BasicReadScope{Access: "all"}, q); e == nil {
			t.Fatal("invalid filter accepted")
		}
	}
	detail, e := s.ContractRead(ctx, "1", "person", altoc.BasicReadScope{Access: "self"}, altoc.BasicReadQuery{Page: 1, PageSize: 20}, altoc.BasicReadScope{Access: "self"})
	if e != nil {
		t.Fatal(e)
	}
	if detail.(map[string]any)["customer_name"] != "Customer visible" {
		t.Fatal("detail customer projection")
	}
}
