package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestPeopleOffboardingPermitBindsSensitiveActionAndIntent(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-facts-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct{ Body peopleFactsInput }
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	f.Body.Authorization.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
	f.Body.Authorization.Resource = "offboarding_tasks"
	f.Body.Authorization.Action = "confirm"
	f.Body.Authorization.Operation = "offboarding-confirm"
	f.Body.Authorization.ObjectID = "1|Person"
	f.Body.Facts = people.EnterpriseFactsInput{ID: "1", EmployeeUID: "Person", Payload: map[string]any{"expectedVersion": float64(1), "taskType": "asset_recovery_coordination"}}
	r := httptest.NewRequest("POST", "/v1/enterprise/people/offboarding-cases:confirm", nil)
	r.Header.Set("Authorization", "Bearer isolated-fixture")
	v := enterpriseRequestContext{ActorUID: f.Body.Authorization.ActorUID, Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: f.Body.Authorization.Tenant}, HostDeployment: f.Body.Authorization.Deployment}}
	sign := func(i peopleFactsInput) {
		m := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		m.Write([]byte(peopleFactsCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
	}
	sign(f.Body)
	if e = validatePeopleFactsPermit(r, f.Body, "offboarding-confirm", v, now); e != nil {
		t.Fatal(e)
	}
	for name, mutate := range map[string]func(*peopleFactsInput){
		"admin is not confirm": func(i *peopleFactsInput) { i.Authorization.Action = "admin" },
		"wrong actor":          func(i *peopleFactsInput) { i.Authorization.ActorUID = "Other" },
		"wrong tenant":         func(i *peopleFactsInput) { i.Authorization.Tenant = "Other" },
		"wrong deployment":     func(i *peopleFactsInput) { i.Authorization.Deployment = "Other" },
		"expired":              func(i *peopleFactsInput) { i.Authorization.ExpiresAt = now.UnixMilli() },
		"wrong employee":       func(i *peopleFactsInput) { i.Facts.EmployeeUID = "Other" },
		"wrong version":        func(i *peopleFactsInput) { i.Facts.Payload["expectedVersion"] = float64(2) },
		"wrong task":           func(i *peopleFactsInput) { i.Facts.Payload["taskType"] = "handover" },
		"trusted field":        func(i *peopleFactsInput) { i.Facts.Payload["trusted"] = true },
	} {
		t.Run(name, func(t *testing.T) {
			original, _ := json.Marshal(f.Body)
			var changed peopleFactsInput
			json.Unmarshal(original, &changed)
			sign(f.Body)
			mutate(&changed)
			if validatePeopleFactsPermit(r, changed, "offboarding-confirm", v, now) == nil {
				t.Fatal("tamper accepted")
			}
		})
	}
	// Even a newly signed admin permit cannot stand in for the sensitive action.
	f.Body.Authorization.Action = "admin"
	sign(f.Body)
	if validatePeopleFactsPermit(r, f.Body, "offboarding-confirm", v, now) == nil {
		t.Fatal("admin implied confirm")
	}
}
