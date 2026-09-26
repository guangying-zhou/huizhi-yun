package policyenvelope

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func assertionFixture(t *testing.T) (ed25519.PrivateKey, Body, func(map[string]any, map[string]any) string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := ServiceKey{Deployment: "console-test", KID: ServiceKeyID(public), PublicKey: base64.RawURLEncoding.EncodeToString(public), NotAfter: 9_000_000}
	body := Body{Tenant: "tenant-1", Status: "active", IssuedAt: 1_000_000, ExpiresAt: 4_600_000, Deployments: []string{"console-test"}, ServiceKeys: []ServiceKey{key}}
	sign := func(header, claims map[string]any) string {
		h := map[string]any{"alg": "EdDSA", "typ": AssertionType, "kid": key.KID}
		c := map[string]any{"iss": "console:console-test", "sub": "console:console-test", "aud": AssertionAudience, "token_use": AssertionUse,
			"tenant": "tenant-1", "deployment": "console-test", "scope": AssertionScope, "iat": 2000, "exp": 2060, "jti": "jti-0123456789abcdef"}
		for k, v := range header {
			if v == nil {
				delete(h, k)
			} else {
				h[k] = v
			}
		}
		for k, v := range claims {
			if v == nil {
				delete(c, k)
			} else {
				c[k] = v
			}
		}
		hb, _ := json.Marshal(h)
		cb, _ := json.Marshal(c)
		input := base64.RawURLEncoding.EncodeToString(hb) + "." + base64.RawURLEncoding.EncodeToString(cb)
		return input + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(input)))
	}
	return private, body, sign
}

var assertionBinding = AssertionBinding{Tenant: "tenant-1", Deployment: "console-test"}

func TestConsoleAssertionAccepted(t *testing.T) {
	_, body, sign := assertionFixture(t)
	token := sign(nil, nil)
	if !IsConsoleAssertion(token) {
		t.Fatal("not routed")
	}
	claims, validity, err := VerifyConsoleAssertion(token, body, nil, assertionBinding, 2_000_500)
	if err != nil || validity.Verdict != "valid" || claims.ID != "jti-0123456789abcdef" {
		t.Fatalf("%v %+v %+v", err, validity, claims)
	}
	// Past the envelope lease, an outage renewal keeps the key usable (grace).
	late := int64(4_700_000)
	grace := sign(nil, map[string]any{"iat": late / 1000, "exp": late/1000 + 60})
	_, validity, err = VerifyConsoleAssertion(grace, body, &Renewal{State: RenewalPlatformUnavailable, AttemptedAt: late - 1000}, assertionBinding, late)
	if err != nil || validity.Verdict != "grace" {
		t.Fatalf("grace: %v %+v", err, validity)
	}
}

func TestConsoleAssertionPolicyGate(t *testing.T) {
	_, body, sign := assertionFixture(t)
	late := int64(4_700_000)
	token := sign(nil, map[string]any{"iat": late / 1000, "exp": late/1000 + 60})
	for name, renewal := range map[string]*Renewal{
		"no renewal":    nil,
		"refused":       {State: RenewalRefused, AttemptedAt: late - 1000},
		"invalid":       {State: RenewalInvalid, AttemptedAt: late - 1000},
		"stale syncer":  {State: RenewalPlatformUnavailable, AttemptedAt: late - RenewalLivenessMS},
		"renewal is ok": {State: RenewalOK, AttemptedAt: late - 1000},
	} {
		if _, _, err := VerifyConsoleAssertion(token, body, renewal, assertionBinding, late); !errors.Is(err, ErrAssertionPolicy) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	suspended := body
	suspended.Status = "suspended"
	if _, _, err := VerifyConsoleAssertion(sign(nil, nil), suspended, nil, assertionBinding, 2_000_500); !errors.Is(err, ErrAssertionPolicy) {
		t.Fatalf("suspended: %v", err)
	}
	retired := body
	retired.ServiceKeys = []ServiceKey{body.ServiceKeys[0]}
	retired.ServiceKeys[0].NotAfter = 2_000_000
	if _, _, err := VerifyConsoleAssertion(sign(nil, nil), retired, nil, assertionBinding, 2_000_500); !errors.Is(err, ErrAssertionPolicy) {
		t.Fatalf("key past notAfter: %v", err)
	}
}

func TestConsoleAssertionRejected(t *testing.T) {
	_, body, sign := assertionFixture(t)
	now := int64(2_000_500)
	cases := map[string]string{
		"alg":             sign(map[string]any{"alg": "HS256"}, nil),
		"typ":             sign(map[string]any{"typ": "JWT"}, nil),
		"unknown kid":     sign(map[string]any{"kid": "csk_0000000000000000"}, nil),
		"extra header":    sign(map[string]any{"x5u": "https://evil"}, nil),
		"issuer":          sign(nil, map[string]any{"iss": "console:other"}),
		"subject":         sign(nil, map[string]any{"sub": "enterprise"}),
		"audience":        sign(nil, map[string]any{"aud": "data-runtime"}),
		"token use":       sign(nil, map[string]any{"token_use": "service"}),
		"scope":           sign(nil, map[string]any{"scope": "console:policy-bundle:write"}),
		"tenant":          sign(nil, map[string]any{"tenant": "tenant-2"}),
		"deployment":      sign(nil, map[string]any{"deployment": "console-prod"}),
		"short jti":       sign(nil, map[string]any{"jti": "x"}),
		"missing jti":     sign(nil, map[string]any{"jti": nil}),
		"extra claim":     sign(nil, map[string]any{"admin": true}),
		"expired":         sign(nil, map[string]any{"iat": 1900, "exp": 1960}),
		"too long":        sign(nil, map[string]any{"exp": 2061}),
		"future":          sign(nil, map[string]any{"iat": 2011, "exp": 2071}),
		"fractional time": sign(nil, map[string]any{"iat": 2000.5}),
	}
	for name, token := range cases {
		if _, _, err := VerifyConsoleAssertion(token, body, nil, assertionBinding, now); !errors.Is(err, ErrAssertionInvalid) {
			t.Fatalf("%s accepted: %v", name, err)
		}
	}
	good := sign(nil, nil)
	parts := strings.Split(good, ".")
	tampered := parts[0] + "." + parts[1] + "." + strings.Repeat("A", len(parts[2]))
	other := body
	other.ServiceKeys = []ServiceKey{body.ServiceKeys[0]}
	other.ServiceKeys[0].Deployment = "enterprise-test"
	for name, check := range map[string]func() error{
		"signature": func() error {
			_, _, err := VerifyConsoleAssertion(tampered, body, nil, assertionBinding, now)
			return err
		},
		"key for other app": func() error { _, _, err := VerifyConsoleAssertion(good, other, nil, assertionBinding, now); return err },
		"wrong binding": func() error {
			_, _, err := VerifyConsoleAssertion(good, body, nil, AssertionBinding{Tenant: "tenant-1", Deployment: "other"}, now)
			return err
		},
		"envelope tenant": func() error {
			b := body
			b.Tenant = "tenant-2"
			_, _, err := VerifyConsoleAssertion(good, b, nil, assertionBinding, now)
			return err
		},
		"not a jwt": func() error { _, _, err := VerifyConsoleAssertion("abc", body, nil, assertionBinding, now); return err },
		"padded segment": func() error {
			_, _, err := VerifyConsoleAssertion(parts[0]+"=."+parts[1]+"."+parts[2], body, nil, assertionBinding, now)
			return err
		},
	} {
		if err := check(); !errors.Is(err, ErrAssertionInvalid) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if IsConsoleAssertion("a.b.c") || IsConsoleAssertion(sign(map[string]any{"typ": "JWT"}, nil)) {
		t.Fatal("non-assertion routed")
	}
}
