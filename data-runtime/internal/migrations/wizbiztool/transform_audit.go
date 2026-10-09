package wizbiztool

import (
	"context"
	"sort"
	"strings"
)

// No source values, PKs, labels, paths or raw errors are part of this schema.
// Count is the number of rows violating a field/category, not a distinct value count.
type TransformBlocker struct {
	Table    string `json:"table"`
	Field    string `json:"field"`
	Category string `json:"category"`
	Count    int    `json:"count"`
}
type TransformAudit struct {
	Version        string             `json:"version"`
	SnapshotSHA256 string             `json:"snapshotSha256,omitempty"`
	ManifestSHA256 string             `json:"manifestSha256,omitempty"`
	Ready          bool               `json:"ready"`
	Blockers       []TransformBlocker `json:"blockers"`
}

// AuditStageTransforms uses only the protected source/metadata snapshot. It
// does not open target, Directory, Vault or inspect/stop a Runtime process.
func AuditStageTransforms(ctx context.Context, source *SourceSnapshot, m SnapshotManifest, p Profile) (TransformAudit, error) {
	data, _, err := source.ReadCovered(ctx, m, p.VaultWrite)
	if err != nil {
		return TransformAudit{}, err
	}
	return AuditTransformValues(data, p), nil
}

// Uses the same scalar validators as apply; additionally collects all relation
// failures without stopping at the first row. BuildPrepared is the final guard:
// an unclassified conversion failure can never yield a ready audit.
func AuditTransformValues(data SourceData, p Profile) TransformAudit {
	out := TransformAudit{Version: "wizbiz-stage-transform-audit.v1", Blockers: []TransformBlocker{}}
	counts := map[[3]string]int{}
	add := func(t, f, c string, bad bool) {
		if bad {
			counts[[3]string{t, f, c}]++
		}
	}
	orgs := tableIndex(data, "wb_organization", "org_id")
	banks := tableIndex(data, "wb_bank_account", "ba_id")
	contracts := tableIndex(data, "wb_contract", "contract_id")
	for _, table := range SortedTableNamesFromData(data) {
		decl, ok := Declarations()[table]
		if !ok {
			add("source", "tables", "unsupported_table", true)
			continue
		}
		for _, r := range data[table] {
			if len(decl.PrimaryKey) != 1 {
				add(table, "primary_key", "unsupported_key", true)
				continue
			}
			key := sourceText(r, decl.PrimaryKey[0])
			coded := table == "wb_organization" || table == "wb_bank_account" || table == "wb_contract" || (table == "wb_contactman" && !zeroReference(r, "org_id"))
			badKey := key == ""
			if coded {
				_, err := ObjectCode("customer", key)
				badKey = err != nil
			}
			add(table, decl.PrimaryKey[0], "source_key", badKey)
			for _, f := range decl.Columns {
				val := r[f.Name]
				add(table, f.Name, "required_null", !f.Nullable && f.Disposition != "vault" && val == nil)
				if val != nil && f.Disposition != "vault" {
					_, ok := val.(string)
					add(table, f.Name, "scalar_type", !ok)
				}
				if val != nil && strings.Contains(f.Type, "decimal") {
					add(table, f.Name, "decimal_format", validateSourceDecimal(val, f.Type) != nil)
				}
				if f.Type == "date" {
					_, e := localDate(val)
					add(table, f.Name, "date_format", e != nil)
				}
				if f.Type == "datetime" {
					_, e := sourceInstant(val)
					add(table, f.Name, "datetime_format", e != nil)
				}
			}
		}
	}
	required := func(t string, r map[string]any, f string, n int) {
		add(t, f, "required_or_length", requireString(r, f, n) != nil)
	}
	optional := func(t string, r map[string]any, limits map[string]int) {
		for f, n := range limits {
			add(t, f, "length", optionalString(r, f, n) != nil)
		}
	}
	enum := func(t string, r map[string]any, f string, choices map[string]string) {
		_, e := fixedEnum(r[f], choices)
		add(t, f, "enum", e != nil)
	}
	customer := func(id string) bool { return orgs[id] != nil && sourceText(orgs[id], "org_type") != "0" }
	legal := func(id string) bool { return orgs[id] != nil && sourceText(orgs[id], "org_type") == "0" }
	for _, r := range data["wb_organization"] {
		t := "wb_organization"
		enum(t, r, "org_type", map[string]string{"0": "legal-entity", "1": "customer", "2": "customer"})
		enum(t, r, "org_status", map[string]string{"0": "active", "1": "archived"})
		required(t, r, "org_name", 200)
		optional(t, r, map[string]int{"short_name": 100})
		if sourceText(r, "org_type") == "0" {
			continue
		}
		// Unmatched active owners freeze an exception whose sourceUserId is
		// required by the existing closed exception contract. Missing source
		// IDs must be classified here, not discovered by finalization later.
		add(t, "employee_id", "exception_source_required", sourceText(r, "org_status") == "0" && sourceText(r, "employee_id") == "")
		optional(t, r, map[string]int{"web_site": 300, "telephone": 30, "province": 50, "city": 50, "weixin_number": 100, "contactman": 50})
		if !zeroReference(r, "parent_id") {
			add(t, "parent_id", "customer_reference", !customer(sourceText(r, "parent_id")))
		}
		seen := map[string]bool{}
		cursor := sourceText(r, "org_id")
		for cursor != "" && cursor != "0" {
			if seen[cursor] {
				add(t, "parent_id", "cycle", true)
				break
			}
			seen[cursor] = true
			node := orgs[cursor]
			if node == nil {
				add(t, "parent_id", "missing_chain", true)
				break
			}
			cursor = sourceText(node, "parent_id")
		}
	}
	for _, r := range data["wb_contactman"] {
		t := "wb_contactman"
		if zeroReference(r, "org_id") {
			continue
		}
		add(t, "org_id", "customer_reference", !customer(sourceText(r, "org_id")))
		required(t, r, "cm_name", 50)
		optional(t, r, map[string]int{"department": 100, "post": 100, "phone": 30, "mobile": 30, "mobile2": 30, "weixin_number": 100, "remarks": 500})
		_, e := contactStarLevel(r["stars"])
		add(t, "stars", "rating", e != nil)
		enum(t, r, "chief", map[string]string{"0": "0", "1": "1"})
	}
	haveBalance := map[string]bool{}
	for _, r := range data["wb_account_balance"] {
		if sourceText(r, "ba_id") == "0" {
			continue
		}
		t := "wb_account_balance"
		haveBalance[sourceText(r, "ba_id")] = true
		add(t, "ba_id", "account_reference", banks[sourceText(r, "ba_id")] == nil)
		_, e := decimal(r["balance"])
		add(t, "balance", "amount_format", e != nil)
		instant, e := sourceInstant(r["operate_time"])
		add(t, "operate_time", "recorded_at_required", e != nil || instant == nil)
	}
	for _, r := range data["wb_bank_account"] {
		t := "wb_bank_account"
		add(t, "org_id", "legal_entity_reference", !legal(sourceText(r, "org_id")))
		required(t, r, "account_name", 200)
		optional(t, r, map[string]int{"bank_name": 200, "short_name": 50})
		enum(t, r, "ba_type", map[string]string{"0": "basic", "1": "general", "2": "special", "3": "cash", "4": "loan"})
		enum(t, r, "ba_status", map[string]string{"0": "active", "1": "inactive"})
		if sourceText(r, "ba_type") != "3" {
			add(t, "account_number", "vault_mode", p.VaultWrite == "forbidden")
			if p.VaultWrite == "real" {
				val, ok := r["account_number"].(string)
				add(t, "account_number", "vault_value", !ok || val == "" || val != strings.TrimSpace(val))
			}
		}
		if !haveBalance[sourceText(r, "ba_id")] && r["balance"] != nil {
			add(t, "check_date", "cached_balance_date_required", r["check_date"] == nil)
			_, e := decimal(r["balance"])
			add(t, "balance", "amount_format", e != nil)
			instant, e := sourceInstant(r["operate_time"])
			add(t, "operate_time", "cached_recorded_at_required", e != nil || instant == nil)
		}
	}
	for _, r := range data["wb_contract"] {
		t := "wb_contract"
		types := map[string]string{}
		for k, v := range sourceContractTypes {
			types[k] = v[0]
		}
		enum(t, r, "contract_type", types)
		states := map[string]string{}
		for k, v := range sourceContractStates {
			states[k] = v[0]
		}
		enum(t, r, "contract_status", states)
		add(t, "parent_id", "supplement_contract_unsupported", !zeroReference(r, "parent_id"))
		required(t, r, "contract_name", 200)
		required(t, r, "contract_code", 50)
		optional(t, r, map[string]int{"description": 1000, "payment": 500, "tos": 1000})
		add(t, "company_id", "legal_entity_reference", !legal(sourceText(r, "company_id")))
		add(t, "customer_id", "customer_reference", !customer(sourceText(r, "customer_id")))
		if !zeroReference(r, "ba_id") {
			add(t, "ba_id", "account_reference", banks[sourceText(r, "ba_id")] == nil)
		}
		enum(t, r, "is_third_party", map[string]string{"N": "0", "Y": "1"})
		if !zeroReference(r, "third_party_id") {
			add(t, "third_party_id", "customer_reference", !customer(sourceText(r, "third_party_id")))
		}
		add(t, "employee_id", "exception_source_required", sourceText(r, "contract_status") == "0" && sourceText(r, "employee_id") == "")
		_, e := decimal(r["total_amount"])
		add(t, "total_amount", "amount_format", e != nil)
		if r["prime_amount"] != nil {
			_, e := decimal(r["prime_amount"])
			add(t, "prime_amount", "amount_format", e != nil)
		}
		if r["exec_amount"] != nil {
			_, e := decimal(r["exec_amount"])
			add(t, "exec_amount", "amount_format", e != nil)
		}
	}
	for _, r := range data["wb_project_income"] {
		if contracts[sourceText(r, "contract_id")] != nil {
			_, e := decimal(r["amount"])
			add("wb_project_income", "amount", "amount_format", e != nil)
		}
	}
	if len(counts) == 0 {
		if _, e := BuildPrepared(data, p, map[string]IdentityState{}); e != nil {
			add("transform", "result", "unclassified", true)
		}
	}
	for key, n := range counts {
		out.Blockers = append(out.Blockers, TransformBlocker{key[0], key[1], key[2], n})
	}
	sort.Slice(out.Blockers, func(i, j int) bool {
		a, b := out.Blockers[i], out.Blockers[j]
		if a.Table != b.Table {
			return a.Table < b.Table
		}
		if a.Field != b.Field {
			return a.Field < b.Field
		}
		return a.Category < b.Category
	})
	out.Ready = len(out.Blockers) == 0
	return out
}

var sourceContractTypes = map[string][3]string{"0": {"purchase", "standard", "purchase"}, "1": {"sales", "software", "software_sales"}, "2": {"sales", "implementation", "software_development"}, "3": {"sales", "service", "tech_data_service"}, "4": {"sales", "maintenance", "system_maintenance"}, "5": {"sales", "standard", "saas"}, "6": {"sales", "service", "platform_operation"}, "8": {"sales", "standard", "hardware_integration"}, "9": {"sales", "standard", "other"}}
var sourceContractStates = map[string][3]string{"0": {"effective", "effective", "in_progress"}, "1": {"completed", "closed", "fulfilled"}, "2": {"terminated", "terminated", "cancelled"}}
