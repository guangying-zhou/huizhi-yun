package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestAPFPeopleDirectoryRecoveryPermitGolden(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-directory-recovery-permit.json")
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
		t.Fatal("TS Go canonical differs")
	}
	now := time.Now()
	f.Body.Authorization.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
	v := enterpriseRequestContext{ActorUID: f.Body.Authorization.ActorUID, Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: f.Body.Authorization.Tenant}, HostDeployment: f.Body.Authorization.Deployment}}
	sign := func() {
		m := hmac.New(sha256.New, []byte("test-token"))
		m.Write([]byte(peopleFactsCanonical(r, f.Body)))
		r.Header.Set("Authorization", "Bearer test-token")
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
	}
	sign()
	if e = validatePeopleFactsPermit(r, f.Body, "directory-operations-replay", v, now); e != nil {
		t.Fatal(e)
	}
	before, _ := json.Marshal(f.Body)
	// A valid signature never substitutes for the exact personnel permit tuple.
	for _, mutate := range []func(*peopleFactsInput){
		func(i *peopleFactsInput) { i.Authorization.Resource = "employees" },
		func(i *peopleFactsInput) { i.Authorization.Action = "view" },
		func(i *peopleFactsInput) { i.Authorization.Tenant = "Other" },
		func(i *peopleFactsInput) { i.Authorization.Deployment = "Other" },
		func(i *peopleFactsInput) { i.Authorization.ObjectID = "different|" },
		func(i *peopleFactsInput) { i.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() },
	} {
		json.Unmarshal(before, &f.Body)
		mutate(&f.Body)
		sign()
		if validatePeopleFactsPermit(r, f.Body, "directory-operations-replay", v, now) == nil {
			t.Fatal("signed but mismatched recovery permit accepted")
		}
	}
	json.Unmarshal(before, &f.Body)
	sign()
	for _, mutate := range []func(*peopleFactsInput){func(i *peopleFactsInput) { i.Authorization.Action = "view" }, func(i *peopleFactsInput) { i.Authorization.Resource = "employees" }, func(i *peopleFactsInput) { i.Authorization.ActorUID = "Other" }, func(i *peopleFactsInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, func(i *peopleFactsInput) { i.Facts.Payload["expectedVersion"] = 8 }, func(i *peopleFactsInput) { i.Facts.Payload["forceSuccess"] = true }} {
		json.Unmarshal(before, &f.Body)
		mutate(&f.Body)
		if validatePeopleFactsPermit(r, f.Body, "directory-operations-replay", v, now) == nil {
			t.Fatal("tampered recovery accepted")
		}
	}
}
