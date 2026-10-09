package enterpriseapf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAPFContractListSummaryAndCustomerRollupMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	for _, q := range []string{
		"INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(1,'C1','root','a',NULL),(2,'C2','child','a',1),(3,'C3','grandchild','b',2),(4,'C4','unrelated','a',NULL)",
		"INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id,deleted_at) VALUES(5,'C5','deleted child','a',1,CURRENT_TIMESTAMP(3))",
		`INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,owner_dept_code,direction,status,amount_tax_inclusive,currency_code,sign_date) VALUES
			(1,'CT1','own',1,'a','D1','sales','effective',100,'CNY',CURRENT_DATE),
			(2,'CT2','old',2,'a','D1','sales','effective',200,'CNY',DATE_SUB(CURRENT_DATE,INTERVAL 3 YEAR)),
			(3,'CT3','hidden from a',3,'b','D2','sales','effective',400,'CNY',CURRENT_DATE),
			(4,'CT4','terminated',2,'a','D1','sales','terminated',800,'CNY',CURRENT_DATE),
			(5,'CT5','purchase',2,'a','D1','purchase','effective',1600,'CNY',CURRENT_DATE),
			(6,'CT6','usd',3,'a','D1','sales','effective',50,'USD',CURRENT_DATE),
			(7,'CT7','unrelated',4,'a','D1','sales','effective',3200,'CNY',CURRENT_DATE),
			(8,'CT8','under deleted customer',5,'a','D1','sales','effective',6400,'CNY',CURRENT_DATE)`,
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,direction,status,amount_tax_inclusive,deleted_at) VALUES(9,'CT9','deleted',1,'a','sales','effective',12800,CURRENT_TIMESTAMP(3))",
	} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	read := func(actor string, scope altoc.BasicReadScope, q altoc.BasicReadQuery) map[string]any {
		t.Helper()
		if q.Page == 0 {
			q.Page, q.PageSize = 1, 20
		}
		v, e := s.ContractRead(ctx, "", actor, scope, q)
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(v)
		var out map[string]any
		if e = json.Unmarshal(raw, &out); e != nil {
			t.Fatal(e)
		}
		return out
	}
	amounts := func(v any) string {
		parts := []string{}
		for _, row := range v.([]any) {
			m := row.(map[string]any)
			parts = append(parts, fmt.Sprint(m["currency_code"], ":", m["count"], ":", m["amount"]))
		}
		return strings.Join(parts, " ")
	}
	all := altoc.BasicReadScope{Access: "all"}

	// Plain list: totals describe the whole filtered result and no rollup is attached.
	out := read("a", all, altoc.BasicReadQuery{Page: 1, PageSize: 2})
	if got := amounts(out["summary"].(map[string]any)["amounts"]); out["total"] != float64(8) || len(out["items"].([]any)) != 2 || got != "CNY:7:12700.00 USD:1:50.00" || out["rollup"] != nil {
		t.Fatal("list summary", out["total"], got, out["rollup"])
	}
	// The same filter on another page returns the same totals.
	if again := read("a", all, altoc.BasicReadQuery{Page: 3, PageSize: 2}); amounts(again["summary"].(map[string]any)["amounts"]) != "CNY:7:12700.00 USD:1:50.00" {
		t.Fatal("summary depends on page")
	}
	// Filters narrow the summary exactly like the list.
	if filtered := read("a", all, altoc.BasicReadQuery{Status: "terminated"}); amounts(filtered["summary"].(map[string]any)["amounts"]) != "CNY:1:800.00" {
		t.Fatal("summary ignores filter")
	}

	// Own customer only.
	out = read("a", all, altoc.BasicReadQuery{CustomerID: "1"})
	rollup := out["rollup"].(map[string]any)
	if out["total"] != float64(1) || rollup["count"] != float64(1) || amounts(rollup["amounts"]) != "CNY:1:100.00" || rollup["excluded"] != false {
		t.Fatal("own rollup", out["total"], rollup)
	}

	// Whole subtree: sales only, terminated counted apart, currencies kept apart,
	// deleted customers and contracts ignored.
	out = read("a", all, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	rollup = out["rollup"].(map[string]any)
	if out["total"] != float64(6) || rollup["count"] != float64(4) || rollup["terminatedCount"] != float64(1) || amounts(rollup["amounts"]) != "CNY:3:700.00 USD:1:50.00" || amounts(rollup["signedLast12Months"]) != "CNY:2:500.00 USD:1:50.00" || amounts(rollup["signedThisYear"]) != "CNY:2:500.00 USD:1:50.00" || rollup["excluded"] != false {
		t.Fatal("subtree rollup", out["total"], rollup)
	}
	if amounts(rollup["effectiveAmounts"]) != "CNY:3:0.00 USD:1:0.00" || rollup["effectiveAmounts"].([]any)[0].(map[string]any)["missingCount"] != float64(3) {
		t.Fatal("NULL effective amounts are missing, not filled zero", rollup)
	}
	// List filters narrow the list and its summary, not the customer rollup.
	filtered := read("a", all, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true, Status: "terminated", Search: "terminated"})
	if filtered["total"] != float64(1) || amounts(filtered["summary"].(map[string]any)["amounts"]) != "CNY:1:800.00" || amounts(filtered["rollup"].(map[string]any)["amounts"]) != "CNY:3:700.00 USD:1:50.00" {
		t.Fatal("filter leaked into rollup", filtered["total"], filtered["rollup"])
	}
	// The rollup never carries customer identities, only figures and one flag.
	for key := range rollup {
		switch key {
		case "count", "terminatedCount", "amounts", "effectiveAmounts", "effectiveMetrics", "signedLast12Months", "signedThisYear", "excluded":
		default:
			t.Fatal("unexpected rollup field", key)
		}
	}
	if raw, _ := json.Marshal(rollup); strings.Contains(string(raw), "customer") || strings.Contains(string(raw), "grandchild") || strings.Contains(string(raw), "C3") {
		t.Fatal("rollup leaks customer identity", string(raw))
	}

	// Contract scope limits the figures; hidden contracts only flip the flag.
	out = read("a", altoc.BasicReadScope{Access: "self"}, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	rollup = out["rollup"].(map[string]any)
	if out["total"] != float64(5) || rollup["count"] != float64(3) || amounts(rollup["amounts"]) != "CNY:2:300.00 USD:1:50.00" || rollup["excluded"] != true {
		t.Fatal("scoped rollup", out["total"], rollup)
	}
	for _, item := range out["items"].([]any) {
		if item.(map[string]any)["code"] == "CT3" {
			t.Fatal("out-of-scope contract listed")
		}
	}
	out = read("b", altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D2"}}, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	rollup = out["rollup"].(map[string]any)
	if out["total"] != float64(1) || amounts(rollup["amounts"]) != "CNY:1:400.00" || rollup["excluded"] != true {
		t.Fatal("dept rollup", out["total"], rollup)
	}
	out = read("nobody", altoc.BasicReadScope{Access: "none"}, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	if rollup = out["rollup"].(map[string]any); out["total"] != float64(0) || rollup["count"] != float64(0) || len(rollup["amounts"].([]any)) != 0 || rollup["excluded"] != true {
		t.Fatal("no-scope rollup", out["total"], rollup)
	}

	// A cycle terminates and yields the same figures.
	if _, e := db.Exec("UPDATE altoc_customer SET parent_customer_id=3 WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	out = read("a", all, altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	if amounts(out["rollup"].(map[string]any)["amounts"]) != "CNY:3:700.00 USD:1:50.00" {
		t.Fatal("cycle changed rollup")
	}
	if _, e := db.Exec("UPDATE altoc_customer SET parent_customer_id=NULL WHERE id=1"); e != nil {
		t.Fatal(e)
	}

	refused := func(q altoc.BasicReadQuery) {
		t.Helper()
		q.Page, q.PageSize = 1, 20
		_, e := s.ContractRead(ctx, "", "a", all, q)
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != 422 || he.Code != "altoc_customer_subtree_too_large" {
			t.Fatal("oversized subtree accepted", e)
		}
	}
	// Too deep: 3 → 100 → … → 109 puts customers below the tenth level under 1.
	for n := 100; n < 110; n++ {
		parent := n - 1
		if n == 100 {
			parent = 3
		}
		if _, e := db.Exec("INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(?,?,?,'a',?)", n, fmt.Sprint("D", n), "deep", parent); e != nil {
			t.Fatal(e)
		}
	}
	refused(altoc.BasicReadQuery{CustomerID: "1", IncludeDescendants: true})
	// Without the flag the same customer still reads normally.
	if out = read("a", all, altoc.BasicReadQuery{CustomerID: "1"}); out["total"] != float64(1) {
		t.Fatal("single customer affected by deep subtree")
	}
	// Too wide.
	values := []string{}
	for n := 0; n <= customerSubtreeNodes; n++ {
		values = append(values, fmt.Sprintf("(%d,'W%d','wide','a',4)", 10000+n, n))
	}
	if _, e := db.Exec("INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES" + strings.Join(values, ",")); e != nil {
		t.Fatal(e)
	}
	refused(altoc.BasicReadQuery{CustomerID: "4", IncludeDescendants: true})
}
