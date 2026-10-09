package wizbiztool

import (
	"sort"
	"strings"
)

// Fixed exception contract from Tool-Contract §10.1 (3c0c5f2c). No display
// names, contact data or account bytes are copied into exception details.
func finalizeExceptions(prepared *Prepared) error {
	for i := range prepared.Exceptions {
		e := &prepared.Exceptions[i]
		e.Domain = "altoc"
		keys := []string{}
		var target string
		switch e.Kind {
		case "owner_unmatched":
			keys = []string{"sourceUserId"}
			if e.Table == "wb_organization" {
				target = "altoc_customer"
			} else if e.Table == "wb_contract" {
				target = "altoc_contract"
			} else {
				return ErrValue
			}
		case "contact_without_customer":
			keys = []string{"sourceUserId"}
			if e.Table != "wb_contactman" {
				return ErrValue
			}
		case "contact_orphan":
			keys = []string{"sourceContactId"}
			target = "altoc_contract"
			if e.Table != "wb_contract" {
				return ErrValue
			}
		case "contract_contact_mismatch":
			keys = []string{"sourceContactId", "contactSourceOrgId"}
			target = "altoc_contract"
			if e.Table != "wb_contract" {
				return ErrValue
			}
		case "primary_contact_mismatch":
			keys = []string{"sourceContactId", "contactSourceOrgId"}
			target = "altoc_customer"
			if e.Table != "wb_organization" {
				return ErrValue
			}
		case "effective_amount_exceeds_total":
			keys = []string{"totalAmount", "effectiveAmount"}
			target = "altoc_contract"
			if e.Table != "wb_contract" {
				return ErrValue
			}
		case "contract_balance_mismatch":
			keys = []string{"recomputedAmount", "cachedAmount", "difference"}
			e.Domain = "finance"
			target = "altoc_contract"
			if e.Table != "wb_contract" {
				return ErrValue
			}
		case "balance_without_account":
			keys = []string{"balanceDate", "entryCount", "latestAmounts", "sourceEntryIds"}
			e.Domain = "finance"
			if e.Table != "wb_account_balance" || !strings.HasPrefix(e.PK, "date:") {
				return ErrValue
			}
		case "balance_latest_conflict":
			keys = []string{"balanceDate", "latestAmounts", "sourceEntryIds"}
			e.Domain = "finance"
			target = "finance_bank_account"
			if e.Table != "wb_account_balance" || !strings.HasPrefix(e.PK, "account:") {
				return ErrValue
			}
		case "identity_source_missing":
			keys = []string{"referencedBy"}
			if e.Table != "wb_employee" && e.Table != "sys_user" {
				return ErrValue
			}
		default:
			return ErrValue
		}
		if len(e.Detail) != len(keys) {
			return ErrValue
		}
		for _, key := range keys {
			value, ok := e.Detail[key]
			if !ok {
				return ErrValue
			}
			arrayKey := key == "referencedBy" || key == "latestAmounts" || key == "sourceEntryIds"
			nullable := (e.Kind == "contact_without_customer" && key == "sourceUserId") || key == "contactSourceOrgId"
			if arrayKey {
				values, ok := value.([]string)
				if !ok || len(values) == 0 {
					return ErrValue
				}
				for _, item := range values {
					if item == "" {
						return ErrValue
					}
				}
			} else if value == nil {
				if !nullable {
					return ErrValue
				}
			} else if text, ok := value.(string); !ok || text == "" {
				return ErrValue
			}

		}
		if target != "" {
			sourceKey := e.Table + "/" + e.PK
			if e.Kind == "balance_latest_conflict" {
				bank := strings.SplitN(strings.TrimPrefix(e.PK, "account:"), "|", 2)[0]
				sourceKey = "wb_bank_account/" + bank
			}
			key := prepared.Codes[sourceKey]
			if key == "" {
				return ErrValue
			}
			e.TargetTable = &target
			e.TargetKey = &key
		}
	}
	return nil
}
func mergeExceptionReferences(a, b map[string]any) map[string]any {
	set := map[string]bool{}
	for _, m := range []map[string]any{a, b} {
		for _, table := range m["referencedBy"].([]string) {
			set[table] = true
		}
	}
	values := []string{}
	for value := range set {
		values = append(values, value)
	}
	sort.Strings(values)
	return map[string]any{"referencedBy": values}
}
func exceptionBalanceEvidence(rows []map[string]any) ([]string, []string) {
	latest := ""
	for _, row := range rows {
		if sourceText(row, "operate_time") > latest {
			latest = sourceText(row, "operate_time")
		}
	}
	set := map[string]bool{}
	ids := []string{}
	for _, row := range rows {
		ids = append(ids, sourceText(row, "ab_id"))
		if sourceText(row, "operate_time") == latest {
			set[sourceText(row, "balance")] = true
		}
	}
	amounts := []string{}
	for amount := range set {
		amounts = append(amounts, amount)
	}
	sort.Strings(amounts)
	sort.Strings(ids)
	return amounts, ids
}
