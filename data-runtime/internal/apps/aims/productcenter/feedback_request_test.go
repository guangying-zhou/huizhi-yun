package productcenter

import (
	"strings"
	"testing"
)

func TestFeedbackRequestFrozenCommand(t *testing.T) {
	base := map[string]any{"actorUid": "pm", "productCode": "PRODUCT", "ticketCode": "ST-1", "requestBizId": "00000000-0000-4000-8000-000000000001", "title": "客户提出的需求", "description": "第一行\n第二行", "action": "create"}
	result, err := ParseFeedbackRequest(base)
	if err != nil || result.Description != "第一行\n第二行" {
		t.Fatalf("valid frozen command: %+v %v", result, err)
	}
	for key, value := range map[string]any{"actorUid": nil, "productCode": "P/other", "ticketCode": strings.Repeat("t", 31), "requestBizId": "00000000-0000-0000-0000-000000000000", "title": "bad\nheader", "description": strings.Repeat("字", 10001), "action": "edit"} {
		command := map[string]any{}
		for k, v := range base {
			command[k] = v
		}
		command[key] = value
		if _, err := ParseFeedbackRequest(command); err == nil {
			t.Errorf("accepted invalid %s", key)
		}
	}
	for _, key := range []string{"priority", "verified", "customerId"} {
		base[key] = "injected"
		if _, err := ParseFeedbackRequest(base); err == nil {
			t.Errorf("accepted injected %s", key)
		}
		delete(base, key)
	}
}
