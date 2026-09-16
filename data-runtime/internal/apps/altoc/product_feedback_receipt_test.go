package altoc

import "testing"

func TestProductFeedbackReceiptIdentity(t *testing.T) {
	command := map[string]any{"requestBizId": "550e8400-e29b-41d4-a716-446655440000", "action": "create", "actorUid": "pm", "ticketCode": "ST-1", "productCode": "P1", "title": "Title", "description": ""}
	kind, id := altocIntegrationOperationExpectedTarget(altocProductFeedbackOperation, command)
	if kind != "product_request" || id != command["requestBizId"] {
		t.Fatal("wrong feedback target")
	}
	if altocOperationReceiptSchema(altocProductFeedbackOperation) != altocProductFeedbackSchema || altocOperationReceiptSchema(opsKnowledgeCodocsOperationCode) != "v1" {
		t.Fatal("schema not bound to operation")
	}
	for _, value := range []any{nil, "", 42, "not-a-uuid"} {
		command["requestBizId"] = value
		if kind, _ := altocIntegrationOperationExpectedTarget(altocProductFeedbackOperation, command); kind != "" {
			t.Fatal("invalid target accepted")
		}
	}
}
