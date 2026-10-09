package enterpriseapf

import "testing"

func accountInput() FinanceInput {
	return FinanceInput{Payload: map[string]any{"accountName": "isolated", "bankName": nil, "accountNoMasked": "****1234", "accountType": "bank", "currencyCode": "CNY", "ownerDeptCode": nil}}
}
func parameterInput(from, to string) FinanceInput {
	var end any
	if to != "" {
		end = to
	}
	return FinanceInput{Payload: map[string]any{"name": "isolated", "effectiveFrom": from, "effectiveTo": end, "baseSalary": "1234567890123456.01", "welfareCostRate": "0.1000", "managementAllocationRate": "0.2000", "resourceAllocationCost": "1.00", "currencyCode": "CNY", "status": "active", "remark": nil}}
}
func TestAPFFinanceValidation(t *testing.T) {
	if e := ValidateFinanceInput("accounts-create", accountInput()); e != nil {
		t.Fatal(e)
	}
	if e := ValidateFinanceInput("parameters-create", parameterInput("2026-01-01", "2026-01-31")); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"baseSalary", "welfareCostRate", "resourceAllocationCost"} {
		for _, v := range []any{1.1, "1e4", "-1", "01.20", "12345678901234567.00", "0.12345"} {
			i := parameterInput("2026-01-01", "")
			i.Payload[key] = v
			if ValidateFinanceInput("parameters-create", i) == nil {
				t.Fatal("bad decimal", key, v)
			}
		}
	}
	for _, v := range []any{"2026-02-30", "2026-1-1", nil} {
		i := parameterInput("2026-01-01", "")
		i.Payload["effectiveFrom"] = v
		if ValidateFinanceInput("parameters-create", i) == nil {
			t.Fatal("bad date")
		}
	}
	for _, key := range []string{"actor", "tenant", "code", "rowVersion", "accountNo", "row_version"} {
		i := accountInput()
		i.Payload[key] = "forged"
		if ValidateFinanceInput("accounts-create", i) == nil {
			t.Fatal("unknown field", key)
		}
	}
	i := accountInput()
	i.Code = "CODE"
	i.Payload = map[string]any{"accountName": "edited", "expectedVersion": float64(1)}
	if ValidateFinanceInput("accounts-update", i) != nil {
		t.Fatal("valid patch")
	}
	i.Payload["expectedVersion"] = 1.5
	if ValidateFinanceInput("accounts-update", i) == nil {
		t.Fatal("fractional version")
	}
	for _, op := range []string{"parameters-list", "parameters-view", "parameters-history", "parameters-create", "parameters-update"} {
		r, a, ok := FinancePermission(op)
		if !ok || r != "settings" || a != "admin" {
			t.Fatal("settings gate changed")
		}
	}
}

func TestW3LegalEntityAndAccountFieldInput(t *testing.T) {
	for op, want := range map[string][2]string{"legal-entities-list": {"legal_entities", "view"}, "legal-entities-view": {"legal_entities", "view"}, "legal-entities-create": {"legal_entities", "edit"}, "legal-entities-update": {"legal_entities", "edit"}, "accounts-update": {"bank_accounts", "admin"}} {
		if r, a, ok := FinancePermission(op); !ok || r != want[0] || a != want[1] {
			t.Fatal(op, r, a)
		}
	}
	valid := []struct {
		op string
		in FinanceInput
	}{
		{"legal-entities-list", FinanceInput{Page: 1, PageSize: 20}},
		{"legal-entities-view", FinanceInput{Code: "ENT-W000004"}},
		{"legal-entities-create", FinanceInput{Payload: map[string]any{"name": "entity", "entityType": "company", "sortNo": float64(0)}}},
		{"legal-entities-update", FinanceInput{Code: "ENT-1", Payload: map[string]any{"expectedVersion": float64(1), "status": "inactive"}}},
		{"accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "shortName": "main", "accountSubtype": nil, "legalEntityCode": nil, "sortNo": float64(3), "bankBranchCode": "102100099996"}}},
	}
	for _, c := range valid {
		if e := ValidateFinanceInput(c.op, c.in); e != nil {
			t.Fatal(c.op, e)
		}
	}
	invalid := []struct {
		name, op string
		in       FinanceInput
	}{
		{"entity without name", "legal-entities-create", FinanceInput{Payload: map[string]any{"shortName": "x"}}},
		{"entity status on create", "legal-entities-create", FinanceInput{Payload: map[string]any{"name": "x", "status": "inactive"}}},
		{"entity closed", "legal-entities-update", FinanceInput{Code: "ENT-1", Payload: map[string]any{"expectedVersion": float64(1), "status": "closed"}}},
		{"entity code", "legal-entities-update", FinanceInput{Code: "ENT-1", Payload: map[string]any{"expectedVersion": float64(1), "code": "ENT-2"}}},
		{"entity type", "legal-entities-create", FinanceInput{Payload: map[string]any{"name": "x", "entityType": "customer"}}},
		{"entity account field", "legal-entities-create", FinanceInput{Payload: map[string]any{"name": "x", "accountNoSecretRef": "hzybase://vault/x"}}},
		{"entity update without change", "legal-entities-update", FinanceInput{Code: "ENT-1", Payload: map[string]any{"expectedVersion": float64(1)}}},
		{"account subtype", "accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "accountSubtype": "savings"}}},
		{"account sort", "accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "sortNo": "3"}}},
		{"account branch", "accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "bankBranchCode": "10 21"}}},
		{"account empty short name", "accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "shortName": ""}}},
		{"account entity field", "accounts-update", FinanceInput{Code: "BA-1", Payload: map[string]any{"expectedVersion": float64(1), "invoiceTitle": "x"}}},
		{"parameter account field", "parameters-update", FinanceInput{Code: "PCP-1", Payload: map[string]any{"expectedVersion": float64(1), "shortName": "x"}}},
	}
	for _, c := range invalid {
		if ValidateFinanceInput(c.op, c.in) == nil {
			t.Fatal(c.name)
		}
	}
}

func TestW3RevealAccountNoPermissionAndInput(t *testing.T) {
	if r, a, ok := FinancePermission("accounts-reveal-account-no"); !ok || r != "bank_accounts" || a != "reveal-account-no" {
		t.Fatal(r, a, ok)
	}
	if AccountNoSecretCode("BA-W000002") != "finance.bank-account.BA-W000002.account-no" {
		t.Fatal("secret code derivation changed")
	}
	if e := ValidateFinanceInput("accounts-reveal-account-no", FinanceInput{Code: "BA-W000002", Payload: map[string]any{"reason": "monthly check", "clientIp": "203.0.113.7", "userAgent": "fixture"}}); e != nil {
		t.Fatal(e)
	}
	for name, in := range map[string]FinanceInput{
		"no code":       {Payload: map[string]any{"reason": "monthly check", "clientIp": "203.0.113.7", "userAgent": "fixture"}},
		"no reason":     {Code: "BA-1", Payload: map[string]any{"clientIp": "203.0.113.7", "userAgent": "fixture", "x": "y"}},
		"no client ip":  {Code: "BA-1", Payload: map[string]any{"reason": "monthly check", "userAgent": "fixture", "x": "y"}},
		"bad client ip": {Code: "BA-1", Payload: map[string]any{"reason": "monthly check", "clientIp": "not-an-ip", "userAgent": "fixture"}},
		"short reason":  {Code: "BA-1", Payload: map[string]any{"reason": "abc", "clientIp": "203.0.113.7", "userAgent": "fixture"}},
		"secret code":   {Code: "BA-1", Payload: map[string]any{"reason": "monthly check", "clientIp": "203.0.113.7", "secretCode": "x"}},
		"paged":         {Code: "BA-1", Page: 1, PageSize: 20, Payload: map[string]any{"reason": "monthly check", "clientIp": "203.0.113.7", "userAgent": "fixture"}},
		"padded reason": {Code: "BA-1", Payload: map[string]any{"reason": " monthly check ", "clientIp": "203.0.113.7", "userAgent": "fixture"}},
	} {
		if ValidateFinanceInput("accounts-reveal-account-no", in) == nil {
			t.Fatal(name)
		}
	}
}

func TestAPFFinanceAccountCountAuthorityOnlyForLegalEntityReads(t *testing.T) {
	for _, op := range []string{"accounts-list", "balances-list", "legal-entities-update", "parameters-list"} {
		if ValidateFinanceInput(op, FinanceInput{Page: 1, PageSize: 20, AccountCountAllowed: true}) == nil {
			t.Fatal("count authority accepted", op)
		}
	}
}

func TestW3FinanceReadFiltersAreClosedAndOldIntentStable(t *testing.T) {
	for _, i := range []FinanceInput{{Page: 1, PageSize: 20, LegalEntityCode: "LE1"}, {Page: 1, PageSize: 20, AccountType: "bank"}, {Page: 1, PageSize: 20, Complete: true}} {
		if e := ValidateFinanceInput("accounts-list", i); e != nil {
			t.Fatal(e)
		}
		if ValidateFinanceInput("parameters-list", i) == nil {
			t.Fatal("account filter reached settings")
		}
	}
	for _, i := range []FinanceInput{{Page: 1, PageSize: 20, LegalEntityCode: "bad/code"}, {Page: 1, PageSize: 20, AccountType: "unknown"}, {Page: 2, PageSize: 20, Complete: true}} {
		if ValidateFinanceInput("accounts-list", i) == nil {
			t.Fatal("invalid filter accepted", i)
		}
	}
	old := FinanceInput{Page: 1, PageSize: 20}
	if len(FinanceIntent(old)) != 9 {
		t.Fatal("old intent changed")
	}
	old.Complete = false
	if len(FinanceIntent(old)) != 9 {
		t.Fatal("absent/false filter changed old bytes")
	}
}
