package aims

import "testing"

func TestProductDocumentOperationIdentity(t *testing.T) {
	command := map[string]any{"actorUid": "user", "productCode": "PRODUCT", "title": "Specification", "action": "create", "documentUuid": "00000000-0000-4000-8000-000000000001", "templateUuid": "00000000-0000-4000-8000-000000000002"}
	if err := validateServiceTicketDeliveryOperation("codocs", productDocumentCreateOperationCode, command); err != nil {
		t.Fatal(err)
	}
	kind, code := aimsIntegrationOperationExpectedTarget(productDocumentCreateOperationCode, command)
	if kind != "product_document" || code != command["documentUuid"] {
		t.Fatal("incorrect frozen target")
	}
	if aimsIntegrationOperationCommandSchema(productDocumentCreateOperationCode) != "product-document-create.v1" || aimsIntegrationOperationCommandSchema(serviceTicketDeliveryOperationCode) != "v1" {
		t.Fatal("incorrect receipt schema")
	}
	if validateServiceTicketDeliveryOperation("assets", productDocumentCreateOperationCode, command) == nil {
		t.Fatal("accepted wrong target app")
	}
	for key, value := range map[string]any{"actorUid": nil, "productCode": "P/other", "title": 42, "action": "read", "documentUuid": command["templateUuid"], "templateUuid": "invalid"} {
		original := command[key]
		command[key] = value
		if validateServiceTicketDeliveryOperation("codocs", productDocumentCreateOperationCode, command) == nil {
			t.Errorf("accepted invalid %s", key)
		}
		command[key] = original
	}
	command["extra"] = true
	if validProductDocumentCreationCommand(command) {
		t.Fatal("accepted extra command field")
	}
}
