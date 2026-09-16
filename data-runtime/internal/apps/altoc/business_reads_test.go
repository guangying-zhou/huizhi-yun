package altoc

import (
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
)

func TestSortContractRowsSupportsFinanceDerivedAmounts(t *testing.T) {
	rows := []map[string]any{
		{"id": 1, "code": "C1", "unreceived_amount": "100.00"},
		{"id": 2, "code": "C2", "unreceived_amount": "300.00"},
		{"id": 3, "code": "C3", "unreceived_amount": "200.00"},
	}
	query := url.Values{"sort": {"unreceived_amount"}, "order": {"desc"}}

	sortContractRows(rows, query)

	got := []string{rows[0]["code"].(string), rows[1]["code"].(string), rows[2]["code"].(string)}
	want := []string{"C2", "C3", "C1"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sortContractRows order = %#v, want %#v", got, want)
		}
	}
}

func TestSortContractRowsSupportsTextColumns(t *testing.T) {
	rows := []map[string]any{
		{"id": 1, "code": "C1", "customer_name": "Gamma"},
		{"id": 2, "code": "C2", "customer_name": "Alpha"},
		{"id": 3, "code": "C3", "customer_name": "Beta"},
	}
	query := url.Values{"sort": {"customer_name"}, "order": {"asc"}}

	sortContractRows(rows, query)

	got := []string{rows[0]["code"].(string), rows[1]["code"].(string), rows[2]["code"].(string)}
	want := []string{"C2", "C3", "C1"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sortContractRows order = %#v, want %#v", got, want)
		}
	}
}

func TestCustomerBusinessStatsFromRowsUsesFinanceReceivedAmounts(t *testing.T) {
	stats := customerBusinessStatsFromRows(
		map[string]any{
			"opportunity_active":     int64(2),
			"opportunity_won_amount": "3500.50",
		},
		[]map[string]any{
			{"code": "CT1", "amount_tax_inclusive": "100000.00"},
			{"code": "CT2", "amount_tax_inclusive": "50000.00"},
		},
		map[string]finance.ContractSummary{
			"CT1": {ReceivedAmount: "60000.00"},
			"CT2": {ReceivedAmount: "25000.25"},
		},
	)

	if got, want := stats["opportunity_active"], 2; got != want {
		t.Fatalf("opportunity_active = %v, want %v", got, want)
	}
	if got, want := stats["opportunity_won_amount"], "3500.50"; got != want {
		t.Fatalf("opportunity_won_amount = %v, want %v", got, want)
	}
	if got, want := stats["contract_count"], 2; got != want {
		t.Fatalf("contract_count = %v, want %v", got, want)
	}
	if got, want := stats["contract_amount"], "150000.00"; got != want {
		t.Fatalf("contract_amount = %v, want %v", got, want)
	}
	if got, want := stats["total_received"], "85000.25"; got != want {
		t.Fatalf("total_received = %v, want %v", got, want)
	}
}
