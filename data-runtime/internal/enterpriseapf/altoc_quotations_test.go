package enterpriseapf

import "testing"

func TestAPFQuotationMoneyAndClosedInput(t *testing.T) {
	i := QuotationItem{Name: "中文", Quantity: "1.2500", Price: "100.00", Discount: "5.00", Tax: "6.00"}
	g, n, e := quotationAmounts(i)
	if e != nil || g != "118.75" || n != "112.03" {
		t.Fatal(g, n, e)
	}
	good := QuotationInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1)}, Items: []QuotationItem{i}}
	if e := ValidateQuotationInput("quotation-items-replace", good); e != nil {
		t.Fatal(e)
	}
	for _, k := range []string{"status", "approved_by", "amount_tax_inclusive", "owner_uid"} {
		bad := good
		bad.Payload = map[string]any{"expectedVersion": float64(1), k: "forged"}
		if ValidateQuotationInput("quotation-items-replace", bad) == nil {
			t.Fatal(k)
		}
	}
	bad := good
	bad.Items = []QuotationItem{i}
	bad.Items[0].Price = "1e6"
	if ValidateQuotationInput("quotation-items-replace", bad) == nil {
		t.Fatal("exponent")
	}
	if ValidateQuotationInput("quotations-create", QuotationInput{CustomerID: "1", Payload: map[string]any{"currency_code": float64(1)}}) == nil {
		t.Fatal("wrong currency type")
	}
}
