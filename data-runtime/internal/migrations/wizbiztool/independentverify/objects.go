package independentverify

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

func (v *verifier) organization(pk string, s map[string]any) {
	entity := text(s, "org_type") == "0"
	table, prefix := "altoc_customer", "CU"
	if entity {
		table, prefix = "finance_legal_entity", "ENT"
	}
	row, ok := v.primary("wb_organization", pk, table, prefix)
	if !ok {
		return
	}
	status := "active"
	if text(s, "org_status") == "1" {
		status = "archived"
	}
	e := map[string]any{"name": s["org_name"], "short_name": s["short_name"], "status": status, "created_by": v.audit(s), "created_at": instant(s["operate_time"])}
	if entity {
		if status == "archived" {
			e["status"] = "inactive"
		}
		e["invoice_title"] = s["org_name"]
		e["entity_type"] = "company"
		e["sort_no"] = s["order_num"]
		e["remark"] = s["description"]
		v.fields("wb_organization", pk, row, e)
		return
	}
	owner, dept := v.owner(s)
	e["owner_uid"], e["owner_dept_code"] = owner, dept
	e["is_partner"] = "0"
	if text(s, "org_type") == "2" {
		e["is_partner"] = "1"
	}
	e["customer_level_id"] = nil
	e["source_system"] = "import:wizbiz"
	e["external_ref"] = pk
	for source, target := range map[string]string{"web_site": "website", "telephone": "telephone", "province": "province", "city": "city", "weixin_number": "wechat_official_account", "description": "description", "start_date": "started_at", "contactman": "contact_name_text", "order_num": "sort_no"} {
		e[target] = s[source]
	}
	e["parent_customer_id"] = nil
	if x := text(s, "parent_id"); x != "" && x != "0" {
		e["parent_customer_id"] = v.id("altoc_customer", "wb_organization", x, "CU")
	}
	e["primary_contact_id"] = nil
	if x := text(s, "contactman_id"); x != "" && x != "0" {
		c := v.source("wb_contactman", x)
		if c != nil && text(c, "org_id") == pk {
			e["primary_contact_id"] = v.id("altoc_contact", "wb_contactman", x, "CN")
		}
	}
	v.fields("wb_organization", pk, row, e)
	for _, role := range []string{"hierarchy", "primary-contact"} {
		v.mapping("wb_organization", pk, table, role)
	}
	key, ok := v.mapping("wb_organization", pk, "altoc_customer_migration_snapshot", "snapshot")
	if !ok {
		return
	}
	snap, err := readRow(v.ctx, v.q, "altoc_customer_migration_snapshot", "customer_id", key)
	if err != nil {
		v.fail("wb_organization", pk, "snapshot_missing")
		return
	}
	values := map[string]any{"customer_id": row["id"], "snapshot_at": v.snapshotTime(), "batch_code": v.input.BatchCode, "source_note": "原系统缓存，口径不保证一致"}
	for _, f := range v.input.Declarations["wb_organization"] {
		if f.Disposition == "snapshot" {
			values[f.Target] = s[f.Name]
		}
	}
	v.fields("wb_organization", pk, snap, values)
}
func (v *verifier) contact(pk string, s map[string]any) {
	if x := text(s, "org_id"); x == "" || x == "0" {
		var n int
		if v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM altoc_contact WHERE BINARY code=BINARY ?", code("CN", pk)).Scan(&n) != nil || n != 0 {
			v.fail("wb_contactman", pk, "orphan_contact_written")
		}
		return
	}
	row, ok := v.primary("wb_contactman", pk, "altoc_contact", "CN")
	if !ok {
		return
	}
	owner, _ := v.owner(s)
	e := map[string]any{"customer_id": v.id("altoc_customer", "wb_organization", text(s, "org_id"), "CU"), "owner_uid": owner, "created_by": v.audit(s), "created_at": instant(s["operate_time"])}
	for a, b := range map[string]string{"cm_name": "name", "department": "dept_name", "post": "job_title", "phone": "phone", "mobile": "mobile", "mobile2": "alternate_mobile", "address": "mailing_address", "weixin_number": "wechat", "chief": "is_key_contact", "remarks": "remark"} {
		e[b] = s[a]
	}
	// Independently reconstruct the zero/unrated mapping, never reuse apply.
	switch rating := s["stars"]; rating {
	case nil, "0":
		e["star_level"] = nil
	case "1", "2", "3", "4", "5", "6":
		e["star_level"] = rating
	default:
		v.fail("wb_contactman", pk, "source_star_level_invalid")
		return
	}
	v.fields("wb_contactman", pk, row, e)
}
func (v *verifier) account(pk string, s map[string]any) {
	row, ok := v.primary("wb_bank_account", pk, "finance_bank_account", "BA")
	if !ok {
		return
	}
	subtypes := map[string]string{"0": "basic", "1": "general", "2": "special", "3": "cash", "4": "loan"}
	kind := subtypes[text(s, "ba_type")]
	status := "active"
	if text(s, "ba_status") == "1" {
		status = "inactive"
	}
	e := map[string]any{"account_type": "bank", "account_subtype": kind, "status": status, "currency_code": "CNY", "legal_entity_code": code("ENT", text(s, "org_id")), "created_by": v.audit(s), "created_at": instant(s["operate_time"])}
	for a, b := range map[string]string{"account_name": "account_name", "bank_name": "bank_name", "short_name": "short_name", "bank_code": "bank_branch_code", "account_sn": "sort_no", "create_time": "opened_at", "remark": "remark"} {
		e[b] = s[a]
	}
	if s["account_sn"] == nil {
		e["sort_no"] = "0"
	}
	if kind == "cash" {
		e["account_type"] = "cash"
		e["account_subtype"] = nil
		e["account_no_secret_ref"] = nil
		e["account_no_masked"] = nil
	} else {
		value := "WIZBIZ-TEST-" + pk
		if v.input.VaultMode == "real" {
			value = text(s, "account_number")
		}
		chars := []rune(value)
		mask := strings.Repeat("*", len(chars))
		if len(chars) > 4 {
			mask = strings.Repeat("*", len(chars)-4) + string(chars[len(chars)-4:])
		}
		e["account_no_masked"] = mask
		e["account_no_secret_ref"] = "hzybase://vault/finance.bank-account." + code("BA", pk) + ".account-no"
		if v.input.Vault == nil || v.input.Vault(v.ctx, code("BA", pk), SHA([]byte(value)), mask) != nil {
			v.fail("wb_bank_account", pk, "vault")
		}
	}
	v.fields("wb_bank_account", pk, row, e)
}
func (v *verifier) contract(pk string, s map[string]any) {
	row, ok := v.primary("wb_contract", pk, "altoc_contract", "CT")
	if !ok {
		return
	}
	types := map[string][3]string{"0": {"purchase", "standard", "purchase"}, "1": {"sales", "software", "software_sales"}, "2": {"sales", "implementation", "software_development"}, "3": {"sales", "service", "tech_data_service"}, "4": {"sales", "maintenance", "system_maintenance"}, "5": {"sales", "standard", "saas"}, "6": {"sales", "service", "platform_operation"}, "8": {"sales", "standard", "hardware_integration"}, "9": {"sales", "standard", "other"}}
	states := map[string][3]string{"0": {"effective", "effective", "in_progress"}, "1": {"completed", "closed", "fulfilled"}, "2": {"terminated", "terminated", "cancelled"}}
	typ, state := types[text(s, "contract_type")], states[text(s, "contract_status")]
	owner, dept := v.owner(s)
	e := map[string]any{"contract_no": s["contract_code"], "name": s["contract_name"], "customer_id": v.id("altoc_customer", "wb_organization", text(s, "customer_id"), "CU"), "contact_id": nil, "direction": typ[0], "primary_type": typ[1], "contract_category": typ[2], "status": state[0], "legal_status": state[1], "fulfillment_status": state[2], "financial_status": "unplanned", "activation_status": "not_planned", "source_type": "historical_import", "origin_type": "historical_import", "amount_basis": "header", "workflow_instance_id": nil, "tax_rate": nil, "signed_amount": s["total_amount"], "amount_tax_inclusive": s["total_amount"], "amount_tax_exclusive": nil, "effective_amount": s["prime_amount"], "signed_at": instant(s["sign_date"]), "sign_date": nil, "receiving_bank_account_code": nil, "third_party_customer_id": nil, "owner_uid": owner, "owner_dept_code": dept, "currency_code": "CNY", "imported_batch_code": v.input.BatchCode, "imported_at": v.snapshotTime(), "created_by": v.audit(s), "created_at": instant(s["operate_time"])}
	if x := text(s, "sign_date"); len(x) >= 10 {
		e["sign_date"] = x[:10]
	}
	if x := text(s, "ba_id"); x != "" && x != "0" {
		e["receiving_bank_account_code"] = code("BA", x)
	}
	if x := text(s, "third_party_id"); x != "" && x != "0" {
		e["third_party_customer_id"] = v.id("altoc_customer", "wb_organization", x, "CU")
	}
	if x := text(s, "contactman_id"); x != "" && x != "0" && v.source("wb_contactman", x) != nil && text(v.source("wb_contactman", x), "org_id") == text(s, "customer_id") {
		e["contact_id"] = v.id("altoc_contact", "wb_contactman", x, "CN")
	}
	for a, b := range map[string]string{"due_date": "end_date", "payment": "payment_term_summary", "service_period": "service_period_months", "contract_period": "contract_period_months", "description": "content_summary", "tos": "service_terms"} {
		e[b] = s[a]
	}
	switch text(s, "is_third_party") {
	case "N":
		e["is_third_party"] = "0"
	case "Y":
		e["is_third_party"] = "1"
	default:
		v.fail("wb_contract", pk, "source_third_party_invalid")
		return
	}
	v.fields("wb_contract", pk, row, e)
	key, ok := v.mapping("wb_contract", pk, "altoc_contract_party", "derived")
	if ok {
		party, err := readRow(v.ctx, v.q, "altoc_contract_party", "id", key)
		if err != nil {
			v.fail("wb_contract", pk, "party_missing")
		} else {
			role := "seller"
			if typ[0] == "purchase" {
				role = "buyer"
			}
			company := v.source("wb_organization", text(s, "company_id"))
			var name any
			if company != nil {
				name = company["org_name"]
			}
			v.fields("wb_contract", pk, party, map[string]any{"contract_id": row["id"], "party_type": "legal_entity", "party_ref_code": code("ENT", text(s, "company_id")), "party_name_snapshot": name, "role_code": role, "is_primary": "1"})
		}
	}
	key, ok = v.mapping("wb_contract", pk, "altoc_contract_migration_snapshot", "snapshot")
	if ok {
		snap, err := readRow(v.ctx, v.q, "altoc_contract_migration_snapshot", "contract_id", key)
		if err != nil {
			v.fail("wb_contract", pk, "snapshot_missing")
		} else {
			direction := "receivable"
			if typ[0] == "purchase" {
				direction = "payable"
			}
			v.fields("wb_contract", pk, snap, map[string]any{"contract_id": row["id"], "snapshot_at": v.snapshotTime(), "remaining_uninvoiced_amount": s["invoice_amount"], "remaining_settlement_amount": s["exec_amount"], "settlement_direction": direction, "source_note": "原系统缓存：剩余未开票与剩余结算额", "batch_code": v.input.BatchCode})
		}
	}
}
func (v *verifier) balanceEntry(pk string, s map[string]any) {
	if text(s, "ba_id") == "0" {
		return
	}
	v.entry("wb_account_balance", pk, "primary", s, text(s, "ba_id"), false)
}
func (v *verifier) entry(table, pk, role string, s map[string]any, bank string, cache bool) {
	key, ok := v.mapping(table, pk, "finance_account_balance_entry", role)
	if !ok {
		return
	}
	row, err := readRow(v.ctx, v.q, "finance_account_balance_entry", "id", key)
	if err != nil {
		v.fail(table, pk, "balance_entry_missing")
		return
	}
	latest := ""
	amounts := map[string]bool{}
	for _, other := range v.input.Data["wb_account_balance"] {
		if text(other, "ba_id") == bank && text(other, "check_date") == text(s, "check_date") && text(other, "operate_time") > latest {
			latest = text(other, "operate_time")
		}
	}
	if cache {
		latest = text(s, "operate_time")
	}
	for _, other := range v.input.Data["wb_account_balance"] {
		if text(other, "ba_id") == bank && text(other, "check_date") == text(s, "check_date") && text(other, "operate_time") == latest {
			amounts[text(other, "balance")] = true
		}
	}
	isLatest := "0"
	if len(amounts) <= 1 && text(s, "operate_time") == latest {
		isLatest = "1"
	}
	note := s["remark"]
	if cache {
		note = "源账户缓存值，无历史登记"
	}
	v.fields(table, pk, row, map[string]any{"bank_account_id": v.id("finance_bank_account", "wb_bank_account", bank, "BA"), "balance_date": s["check_date"], "balance_amount": s["balance"], "currency_code": "CNY", "entry_source": "import", "recorded_at": instant(s["operate_time"]), "recorded_by": v.audit(s), "note": note, "entry_ref": pk, "is_day_latest": isLatest})
}
func (v *verifier) balanceGroups() {
	groups := map[string][]map[string]any{}
	have := map[string]bool{}
	for _, s := range v.input.Data["wb_account_balance"] {
		bank := text(s, "ba_id")
		if bank == "0" {
			continue
		}
		have[bank] = true
		k := bank + "/" + text(s, "check_date")
		groups[k] = append(groups[k], s)
	}
	for _, s := range v.input.Data["wb_bank_account"] {
		bank := text(s, "ba_id")
		if !have[bank] && s["balance"] != nil {
			v.entry("wb_bank_account", bank, "cache-balance", s, bank, true)
			groups[bank+"/"+text(s, "check_date")] = []map[string]any{s}
		}
	}
	for key, list := range groups {
		parts := strings.SplitN(key, "/", 2)
		bank, day := parts[0], parts[1]
		latest := ""
		for _, s := range list {
			if text(s, "operate_time") > latest {
				latest = text(s, "operate_time")
			}
		}
		all, ties := map[string]bool{}, map[string]bool{}
		tieCount := 0
		var amount any
		for _, s := range list {
			all[text(s, "balance")] = true
			if text(s, "operate_time") == latest {
				ties[text(s, "balance")] = true
				tieCount++
				amount = s["balance"]
			}
		}
		if len(ties) > 1 {
			var n int
			if v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM finance_account_balance_snapshot WHERE bank_account_id=? AND snapshot_date=? AND source_type='import'", v.id("finance_bank_account", "wb_bank_account", bank, "BA"), day).Scan(&n) != nil || n != 0 {
				v.fail("wb_bank_account", bank, "conflict_snapshot_written")
			}
			continue
		}
		id, ok := v.mapping("wb_bank_account", bank, "finance_account_balance_snapshot", "balance-snapshot:"+day)
		if !ok {
			continue
		}
		row, err := readRow(v.ctx, v.q, "finance_account_balance_snapshot", "id", id)
		if err != nil {
			v.fail("wb_bank_account", bank, "balance_snapshot_missing")
			continue
		}
		v.fields("wb_bank_account", bank, row, map[string]any{"bank_account_id": v.id("finance_bank_account", "wb_bank_account", bank, "BA"), "snapshot_date": day, "balance_amount": amount, "currency_code": "CNY", "source_type": "import", "note": "WizBiz 当日登记余额", "entry_count": fmt.Sprint(len(list)), "latest_tie_count": fmt.Sprint(tieCount), "distinct_amounts": fmt.Sprint(len(all))})
	}
}
func (v *verifier) snapshotTime() string {
	t, err := time.Parse("20060102T150405Z", v.input.SnapshotID)
	if err != nil {
		return "!invalid"
	}
	return t.UTC().Format("2006-01-02 15:04:05.000")
}
func (v *verifier) counts() {
	var n int
	if v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM mig_source_row WHERE source_system='wizbiz' AND source_snapshot=?", v.input.SnapshotID).Scan(&n) != nil {
		v.fail("mig_source_row", "", "ledger_count")
		return
	}
	expected := 0
	for _, rows := range v.input.Data {
		expected += len(rows)
	}
	if n != expected {
		v.fail("mig_source_row", "", "ledger_count")
	}
}
func (v *verifier) baselines() {
	for table, rows := range v.input.Baseline {
		if !regexp.MustCompile(`^[a-z][a-z0-9_]*$`).MatchString(table) {
			v.fail(table, "", "baseline_table")
			continue
		}
		var count, created int
		err := v.q.QueryRowContext(v.ctx, "SELECT COUNT(DISTINCT target_key) FROM mig_object_map WHERE batch_id=? AND target_table=? AND disposition='created'", v.input.BatchID, table).Scan(&created)
		if err != nil || v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM `"+table+"`").Scan(&count) != nil || count != len(rows)+created {
			v.fail(table, "", "domain_row_count")
			if strings.HasSuffix(table, "_integration_operation") {
				rows, err := v.q.QueryContext(v.ctx, "SELECT m.source_table,m.source_pk FROM `"+table+"` o JOIN mig_object_map m ON BINARY m.target_key=BINARY o.source_biz_code WHERE m.batch_id=? AND m.map_role='primary'", v.input.BatchID)
				if err == nil {
					for rows.Next() {
						var source, key string
						if rows.Scan(&source, &key) == nil {
							v.fail(source, key, "unexpected_outbox")
						}
					}
					rows.Close()
				}
			}
		}

		for _, baseline := range rows {
			row, err := readBaseline(v.ctx, v.q, table, baseline.PrimaryKey)
			if err != nil {
				v.fail(table, baseline.Key, "baseline_missing")
				continue
			}
			raw, err := CanonicalBaseline(row)
			if err != nil || SHA(raw) != baseline.SHA256 {
				v.fail(table, baseline.Key, "baseline_changed")
			}
		}
	}
}
