package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
)

func TestAPF14cFinanceCostCanonicalFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-cost-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(f.Method, f.Target, nil)
	if got := apfPermitCanonical(req, f.Body); got != f.Canonical {
		t.Fatalf("canonical mismatch\ngot %s\nwant %s", got, f.Canonical)
	}
}
