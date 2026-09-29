package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestEnterpriseTimeEntryReviewWriteTSGoFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../foundation/test/fixtures/enterprise-time-entry-review-write.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method, Target, Actor, Tenant, Deployment, ProjectID, Key, Token, Canonical, Signature string
		Payload                                                                                map[string]any
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(fixture.Method, "http://runtime"+fixture.Target, nil)
	r.Header.Set("Authorization", "Bearer "+fixture.Token)
	r.Header.Set("Idempotency-Key", fixture.Key)
	r.Header.Set("X-HZY-Enterprise-Timesheet-Review-Write-Signature", fixture.Signature)
	input := enterpriseDelegatedInput{Tenant: fixture.Tenant, Deployment: fixture.Deployment, ProjectID: fixture.ProjectID, Payload: fixture.Payload}
	canonical, err := enterpriseTimeEntryReviewWriteCanonical(r, input, fixture.Actor, fixture.Key)
	if err != nil || canonical != fixture.Canonical {
		t.Fatalf("canonical drift: %v, %q", err, canonical)
	}
	if err = verifyEnterpriseTimeEntryReviewWriteSignature(r, input, enterpriseRequestContext{ActorUID: fixture.Actor}); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseTimeEntryReviewWriteSignatureBindsEveryDecisionField(t *testing.T) {
	input := enterpriseDelegatedInput{Tenant: "T1", Deployment: "host", ProjectID: "12", Payload: map[string]any{"action": "return", "reason": "correct hours", "entries": []any{map[string]any{"id": float64(7), "rowVersion": float64(2)}}}}
	verified := enterpriseRequestContext{ActorUID: "U1"}
	request := httptest.NewRequest(http.MethodPost, "http://runtime/v1/enterprise/aims/time-entry-reviews:submit", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	request.Header.Set("Idempotency-Key", "review-key")
	canonical, err := enterpriseTimeEntryReviewWriteCanonical(request, input, "U1", "review-key")
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, []byte("test-token"))
	mac.Write([]byte(canonical))
	request.Header.Set("X-HZY-Enterprise-Timesheet-Review-Write-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	if err = verifyEnterpriseTimeEntryReviewWriteSignature(request, input, verified); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*enterpriseDelegatedInput, *http.Request, *enterpriseRequestContext){
		"actor":   func(_ *enterpriseDelegatedInput, _ *http.Request, v *enterpriseRequestContext) { v.ActorUID = "U2" },
		"project": func(i *enterpriseDelegatedInput, _ *http.Request, _ *enterpriseRequestContext) { i.ProjectID = "13" },
		"reason": func(i *enterpriseDelegatedInput, _ *http.Request, _ *enterpriseRequestContext) {
			i.Payload["reason"] = "else"
		},
		"version": func(i *enterpriseDelegatedInput, _ *http.Request, _ *enterpriseRequestContext) {
			i.Payload["entries"] = []any{map[string]any{"id": float64(7), "rowVersion": float64(3)}}
		},
		"key": func(_ *enterpriseDelegatedInput, r *http.Request, _ *enterpriseRequestContext) {
			r.Header.Set("Idempotency-Key", "other")
		},
		"path": func(_ *enterpriseDelegatedInput, r *http.Request, _ *enterpriseRequestContext) {
			r.URL.Path = "/v1/enterprise/aims/time-entry-reviews:list"
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := input
			changed.Payload = map[string]any{}
			for k, v := range input.Payload {
				changed.Payload[k] = v
			}
			r := request.Clone(request.Context())
			r.Header = request.Header.Clone()
			v := verified
			mutate(&changed, r, &v)
			if verifyEnterpriseTimeEntryReviewWriteSignature(r, changed, v) == nil {
				t.Fatal("tamper accepted")
			}
		})
	}
	for name, payload := range map[string]map[string]any{
		"duplicate":  {"action": "approve", "reason": "", "entries": []any{map[string]any{"id": float64(7), "rowVersion": float64(1)}, map[string]any{"id": float64(7), "rowVersion": float64(1)}}},
		"unknown":    {"action": "approve", "reason": "", "entries": []any{map[string]any{"id": float64(7), "rowVersion": float64(1)}}, "extra": true},
		"fractional": {"action": "approve", "reason": "", "entries": []any{map[string]any{"id": float64(7.5), "rowVersion": float64(1)}}},
	} {
		t.Run(name, func(t *testing.T) {
			changed := input
			changed.Payload = payload
			if _, e := enterpriseTimeEntryReviewWriteCanonical(request, changed, "U1", "review-key"); e == nil {
				t.Fatal("invalid payload")
			}
		})
	}
}
