package wizbiztool

import "testing"

func TestExceptionQueueClosedContract(t *testing.T) {
	cases := []struct {
		kind, table, pk, domain, target, code string
		detail                                map[string]any
	}{
		{"owner_unmatched", "wb_organization", "2", "altoc", "altoc_customer", "CU-W000002", map[string]any{"sourceUserId": "9"}},
		{"contact_without_customer", "wb_contactman", "3", "altoc", "", "", map[string]any{"sourceUserId": nil}},
		{"contract_contact_mismatch", "wb_contract", "4", "altoc", "altoc_contract", "CT-W000004", map[string]any{"sourceContactId": "3", "contactSourceOrgId": nil}},
		{"contact_orphan", "wb_contract", "4", "altoc", "altoc_contract", "CT-W000004", map[string]any{"sourceContactId": "3"}},
		{"primary_contact_mismatch", "wb_organization", "2", "altoc", "altoc_customer", "CU-W000002", map[string]any{"sourceContactId": "3", "contactSourceOrgId": nil}},
		{"effective_amount_exceeds_total", "wb_contract", "4", "altoc", "altoc_contract", "CT-W000004", map[string]any{"totalAmount": "10.00", "effectiveAmount": "11.00"}},
		{"contract_balance_mismatch", "wb_contract", "4", "finance", "altoc_contract", "CT-W000004", map[string]any{"recomputedAmount": "1.00", "cachedAmount": "2.00", "difference": "1.00"}},
		{"balance_without_account", "wb_account_balance", "date:2024-01-01", "finance", "", "", map[string]any{"balanceDate": "2024-01-01", "entryCount": "2", "latestAmounts": []string{"1.00"}, "sourceEntryIds": []string{"1", "2"}}},
		{"balance_latest_conflict", "wb_account_balance", "account:5|date:2024-01-01", "finance", "finance_bank_account", "BA-W000005", map[string]any{"balanceDate": "2024-01-01", "latestAmounts": []string{"1.00", "2.00"}, "sourceEntryIds": []string{"1", "2"}}},
		{"identity_source_missing", "wb_employee", "9", "altoc", "", "", map[string]any{"referencedBy": []string{"wb_organization"}}},
	}
	for _, c := range cases {
		t.Run(c.kind, func(t *testing.T) {
			p := Prepared{Codes: map[string]string{"wb_organization/2": "CU-W000002", "wb_contract/4": "CT-W000004", "wb_bank_account/5": "BA-W000005"}, Exceptions: []Exception{{Kind: c.kind, Table: c.table, PK: c.pk, Detail: c.detail}}}
			if err := finalizeExceptions(&p); err != nil {
				t.Fatal(err)
			}
			e := p.Exceptions[0]
			if e.Domain != c.domain || ((e.TargetTable == nil) != (c.target == "")) || ((e.TargetKey == nil) != (c.code == "")) {
				t.Fatal("queue ownership or target mismatch")
			}
			if e.TargetTable != nil && (*e.TargetTable != c.target || *e.TargetKey != c.code) {
				t.Fatal("queue target mismatch")
			}
			e.Detail["unapproved"] = "value"
			p.Exceptions[0] = e
			if finalizeExceptions(&p) == nil {
				t.Fatal("extra detail key accepted")
			}
		})
	}
}
