package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestPeopleFactsPermitGoldenAndTamper(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-facts-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Method, Target, Canonical string
		Body                      peopleFactsInput
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(fixture.Method, fixture.Target, nil)
	if got := peopleFactsCanonical(r, fixture.Body); got != fixture.Canonical {
		t.Fatalf("canonical mismatch\ngot %s\nwant %s", got, fixture.Canonical)
	}
	now := time.Now()
	p := fixture.Body.Authorization
	p.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
	fixture.Body.Authorization = p
	v := enterpriseRequestContext{ActorUID: p.ActorUID, Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: p.Tenant}, HostDeployment: p.Deployment}}
	r.Header.Set("Authorization", "Bearer test-secret")
	sign := func() {
		m := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		m.Write([]byte(peopleFactsCanonical(r, fixture.Body)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
	}
	sign()
	if e = validatePeopleFactsPermit(r, fixture.Body, "assignments-change", v, now); e != nil {
		t.Fatal(e)
	}
	original := fixture.Body
	for _, mutate := range []func(*peopleFactsInput){func(i *peopleFactsInput) { i.Authorization.ActorUID = "Other" }, func(i *peopleFactsInput) { i.Authorization.Tenant = "Other" }, func(i *peopleFactsInput) { i.Authorization.Deployment = "Other" }, func(i *peopleFactsInput) { i.Authorization.Resource = "employees" }, func(i *peopleFactsInput) { i.Authorization.Action = "view" }, func(i *peopleFactsInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, func(i *peopleFactsInput) { i.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() }, func(i *peopleFactsInput) { i.Facts.SensitiveAllowed = true }, func(i *peopleFactsInput) { i.Authorization.Scope = altoc.BasicReadScope{Access: "all"} }} {
		fixture.Body = original
		mutate(&fixture.Body)
		if validatePeopleFactsPermit(r, fixture.Body, "assignments-change", v, now) == nil {
			t.Fatal("tampered permit allowed")
		}
	}
	hrCount, offboardingCount, recoveryCount := 0, 0, 0
	for _, op := range enterprisePeopleFactsPaths {
		if people.IsDirectoryRecoveryOperation(op) {
			recoveryCount++
		}
		if people.IsOffboardingOperation(op) {
			offboardingCount++
		}
		if people.IsHRSourceOperation(op) {
			hrCount++
		}
	}
	if len(enterprisePeopleFactsPaths)-hrCount-offboardingCount-recoveryCount != 24 || hrCount != 11 || offboardingCount != 6 || recoveryCount != 3 {
		t.Fatal("c1 user operation budget changed")
	}
}

func TestPeopleProvisioningSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-provisioning-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      peopleFactsInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if got := peopleFactsCanonical(r, f.Body); got != f.Canonical {
		t.Fatalf("c2 canonical mismatch\ngot %s\nwant %s", got, f.Canonical)
	}
	for k := range f.Body.Facts.Payload["confirmation"].(map[string]any) {
		var changed peopleFactsInput
		_ = json.Unmarshal(raw, &struct{ Body *peopleFactsInput }{Body: &changed})
		changed.Facts.Payload["confirmation"].(map[string]any)[k] = "tampered"
		if peopleFactsCanonical(r, changed) == f.Canonical {
			t.Fatal("unsigned confirmation fact", k)
		}
	}
}

func TestAPFHRSourceSharedGolden(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-hr-source-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      peopleFactsInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if peopleFactsCanonical(r, f.Body) != f.Canonical {
		t.Fatal("HR golden mismatch")
	}
}
