package finance

import "testing"

func TestAllocationCurrencyExplicitInput(t *testing.T) {
	for _, value := range []any{nil, "", "USD", "CNY", "EUR"} {
		got, err := allocationCurrencyInput(value)
		if err != nil {
			t.Fatalf("valid %v: %v", value, err)
		}
		if (value == nil || value == "") && got != nil {
			t.Fatal("unknown currency acquired default")
		}
		if value != nil && value != "" && got != value {
			t.Fatal("currency changed")
		}
	}
	for _, value := range []any{"usd", " USD", "USD ", "US", "USDD", 123, map[string]any{"code": "USD"}, []string{"USD"}} {
		if _, err := allocationCurrencyInput(value); err == nil {
			t.Fatalf("invalid currency accepted: %#v", value)
		}
	}
}
