package altoc

import (
	"context"
	"encoding/json"
	"testing"
)

func TestProductFeedbackStatusInput(t *testing.T) {
	command := map[string]any{"ticketCode": "ST-1", "productCode": "P1", "requestBizId": "123e4567-e89b-42d3-a456-426614174000", "canonicalRequestBizId": "123e4567-e89b-42d3-a456-426614174000", "decisionStatus": "accepted", "sourceRevision": 3}
	raw, _ := json.Marshal(command)
	if _, err := parseProductFeedbackStatus(raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"ticketCode", "productCode", "requestBizId", "canonicalRequestBizId", "decisionStatus", "sourceRevision"} {
		original := command[key]
		command[key] = nil
		raw, _ = json.Marshal(command)
		if _, err := parseProductFeedbackStatus(raw); err == nil {
			t.Fatalf("null %s accepted", key)
		}
		command[key] = original
	}
	command["ticketStatus"] = "closed"
	raw, _ = json.Marshal(command)
	if _, err := parseProductFeedbackStatus(raw); err == nil {
		t.Fatal("ticket status override accepted")
	}
	delete(command, "ticketStatus")
	for _, change := range []struct {
		key   string
		value any
	}{{"sourceRevision", 0}, {"sourceRevision", uint64(9007199254740992)}, {"sourceRevision", 1.5}, {"sourceRevision", "3"}, {"ticketCode", "ST/1"}, {"productCode", ""}, {"decisionStatus", "closed"}, {"canonicalRequestBizId", "123e4567-e89b-42d3-a456-426614174001"}} {
		original := command[change.key]
		command[change.key] = change.value
		raw, _ = json.Marshal(command)
		input, err := parseProductFeedbackStatus(raw)
		if err == nil {
			_, err = applyProductFeedbackStatusTx(context.Background(), nil, input)
		}
		if err == nil {
			t.Fatalf("invalid %s reached storage", change.key)
		}
		command[change.key] = original
	}
}
