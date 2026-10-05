package gatewaykeys

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func assertionFixture(t *testing.T) (fixture, ed25519.PrivateKey, Assertion) {
	f := setup(t)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	h := sha256.Sum256(pub)
	f.body.Keys[0].PublicKey = base64.RawURLEncoding.EncodeToString(pub)
	f.body.Keys[0].KID = hex.EncodeToString(h[:])
	if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(10000)); err != nil {
		t.Fatal(err)
	}
	a := Assertion{Issuer: "gateway:test-gateway", Subject: "gateway:test-gateway", Audience: ExchangePath, Tenant: "T-TEST", Environment: "test", GatewayDeployment: "test-gateway", RuntimeCode: "test-runtime", AppCode: "aims", Deployment: "test-aims", OAuthAudience: "data-runtime", Scope: "aims:product:view", ClientID: "aims.runtime", SourceBinding: "trusted-gateway", Method: "POST", Path: ExchangePath, IssuedAt: 10, NotBefore: 10, ExpiresAt: 70, JTI: base64.RawURLEncoding.EncodeToString(make([]byte, 16)), KID: f.body.Keys[0].KID}
	return f, key, a
}
func assertionJWT(key ed25519.PrivateKey, a Assertion) string {
	h, _ := json.Marshal(map[string]string{"alg": "EdDSA", "typ": AssertionType, "kid": a.KID})
	b, _ := json.Marshal(a)
	raw := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(b)
	return raw + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(raw)))
}
func TestAssertionTrustMatrix(t *testing.T) {
	cases := map[string]func(*Assertion){"issuer": func(a *Assertion) { a.Issuer = "other" }, "subject": func(a *Assertion) { a.Subject = "other" }, "aud": func(a *Assertion) { a.Audience = "other" }, "tenant": func(a *Assertion) { a.Tenant = "other" }, "env": func(a *Assertion) { a.Environment = "dev" }, "gateway": func(a *Assertion) { a.GatewayDeployment = "other" }, "runtime": func(a *Assertion) { a.RuntimeCode = "other" }, "method": func(a *Assertion) { a.Method = "GET" }, "path": func(a *Assertion) { a.Path = "/v1/console/auth/service-tokens/issue" }, "binding": func(a *Assertion) { a.SourceBinding = "service-client-policy" }, "ttl": func(a *Assertion) { a.ExpiresAt = 71 }, "future": func(a *Assertion) { a.IssuedAt = 41; a.NotBefore = 41; a.ExpiresAt = 101 }, "expired": func(a *Assertion) { a.IssuedAt = 1; a.NotBefore = 1; a.ExpiresAt = 2 }, "nbf": func(a *Assertion) { a.NotBefore = 11 }, "jti": func(a *Assertion) { a.JTI = "short" }, "scope": func(a *Assertion) { a.Scope = "b  a" }, "kid": func(a *Assertion) { a.KID = strings.Repeat("a", 64) }}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f, key, a := assertionFixture(t)
			mutate(&a)
			now := time.Unix(10, 0)
			if name == "expired" {
				now = time.Unix(32, 0)
			}
			called := false
			err := f.s.WithAssertion(assertionJWT(key, a), now, func(Assertion) error { called = true; return nil })
			if err == nil || called {
				t.Fatal("invalid assertion reached transaction")
			}
		})
	}
	f, key, a := assertionFixture(t)
	called := false
	if err := f.s.WithAssertion(assertionJWT(key, a), time.Unix(10, 0), func(v Assertion) error {
		called = true
		if v.KID != a.KID {
			t.Fatal("kid lost")
		}
		return nil
	}); err != nil || !called {
		t.Fatal(err)
	}
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	if err := f.s.WithAssertion(assertionJWT(other, a), time.Unix(10, 0), func(Assertion) error { return nil }); !errors.Is(err, ErrAssertion) {
		t.Fatal(err)
	}
	// A missing/expired cache is the sole retryable keyset absence. A bad signature
	// or rollback stays distinguishable and must never select legacy fallback.
	f.s.Unavailable()
	if err := f.s.WithAssertion(assertionJWT(key, a), time.Unix(10, 0), func(Assertion) error { return nil }); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	f.s.Reject()
	f.s.Unavailable()
	if err := f.s.WithAssertion(assertionJWT(key, a), time.Unix(10, 0), func(Assertion) error { return nil }); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}
func TestAssertionStrictJSONAndHeader(t *testing.T) {
	f, key, a := assertionFixture(t)
	good := assertionJWT(key, a)
	parts := strings.Split(good, ".")
	for _, header := range []string{`{"alg":"HS256","typ":"hzy-gateway-service-assertion+jwt","kid":"` + a.KID + `"}`, `{"alg":"EdDSA","alg":"EdDSA","typ":"hzy-gateway-service-assertion+jwt","kid":"` + a.KID + `"}`, `{"alg":"EdDSA","typ":"JWT","kid":"` + a.KID + `"}`} {
		raw := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + parts[1]
		jwt := raw + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(raw)))
		if err := f.s.WithAssertion(jwt, time.Unix(10, 0), func(Assertion) error { return nil }); !errors.Is(err, ErrAssertion) {
			t.Fatal(err)
		}
	}
	body, _ := base64.RawURLEncoding.DecodeString(parts[1])
	body = []byte(strings.Replace(string(body), `"tenant":"T-TEST"`, `"tenant":"T-TEST","tenant":"T-TEST"`, 1))
	raw := parts[0] + "." + base64.RawURLEncoding.EncodeToString(body)
	jwt := raw + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(raw)))
	if err := f.s.WithAssertion(jwt, time.Unix(10, 0), func(Assertion) error { return nil }); !errors.Is(err, ErrAssertion) {
		t.Fatal(err)
	}
}

func TestExchangeTransportJSONIsStrict(t *testing.T) {
	for _, raw := range []string{`{"scope":"a","scope":"a"}`, `{"app_code":"aims"}`, `null`, `{} {}`} {
		if _, err := DecodeExchangeBody([]byte(raw)); err == nil {
			t.Fatal("transport JSON accepted", raw)
		}
	}
	if _, err := DecodeExchangeBody([]byte(`{"assertion":"signed"}`)); err != nil {
		t.Fatal(err)
	}
}

// The public fixture was produced by the actual WebCrypto Worker signer. Its
// private key was discarded and its assertion expired in 1970; no live token.
func TestWorkerAssertionCrossLanguage(t *testing.T) {
	raw, err := os.ReadFile("testdata/gateway-worker-assertion.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		PublicKey string `json:"publicKey"`
		Assertion string `json:"assertion"`
		Now       int64  `json:"now"`
	}
	if err = json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	public, err := base64.RawURLEncoding.DecodeString(sample.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	f := setup(t)
	hash := sha256.Sum256(public)
	f.body.Keys[0].PublicKey = sample.PublicKey
	f.body.Keys[0].KID = hex.EncodeToString(hash[:])
	now := time.Unix(sample.Now, 0)
	if err = f.s.Accept(f.envelope(f.body), now); err != nil {
		t.Fatal(err)
	}
	if err = f.s.WithAssertion(sample.Assertion, now, func(a Assertion) error {
		if a.AppCode != "aims" || a.Deployment != "test-aims" || a.ClientID != "aims.runtime" || a.Scope != "aims:product:view" {
			t.Fatal("Worker claims mismatch")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
