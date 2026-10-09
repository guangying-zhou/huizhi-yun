package independentverify

import (
	"encoding/json"
	"math/big"
	"sort"
	"strconv"
)

type expectedException struct {
	kind, table, pk, domain string
	target, key             any
	detail                  map[string]any
}

func (v *verifier) exceptions() {
	expected := map[string]expectedException{}
	add := func(e expectedException) { expected[e.kind+"/"+e.table+"/"+e.pk] = e }
	missing := map[string]map[string]bool{}
	for table, rows := range v.input.Data {
		for _, s := range rows {
			for field, source := range map[string]string{"employee_id": "wb_employee", "operator_id": "sys_user"} {
				id := text(s, field)
				if id != "" && id != "0" && v.source(source, id) == nil {
					key := source + "/" + id
					if missing[key] == nil {
						missing[key] = map[string]bool{}
					}
					missing[key][table] = true
				}
			}
		}
	}
	for _, table := range []string{"wb_employee", "sys_user"} {
		for key, refs := range missing {
			prefix := table + "/"
			if len(key) < len(prefix) || key[:len(prefix)] != prefix {
				continue
			}
			names := []string{}
			for name := range refs {
				names = append(names, name)
			}
			sort.Strings(names)
			add(expectedException{"identity_source_missing", table, key[len(prefix):], "altoc", nil, nil, map[string]any{"referencedBy": names}})
		}
	}
	for _, s := range v.input.Data["wb_organization"] {
		pk := text(s, "org_id")
		if text(s, "org_type") == "0" {
			continue
		}
		owner, _ := v.owner(s)
		if text(s, "org_status") == "0" && owner == "system:unassigned" {
			add(expectedException{"owner_unmatched", "wb_organization", pk, "altoc", "altoc_customer", code("CU", pk), map[string]any{"sourceUserId": s["employee_id"]}})
		}
		if contact := text(s, "contactman_id"); contact != "" && contact != "0" {
			c := v.source("wb_contactman", contact)
			if c == nil || text(c, "org_id") != pk {
				var org any
				if c != nil {
					org = c["org_id"]
				}
				add(expectedException{"primary_contact_mismatch", "wb_organization", pk, "altoc", "altoc_customer", code("CU", pk), map[string]any{"sourceContactId": s["contactman_id"], "contactSourceOrgId": org}})
			}
		}
	}
	for _, s := range v.input.Data["wb_contactman"] {
		if id := text(s, "org_id"); id == "" || id == "0" {
			add(expectedException{"contact_without_customer", "wb_contactman", text(s, "contactman_id"), "altoc", nil, nil, map[string]any{"sourceUserId": s["employee_id"]}})
		}
	}
	for _, s := range v.input.Data["wb_contract"] {
		pk := text(s, "contract_id")
		owner, _ := v.owner(s)
		if text(s, "contract_status") == "0" && owner == "system:unassigned" {
			add(expectedException{"owner_unmatched", "wb_contract", pk, "altoc", "altoc_contract", code("CT", pk), map[string]any{"sourceUserId": s["employee_id"]}})
		}
		if id := text(s, "contactman_id"); id != "" && id != "0" && v.source("wb_contactman", id) == nil {
			add(expectedException{"contact_orphan", "wb_contract", pk, "altoc", "altoc_contract", code("CT", pk), map[string]any{"sourceContactId": s["contactman_id"]}})
		}
		if id := text(s, "contactman_id"); id != "" && id != "0" {
			if c := v.source("wb_contactman", id); c != nil && text(c, "org_id") != text(s, "customer_id") {
				add(expectedException{"contract_contact_mismatch", "wb_contract", pk, "altoc", "altoc_contract", code("CT", pk), map[string]any{"sourceContactId": s["contactman_id"], "contactSourceOrgId": c["org_id"]}})
			}
		}
		total, ok := money(s["total_amount"])
		if !ok {
			v.fail("wb_contract", pk, "exception_money")
			continue
		}
		if effective, ok := money(s["prime_amount"]); ok && effective.Cmp(total) > 0 {
			add(expectedException{"effective_amount_exceeds_total", "wb_contract", pk, "altoc", "altoc_contract", code("CT", pk), map[string]any{"totalAmount": s["total_amount"], "effectiveAmount": s["prime_amount"]}})
		}
		sum := new(big.Rat)
		for _, income := range v.input.Data["wb_project_income"] {
			if text(income, "contract_id") == pk {
				a, ok := money(income["amount"])
				if !ok {
					v.fail("wb_contract", pk, "exception_money")
					continue
				}
				sum.Add(sum, a)
			}
		}
		remaining := new(big.Rat).Sub(total, sum)
		if cached, ok := money(s["exec_amount"]); ok && cached.Cmp(remaining) != 0 {
			add(expectedException{"contract_balance_mismatch", "wb_contract", pk, "finance", "altoc_contract", code("CT", pk), map[string]any{"cachedAmount": s["exec_amount"], "recomputedAmount": remaining.FloatString(2), "difference": new(big.Rat).Sub(cached, remaining).FloatString(2)}})
		}
	}
	groups := map[string][]map[string]any{}
	for _, s := range v.input.Data["wb_account_balance"] {
		key := text(s, "ba_id") + "/" + text(s, "check_date")
		groups[key] = append(groups[key], s)
	}
	for _, rows := range groups {
		first := rows[0]
		day, bank := text(first, "check_date"), text(first, "ba_id")
		latest := ""
		for _, s := range rows {
			if text(s, "operate_time") > latest {
				latest = text(s, "operate_time")
			}
		}
		amountSet := map[string]bool{}
		ids := []string{}
		for _, s := range rows {
			ids = append(ids, text(s, "ab_id"))
			if text(s, "operate_time") == latest {
				amountSet[text(s, "balance")] = true
			}
		}
		amounts := []string{}
		for a := range amountSet {
			amounts = append(amounts, a)
		}
		sort.Strings(amounts)
		sort.Strings(ids)
		if bank == "0" {
			add(expectedException{"balance_without_account", "wb_account_balance", "date:" + day, "finance", nil, nil, map[string]any{"balanceDate": day, "entryCount": strconv.Itoa(len(rows)), "latestAmounts": amounts, "sourceEntryIds": ids}})
		} else if len(amounts) > 1 {
			add(expectedException{"balance_latest_conflict", "wb_account_balance", "account:" + bank + "|date:" + day, "finance", "finance_bank_account", code("BA", bank), map[string]any{"balanceDate": day, "latestAmounts": amounts, "sourceEntryIds": ids}})
		}
	}
	rows, err := v.q.QueryContext(v.ctx, "SELECT kind,source_table,source_pk,owning_domain,target_table,target_key,detail_json FROM mig_exception WHERE batch_id=?", v.input.BatchID)
	if err != nil {
		v.fail("mig_exception", "", "exception_query")
		return
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var kind, table, pk, domain, raw string
		var target, key any
		if rows.Scan(&kind, &table, &pk, &domain, &target, &key, &raw) != nil {
			v.fail("mig_exception", "", "exception_row")
			continue
		}
		id := kind + "/" + table + "/" + pk
		e, ok := expected[id]
		seen[id] = true
		want, _ := json.Marshal(e.detail)
		var decoded map[string]any
		err := json.Unmarshal([]byte(raw), &decoded)
		normalized, _ := json.Marshal(decoded)
		if !ok || domain != e.domain || !same(target, e.target) || !same(key, e.key) || err != nil || string(normalized) != string(want) {
			v.fail(table, pk, "exception_contract")
		}
	}
	if rows.Err() != nil {
		v.fail("mig_exception", "", "exception_query")
	}
	for id, e := range expected {
		if !seen[id] {
			v.fail(e.table, e.pk, "exception_missing")
		}
	}
}
