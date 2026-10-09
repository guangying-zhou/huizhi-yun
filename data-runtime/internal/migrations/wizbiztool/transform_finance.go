package wizbiztool

import (
	"math/big"
	"sort"
	"strconv"
	"strings"
)

func prepareBalances(data SourceData, result *Prepared, p Profile, banks map[string]map[string]any) error {
	type entry struct {
		row  map[string]any
		pk   string
		time string
	}
	groups := map[string][]entry{}
	have := map[string]bool{}
	for _, row := range data["wb_account_balance"] {
		pk := sourceText(row, "ab_id")
		bank := sourceText(row, "ba_id")
		day := sourceText(row, "check_date")
		if bank == "0" {
			continue
		}
		if banks[bank] == nil {
			return ErrValue
		}
		have[bank] = true
		groups[bank+"/"+day] = append(groups[bank+"/"+day], entry{row, pk, sourceText(row, "operate_time")})
	}
	placeholders := map[string][]map[string]any{}
	for _, row := range data["wb_account_balance"] {
		if sourceText(row, "ba_id") == "0" {
			day := sourceText(row, "check_date")
			placeholders[day] = append(placeholders[day], row)
		}
	}
	for day, rows := range placeholders {
		amounts, ids := exceptionBalanceEvidence(rows)
		result.exception("balance_without_account", "wb_account_balance", "date:"+day, map[string]any{"balanceDate": day, "entryCount": strconv.Itoa(len(rows)), "latestAmounts": amounts, "sourceEntryIds": ids})
	}

	for bank, row := range banks {
		if have[bank] || row["balance"] == nil {
			continue
		}
		if row["check_date"] == nil {
			return ErrValue
		}
		groups[bank+"/"+sourceText(row, "check_date")] = []entry{{map[string]any{"balance": row["balance"], "check_date": row["check_date"], "operate_time": row["operate_time"], "operator_id": row["operator_id"], "remark": "源账户缓存值，无历史登记", "cache": true}, bank, sourceText(row, "operate_time")}}
	}
	names := []string{}
	for key := range groups {
		names = append(names, key)
	}
	sort.Strings(names)
	for _, key := range names {
		list := groups[key]
		parts := strings.SplitN(key, "/", 2)
		bank, day := parts[0], parts[1]
		code := result.Codes["wb_bank_account/"+bank]
		latest := ""
		for _, item := range list {
			if item.time > latest {
				latest = item.time
			}
		}
		latestAmounts := map[string]bool{}
		allAmounts := map[string]bool{}
		ties := 0
		for _, item := range list {
			amount, err := decimal(item.row["balance"])
			if err != nil {
				return err
			}
			allAmounts[amount.RatString()] = true
			if item.time == latest {
				latestAmounts[amount.RatString()] = true
				ties++
			}
		}
		conflict := len(latestAmounts) > 1
		for _, item := range list {
			recorded, err := sourceInstant(item.row["operate_time"])
			if err != nil || recorded == nil {
				return ErrValue
			}
			isLatest := 0
			if !conflict && item.time == latest {
				isLatest = 1
			}
			sourceTable := "wb_account_balance"
			role := "primary"
			if item.row["cache"] == true {
				sourceTable = "wb_bank_account"
				role = "cache-balance"
			}
			ref := Reference{"finance_bank_account", code}
			values := map[string]any{"bank_account_id": ref, "balance_date": day, "balance_amount": item.row["balance"], "currency_code": "CNY", "entry_source": "import", "recorded_at": recorded, "recorded_by": result.audit(item.row), "note": item.row["remark"], "entry_ref": item.pk, "is_day_latest": isLatest}
			result.add("balance", sourceTable, item.pk, "finance_account_balance_entry", role, "composite", code+"/"+day+"/import/"+item.pk, values)
		}
		if conflict {
			rows := []map[string]any{}
			for _, item := range list {
				rows = append(rows, item.row)
			}
			amounts, ids := exceptionBalanceEvidence(rows)
			result.exception("balance_latest_conflict", "wb_account_balance", "account:"+bank+"|date:"+day, map[string]any{"balanceDate": day, "latestAmounts": amounts, "sourceEntryIds": ids})
			continue
		}
		var amount any
		for _, item := range list {
			if item.time == latest {
				amount = item.row["balance"]
				break
			}
		}
		result.add("balance", "wb_bank_account", bank, "finance_account_balance_snapshot", "balance-snapshot:"+day, "composite", code+"/"+day+"/import", map[string]any{"bank_account_id": Reference{"finance_bank_account", code}, "snapshot_date": day, "balance_amount": amount, "currency_code": "CNY", "source_type": "import", "note": "WizBiz 当日登记余额", "entry_count": len(list), "latest_tie_count": ties, "distinct_amounts": len(allAmounts)})
	}
	return nil
}
func prepareContracts(data SourceData, result *Prepared, p Profile, organizations, contacts, banks map[string]map[string]any) error {
	types, states := sourceContractTypes, sourceContractStates
	for _, row := range data["wb_contract"] {
		pk := sourceText(row, "contract_id")
		code, err := ObjectCode("contract", pk)
		if err != nil {
			return err
		}
		result.Codes["wb_contract/"+pk] = code
		family, ok := types[sourceText(row, "contract_type")]
		if !ok {
			return ErrValue
		}
		state, ok := states[sourceText(row, "contract_status")]
		if !ok {
			return ErrValue
		}
		if !zeroReference(row, "parent_id") {
			return ErrValue
		}
		if requireString(row, "contract_name", 200) != nil || requireString(row, "contract_code", 50) != nil {
			return ErrValue
		}
		for field, max := range map[string]int{"description": 1000, "payment": 500, "tos": 1000} {
			if optionalString(row, field, max) != nil {
				return ErrValue
			}
		}
		company := organizations[sourceText(row, "company_id")]
		customer := organizations[sourceText(row, "customer_id")]
		if company == nil || sourceText(company, "org_type") != "0" || customer == nil || sourceText(customer, "org_type") == "0" {
			return ErrValue
		}
		owner, dept := result.owner(row, "wb_contract", pk, state[0] == "effective")
		if ValidateOwner(owner) != nil {
			return ErrValue
		}
		var contact any
		if !zeroReference(row, "contactman_id") {
			source := contacts[sourceText(row, "contactman_id")]
			if source == nil {
				result.exception("contact_orphan", "wb_contract", pk, map[string]any{"sourceContactId": textOrNull(row, "contactman_id")})
			} else {
				if sourceText(source, "org_id") != sourceText(row, "customer_id") {
					result.exception("contract_contact_mismatch", "wb_contract", pk, map[string]any{"sourceContactId": textOrNull(row, "contactman_id"), "contactSourceOrgId": textOrNull(source, "org_id")})
				} else {
					contact = Reference{"altoc_contact", result.Codes["wb_contactman/"+sourceText(row, "contactman_id")]}
				}
			}
		}
		var bankCode any
		if !zeroReference(row, "ba_id") {
			if banks[sourceText(row, "ba_id")] == nil {
				return ErrValue
			}
			bankCode = result.Codes["wb_bank_account/"+sourceText(row, "ba_id")]
		}
		third, err := fixedEnum(row["is_third_party"], map[string]string{"N": "0", "Y": "1"})
		if err != nil {
			return err
		}
		var thirdCustomer any
		if !zeroReference(row, "third_party_id") {
			other := organizations[sourceText(row, "third_party_id")]
			if other == nil || sourceText(other, "org_type") == "0" {
				return ErrValue
			}
			thirdCustomer = Reference{"altoc_customer", result.Codes["wb_organization/"+sourceText(row, "third_party_id")]}
		}
		signed, err := sourceInstant(row["sign_date"])
		if err != nil {
			return err
		}
		var signDay any
		if row["sign_date"] != nil {
			signDay = sourceText(row, "sign_date")[:10]
		}
		created, _ := sourceInstant(row["operate_time"])
		total, err := decimal(row["total_amount"])
		if err != nil {
			return err
		}
		if row["prime_amount"] != nil {
			effective, err := decimal(row["prime_amount"])
			if err != nil {
				return err
			}
			if effective.Cmp(total) > 0 {
				result.exception("effective_amount_exceeds_total", "wb_contract", pk, map[string]any{"totalAmount": row["total_amount"], "effectiveAmount": row["prime_amount"]})
			}
		}
		result.add("contract", "wb_contract", pk, "altoc_contract", "primary", "code", code, map[string]any{"code": code, "contract_no": row["contract_code"], "name": row["contract_name"], "customer_id": Reference{"altoc_customer", result.Codes["wb_organization/"+sourceText(row, "customer_id")]}, "contact_id": contact, "direction": family[0], "primary_type": family[1], "contract_category": family[2], "status": state[0], "legal_status": state[1], "fulfillment_status": state[2], "financial_status": "unplanned", "activation_status": "not_planned", "source_type": "historical_import", "origin_type": "historical_import", "amount_basis": "header", "tax_rate": nil, "signed_amount": row["total_amount"], "amount_tax_inclusive": row["total_amount"], "amount_tax_exclusive": nil, "effective_amount": row["prime_amount"], "sign_date": signDay, "signed_at": signed, "end_date": row["due_date"], "receiving_bank_account_code": bankCode, "payment_term_summary": row["payment"], "is_third_party": third, "third_party_customer_id": thirdCustomer, "service_period_months": row["service_period"], "contract_period_months": row["contract_period"], "content_summary": row["description"], "service_terms": row["tos"], "owner_uid": owner, "owner_dept_code": dept, "currency_code": "CNY", "imported_batch_code": p.BatchCode, "imported_at": snapshotTime(p), "created_by": result.audit(row), "created_at": created})
		role := "seller"
		if family[0] == "purchase" {
			role = "buyer"
		}
		entityCode := result.Codes["wb_organization/"+sourceText(row, "company_id")]
		result.add("contract-relations", "wb_contract", pk, "altoc_contract_party", "derived", "composite", code+"/"+role+"/"+entityCode, map[string]any{"contract_id": Reference{"altoc_contract", code}, "party_type": "legal_entity", "party_ref_code": entityCode, "party_name_snapshot": company["org_name"], "role_code": role, "is_primary": 1})
		direction := "receivable"
		if family[0] == "purchase" {
			direction = "payable"
		}
		result.add("snapshots", "wb_contract", pk, "altoc_contract_migration_snapshot", "snapshot", "contract_id", Reference{"altoc_contract", code}, map[string]any{"contract_id": Reference{"altoc_contract", code}, "snapshot_at": snapshotTime(p), "remaining_uninvoiced_amount": row["invoice_amount"], "remaining_settlement_amount": row["exec_amount"], "settlement_direction": direction, "source_note": "原系统缓存：剩余未开票与剩余结算额", "batch_code": p.BatchCode})
		// Balance mismatch is independently derived from preserved income details.
		sum := new(big.Rat)
		for _, income := range data["wb_project_income"] {
			if sourceText(income, "contract_id") == pk {
				amount, err := decimal(income["amount"])
				if err != nil {
					return err
				}
				sum.Add(sum, amount)
			}
		}
		remaining := new(big.Rat).Sub(total, sum)
		if row["exec_amount"] != nil {
			cache, _ := decimal(row["exec_amount"])
			if cache.Cmp(remaining) != 0 {
				result.exception("contract_balance_mismatch", "wb_contract", pk, map[string]any{"cachedAmount": row["exec_amount"], "recomputedAmount": remaining.FloatString(2), "difference": new(big.Rat).Sub(cache, remaining).FloatString(2)})
			}
		}
	}
	return nil
}
func ValidateOwner(owner string) error { return validateMigrationOwner(owner) }
