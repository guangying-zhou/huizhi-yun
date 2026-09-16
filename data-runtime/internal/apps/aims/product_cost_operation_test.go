package aims

import "testing"

func TestProductCostOperationValidatesFrozenRulesAndReceiptTarget(t *testing.T) {
	command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "APPROVAL", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": float64(10000)}}}
	if !validProductCostRulesOperation(command) {
		t.Fatal("valid command rejected")
	}
	if err := validateServiceTicketDeliveryOperation("finance", productCostRulesOperationCode, command); err != nil {
		t.Fatal(err)
	}
	if err := validateServiceTicketDeliveryOperation("assets", productCostRulesOperationCode, command); err == nil {
		t.Fatal("wrong target accepted")
	}
	if aimsIntegrationOperationCommandSchema(productCostRulesOperationCode) != "product-cost-rules.v1" {
		t.Fatal("wrong schema")
	}
	if kind, code := aimsIntegrationOperationExpectedTarget(productCostRulesOperationCode, command); kind != "product_cost_attribution_revision" || code != "PRJ1:2026-09:3" {
		t.Fatalf("wrong receipt target: %s %s", kind, code)
	}
	kind, code := productCostRulesTarget(command)
	if kind != "product_cost_attribution_revision" || code != "PRJ1:2026-09:3" {
		t.Fatalf("%s %s", kind, code)
	}
	for _, override := range []map[string]any{{"expectedRevision": 2.5}, {"expectedRevision": "2"}, {"actorUid": "@all"}, {"shares": nil}, {"scope": "all"}, {"shares": []any{map[string]any{"productCode": "P1", "basisPoints": 10001}}}} {
		copy := map[string]any{}
		for key, value := range command {
			copy[key] = value
		}
		for key, value := range override {
			copy[key] = value
		}
		if validProductCostRulesOperation(copy) {
			t.Fatalf("accepted %v", override)
		}
	}
}
