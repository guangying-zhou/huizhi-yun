package wizbiz

import "testing"

func TestContractStatuses(t *testing.T) {
	tests := []struct {
		source      string
		status      string
		legal       string
		fulfillment string
		activation  string
	}{
		{source: "0", status: "effective", legal: "effective", fulfillment: "in_progress", activation: "not_planned"},
		{source: "1", status: "completed", legal: "closed", fulfillment: "fulfilled", activation: "completed"},
		{source: "2", status: "terminated", legal: "terminated", fulfillment: "cancelled", activation: "cancelled"},
	}
	for _, tt := range tests {
		status, legal, fulfillment, activation := contractStatuses(tt.source)
		if status != tt.status || legal != tt.legal || fulfillment != tt.fulfillment || activation != tt.activation {
			t.Fatalf("contractStatuses(%q) = (%q,%q,%q,%q), want (%q,%q,%q,%q)", tt.source, status, legal, fulfillment, activation, tt.status, tt.legal, tt.fulfillment, tt.activation)
		}
	}
}

func TestContractFinancialStatus(t *testing.T) {
	tests := []struct {
		row  row
		want string
	}{
		{row: row{"total_amount": "100", "exec_amount": "100"}, want: "received"},
		{row: row{"total_amount": "100", "exec_amount": "20"}, want: "partially_received"},
		{row: row{"total_amount": "100", "invoice_amount": "100"}, want: "invoiced"},
		{row: row{"total_amount": "100", "invoice_amount": "20"}, want: "partially_invoiced"},
		{row: row{"total_amount": "100"}, want: "unplanned"},
	}
	for _, tt := range tests {
		if got := contractFinancialStatus(tt.row); got != tt.want {
			t.Fatalf("contractFinancialStatus(%v) = %q, want %q", tt.row, got, tt.want)
		}
	}
}

func TestContractOwnerUIDUsesManualMappingAndFallback(t *testing.T) {
	m := &migrator{employeeUID: map[string]string{}}

	if got := m.contractOwnerUIDFromRow(row{"employee_id": "365"}); got != "chenzhongzhong" {
		t.Fatalf("contractOwnerUIDFromRow manual 365 = %q, want chenzhongzhong", got)
	}

	m.employeeUID["122"] = "wangmin"
	if got := m.contractOwnerUIDFromRow(row{"employee_id": "122"}); got != "wangmin" {
		t.Fatalf("contractOwnerUIDFromRow cached 122 = %q, want wangmin", got)
	}

	m.employeeUID["425"] = ""
	if got := m.contractOwnerUIDFromRow(row{"employee_id": "425"}); got != fallbackContractOwnerUID {
		t.Fatalf("contractOwnerUIDFromRow fallback 425 = %q, want %q", got, fallbackContractOwnerUID)
	}
}

func TestValuesWithInsertDefaultsDoesNotMutateSourceAndFillsMissing(t *testing.T) {
	values := map[string]any{"name": "合同"}
	got := valuesWithInsertDefaults(values, map[string]any{"owner_user_id": fallbackContractOwnerUID})
	if got["owner_user_id"] != fallbackContractOwnerUID {
		t.Fatalf("valuesWithInsertDefaults missing owner = %#v, want fallback", got)
	}
	if _, ok := values["owner_user_id"]; ok {
		t.Fatalf("valuesWithInsertDefaults mutated source values: %#v", values)
	}

	got = valuesWithInsertDefaults(map[string]any{"owner_user_id": "wangmin"}, map[string]any{"owner_user_id": fallbackContractOwnerUID})
	if got["owner_user_id"] != "wangmin" {
		t.Fatalf("valuesWithInsertDefaults overwrote non-empty owner = %#v", got)
	}
}

func TestSortedUpdateKeysPreservesContractStatusFields(t *testing.T) {
	keys := sortedUpdateKeys(map[string]any{
		"status":               "completed",
		"legal_status":         "closed",
		"fulfillment_status":   "fulfilled",
		"financial_status":     "received",
		"activation_status":    "completed",
		"completed_at":         "2026-06-24 00:00:00",
		"terminated_at":        nil,
		"amount_tax_inclusive": "100.00",
		"name":                 "合同名称",
	}, []string{
		"status",
		"legal_status",
		"fulfillment_status",
		"financial_status",
		"activation_status",
		"completed_at",
		"terminated_at",
	})
	got := map[string]bool{}
	for _, key := range keys {
		got[key] = true
	}
	for _, blocked := range []string{"status", "legal_status", "fulfillment_status", "financial_status", "activation_status", "completed_at", "terminated_at"} {
		if got[blocked] {
			t.Fatalf("sortedUpdateKeys included preserved contract field %q in %#v", blocked, keys)
		}
	}
	for _, allowed := range []string{"amount_tax_inclusive", "name"} {
		if !got[allowed] {
			t.Fatalf("sortedUpdateKeys missing allowed field %q in %#v", allowed, keys)
		}
	}
}

func TestNormalizeInvoiceTypeAndChannel(t *testing.T) {
	if got := normalizeInvoiceType("1"); got != "special_vat" {
		t.Fatalf("normalizeInvoiceType(1) = %q", got)
	}
	if got := normalizeInvoiceType("普票"); got != "general_vat" {
		t.Fatalf("normalizeInvoiceType(普票) = %q", got)
	}
	if got := normalizeChannel("转账"); got != "bank_transfer" {
		t.Fatalf("normalizeChannel(转账) = %q", got)
	}
}

func TestMaskAccountNo(t *testing.T) {
	if got := maskAccountNo("123456789012"); got != "1234****9012" {
		t.Fatalf("maskAccountNo = %q", got)
	}
	if got := maskAccountNo("12345678"); got != "12345678" {
		t.Fatalf("short maskAccountNo = %q", got)
	}
}

func TestUpsertKeyKindsFallsBackToCode(t *testing.T) {
	kinds := upsertKeyKinds(map[string]bool{"id": true, "code": true}, upsertMatch{
		SourceID: "4",
		Code:     "CTMIG4",
	})
	if len(kinds) != 1 || kinds[0] != "code" {
		t.Fatalf("upsertKeyKinds without legacy columns = %#v, want code", kinds)
	}

	kinds = upsertKeyKinds(map[string]bool{"legacy_source": true, "legacy_id": true, "code": true}, upsertMatch{
		SourceID: "4",
		Code:     "CTMIG4",
	})
	if len(kinds) != 2 || kinds[0] != "legacy" || kinds[1] != "code" {
		t.Fatalf("upsertKeyKinds with legacy columns = %#v, want legacy then code", kinds)
	}

	kinds = upsertKeyKinds(
		map[string]bool{"id": true, "bank_account_id": true, "snapshot_date": true, "source_type": true},
		upsertMatch{SourceID: "3", Natural: map[string]any{
			"bank_account_id": int64(33),
			"snapshot_date":   "2023-02-25",
			"source_type":     "migration",
		}},
	)
	if len(kinds) != 1 || kinds[0] != "natural" {
		t.Fatalf("upsertKeyKinds with natural key = %#v, want natural", kinds)
	}
}

func TestNaturalKeyValues(t *testing.T) {
	values := map[string]any{
		"bank_account_id": int64(33),
		"snapshot_date":   "2023-02-25",
		"source_type":     "migration",
	}
	natural := naturalKeyValues([]string{"bank_account_id", "snapshot_date", "source_type"}, values)
	if len(natural) != 3 || natural["snapshot_date"] != "2023-02-25" {
		t.Fatalf("naturalKeyValues = %#v", natural)
	}
	if got := naturalKeyValues([]string{"bank_account_id", "missing"}, values); got != nil {
		t.Fatalf("naturalKeyValues missing field = %#v, want nil", got)
	}
}

func TestAccountBalanceSnapshotDatePrefersCheckDate(t *testing.T) {
	got := accountBalanceSnapshotDate(row{
		"check_date":   "2023-02-01",
		"operate_time": "2023-02-25 20:05:23",
	})
	if got != "2023-02-01" {
		t.Fatalf("accountBalanceSnapshotDate = %q, want check_date", got)
	}
}

func TestSuffixAfterPrefix(t *testing.T) {
	if got := suffixAfterPrefix("CTMIG4", "CTMIG"); got != "4" {
		t.Fatalf("suffixAfterPrefix = %q, want 4", got)
	}
	if got := suffixAfterPrefix("CTMIGABC", "CTMIG"); got != "" {
		t.Fatalf("suffixAfterPrefix nonnumeric = %q, want empty", got)
	}
}
