package finance

import (
	"context"
	"encoding/json"
	"testing"
)

func TestProductCostRulesReceiptRejectsMismatchedAuthorizedContext(t *testing.T) {
	command := json.RawMessage(`{"actorUid":"U1","projectCode":"PRJ1","periodMonth":"2026-09","expectedRevision":0,"evidenceRef":"APPROVAL","shares":[]}`)
	for _, scope := range [][3]string{{"U2", "PRJ1", "2026-09"}, {"U1", "OTHER", "2026-09"}, {"U1", "PRJ1", "2026-10"}} {
		if _, err := productCostRulesReceiptHandler(scope[0], scope[1], scope[2])(context.Background(), nil, command); err == nil {
			t.Fatal("mismatched command accepted")
		}
	}
	if _, err := productCostRulesReceiptHandler("U1", "PRJ1", "2026-09")(context.Background(), nil, json.RawMessage(`{} {}`)); err == nil {
		t.Fatal("invalid JSON accepted")
	}
}
