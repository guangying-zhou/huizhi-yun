package aims

import "testing"

func TestProductFeedbackStatusOperation(t *testing.T) {
	command := map[string]any{"ticketCode": "ST-1", "productCode": "P1", "requestBizId": "123e4567-e89b-42d3-a456-426614174000", "canonicalRequestBizId": "123e4567-e89b-42d3-a456-426614174000", "decisionStatus": "accepted", "sourceRevision": float64(3)}
	if err := validateServiceTicketDeliveryOperation("altoc", productFeedbackStatusOperationCode, "product-feedback-status.v1", command); err != nil {
		t.Fatal(err)
	}
	if err := validateServiceTicketDeliveryOperation("codocs", productFeedbackStatusOperationCode, "product-feedback-status.v1", command); err == nil {
		t.Fatal("wrong target accepted")
	}
	kind, id := aimsIntegrationOperationExpectedTarget(productFeedbackStatusOperationCode, command)
	if kind != "product_feedback" || id != command["requestBizId"] || aimsIntegrationOperationCommandSchema(productFeedbackStatusOperationCode) != "product-feedback-status.v1" {
		t.Fatal("incorrect receipt identity")
	}
	for _, value := range []any{float64(0), float64(1.5), float64(9007199254740992), "3", nil} {
		command["sourceRevision"] = value
		if validProductFeedbackStatusCommand(command) {
			t.Fatal("invalid revision accepted")
		}
	}
	command["sourceRevision"] = float64(3)
	command["ticketStatus"] = "closed"
	if validProductFeedbackStatusCommand(command) {
		t.Fatal("extra ticket field accepted")
	}
}
