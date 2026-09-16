package aims

import "testing"

func TestProductFeedbackProgressOperation(t *testing.T) {
	command := map[string]any{"ticketCode": "ST-1", "productCode": "P1", "requestBizId": "123e4567-e89b-42d3-a456-426614174000", "canonicalRequestBizId": "123e4567-e89b-42d3-a456-426614174000", "decisionStatus": "accepted", "sourceRevision": float64(3), "canonicalDecisionStatus": "accepted", "versions": []any{}}
	if err := validateServiceTicketDeliveryOperation("altoc", productFeedbackProgressOperationCode, command); err != nil {
		t.Fatal(err)
	}
	if err := validateServiceTicketDeliveryOperation("codocs", productFeedbackProgressOperationCode, command); err == nil {
		t.Fatal("wrong target accepted")
	}
	kind, id := aimsIntegrationOperationExpectedTarget(productFeedbackProgressOperationCode, command)
	if kind != "product_feedback" || id != command["requestBizId"] || aimsIntegrationOperationCommandSchema(productFeedbackProgressOperationCode) != "product-feedback-progress.v1" {
		t.Fatal("incorrect receipt identity")
	}
	for _, value := range []any{float64(0), float64(1.5), float64(9007199254740992), "3", nil} {
		command["sourceRevision"] = value
		if validProductFeedbackProgressCommand(command) {
			t.Fatal("invalid revision accepted")
		}
	}
	command["sourceRevision"] = float64(3)
	command["ticketStatus"] = "closed"
	if validProductFeedbackProgressCommand(command) {
		t.Fatal("extra ticket field accepted")
	}
}

func TestProductFeedbackProgressVersionValidation(t *testing.T) {
	row := map[string]any{"versionCode": "v1", "status": "planning", "plannedReleaseDate": "2026-09-01", "releasedAt": nil, "publicFeatureCount": float64(1), "deliveredFeatureCount": float64(0)}
	command := map[string]any{"ticketCode": "ST-1", "productCode": "P1", "requestBizId": "123e4567-e89b-42d3-a456-426614174000", "canonicalRequestBizId": "123e4567-e89b-42d3-a456-426614174000", "decisionStatus": "accepted", "sourceRevision": float64(3), "canonicalDecisionStatus": "accepted", "versions": []any{row}}
	if !validProductFeedbackProgressCommand(command) {
		t.Fatal("valid version rejected")
	}
	for key, value := range map[string]any{"plannedReleaseDate": "2026-02-30", "releasedAt": "2026-09-01", "publicFeatureCount": float64(0), "deliveredFeatureCount": float64(2), "status": "deployed", "versionCode": "x\n"} {
		old := row[key]
		row[key] = value
		if validProductFeedbackProgressCommand(command) {
			t.Fatalf("invalid %s accepted", key)
		}
		row[key] = old
	}
	command["versions"] = []any{row, row}
	if validProductFeedbackProgressCommand(command) {
		t.Fatal("duplicate version accepted")
	}
	command["versions"] = []any{row}
	delete(row, "releasedAt")
	if validProductFeedbackProgressCommand(command) {
		t.Fatal("missing nullable date accepted")
	}
}
