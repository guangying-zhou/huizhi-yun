package policyenvelope

import (
	"encoding/json"
	"os"
	"testing"
)

// Shared with authz-core policyEnvelopeValidity.test.ts: both languages must
// produce identical verdicts for every vector.
func TestValidityVectorsMatchAuthzCore(t *testing.T) {
	raw, err := os.ReadFile("testdata/validity-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Constants struct {
			LongMaxAgeMs      int64 `json:"longMaxAgeMs"`
			OutageGraceMs     int64 `json:"outageGraceMs"`
			RenewalLivenessMs int64 `json:"renewalLivenessMs"`
		} `json:"constants"`
		Cases []struct {
			Name    string   `json:"name"`
			Body    Body     `json:"body"`
			Renewal *Renewal `json:"renewal"`
			Now     int64    `json:"now"`
			Expect  Validity `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if vectors.Constants.LongMaxAgeMs != LongMaxAgeMS || vectors.Constants.OutageGraceMs != OutageGraceMS || vectors.Constants.RenewalLivenessMs != RenewalLivenessMS {
		t.Fatalf("constants drifted from shared vectors: %+v", vectors.Constants)
	}
	if len(vectors.Cases) == 0 {
		t.Fatal("no vectors")
	}
	for _, vector := range vectors.Cases {
		got := EvaluateValidity(vector.Body, vector.Renewal, vector.Now)
		if got.Verdict != vector.Expect.Verdict || (got.ValidUntil == nil) != (vector.Expect.ValidUntil == nil) ||
			(got.ValidUntil != nil && *got.ValidUntil != *vector.Expect.ValidUntil) {
			t.Errorf("%s: got %s/%v, want %s/%v", vector.Name, got.Verdict, got.ValidUntil, vector.Expect.Verdict, vector.Expect.ValidUntil)
		}
	}
}

func TestValidityRejectsOutOfRangeTiming(t *testing.T) {
	body := Body{Status: "active", IssuedAt: 1000000, ExpiresAt: 4600000}
	for _, now := range []int64{-1, maxSafeInteger + 1} {
		if got := EvaluateValidity(body, nil, now); got.Verdict != "expired" {
			t.Errorf("now=%d: got %s", now, got.Verdict)
		}
	}
	negative := int64(-1)
	body.PolicyExpiresAt = &negative
	if got := EvaluateValidity(body, nil, 1000001); got.Verdict != "expired" {
		t.Errorf("negative policyExpiresAt: got %s", got.Verdict)
	}
}
