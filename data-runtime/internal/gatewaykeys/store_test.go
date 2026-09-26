package gatewaykeys

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixture struct {
	s       *Store
	private ed25519.PrivateKey
	body    Body
	path    string
	root    string
}

func setup(t *testing.T) fixture {
	t.Helper()
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	root := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	key, _, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(key)
	body := Body{Tenant: "T-TEST", Environment: "test", RuntimeCode: "test-runtime", GatewayDeployment: "test-gateway", Revision: 1, IssuedAt: 1000, ExpiresAt: 301000, Keys: []Key{{KID: hex.EncodeToString(hash[:]), PublicKey: base64.RawURLEncoding.EncodeToString(key), Status: "active", NotBefore: 1000, NotAfter: 500000}}}
	path := filepath.Join(t.TempDir(), "gateway-keyset.json")
	s, err := New(Binding{"T-TEST", "test", "test-runtime", "test-gateway"}, "test-root", root, path)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{s, private, body, path, root}
}
func (f fixture) envelope(body Body) []byte {
	raw, _ := json.Marshal(body)
	e := Envelope{Schema: Schema, Alg: "Ed25519", KID: "test-root", Body: string(raw)}
	e.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(f.private, []byte(Schema+"\n"+e.Body)))
	out, _ := json.Marshal(e)
	return out
}
func TestVerifiedKeysPersistenceAndFreshBoot(t *testing.T) {
	f := setup(t)
	now := time.UnixMilli(1000)
	if err := f.s.Accept(f.envelope(f.body), now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.VerificationKey(f.body.Keys[0].KID, now); err != nil {
		t.Fatal(err)
	}
	stat, _ := os.Stat(f.path)
	if stat.Mode().Perm() != 0600 {
		t.Fatal("not private")
	}
	s, err := New(f.s.binding, "test-root", f.root, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.VerificationKey(f.body.Keys[0].KID, now); err == nil {
		t.Fatal("disk cannot authorize before fresh sync")
	}
	lower := f.body
	lower.Revision = 0
	if err = s.Accept(f.envelope(lower), now); err == nil {
		t.Fatal("invalid revision")
	}
	if err = s.Accept(f.envelope(f.body), now); err != nil {
		t.Fatal(err)
	}
	if _, err = s.VerificationKey(f.body.Keys[0].KID, time.UnixMilli(301000)); err == nil {
		t.Fatal("expired accepted")
	}
}
func TestMonotonicRevisionSameRevisionRenewalAndRevocation(t *testing.T) {
	f := setup(t)
	now := time.UnixMilli(1000)
	if err := f.s.Accept(f.envelope(f.body), now); err != nil {
		t.Fatal(err)
	}
	renewal := f.body
	renewal.IssuedAt = 2000
	renewal.ExpiresAt = 302000
	if err := f.s.Accept(f.envelope(renewal), time.UnixMilli(2000)); err != nil {
		t.Fatal(err)
	}
	changed := renewal
	changed.Keys = []Key{}
	if err := f.s.Accept(f.envelope(changed), time.UnixMilli(2000)); !errors.Is(err, ErrRollback) {
		t.Fatal(err)
	}
	if _, err := f.s.VerificationKey(f.body.Keys[0].KID, now); err == nil {
		t.Fatal("must fail closed")
	}
	changed.Revision = 2
	if err := f.s.Accept(f.envelope(changed), time.UnixMilli(2000)); err != nil {
		t.Fatal(err)
	}
	if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(2000)); !errors.Is(err, ErrRollback) {
		t.Fatal(err)
	}
	// A restart preserves the revision floor, including when the last response failed.
	s, err := New(f.s.binding, "test-root", f.root, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Accept(f.envelope(f.body), now); !errors.Is(err, ErrRollback) {
		t.Fatal(err)
	}
}
func TestSignatureBindingLifetimeAndMalformedFailClosed(t *testing.T) {
	tests := map[string]func(*Body){"tenant": func(b *Body) { b.Tenant = "other" }, "environment": func(b *Body) { b.Environment = "dev" }, "runtime": func(b *Body) { b.RuntimeCode = "other" }, "gateway": func(b *Body) { b.GatewayDeployment = "other" }, "age": func(b *Body) { b.ExpiresAt = 301001 }, "future": func(b *Body) { b.IssuedAt = 40000; b.ExpiresAt = 50000 }, "nullKeys": func(b *Body) { b.Keys = nil }, "keyHash": func(b *Body) { b.Keys[0].KID = strings.Repeat("a", 64) }, "keyLifetime": func(b *Body) { b.Keys[0].NotAfter = 1000 + MaxLifetimeMS + 1 }, "duplicateKey": func(b *Body) { b.Keys = append(b.Keys, b.Keys[0]) }}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			f := setup(t)
			if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(1000)); err != nil {
				t.Fatal(err)
			}
			kid := f.body.Keys[0].KID
			mutate(&f.body)
			if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(1000)); err == nil {
				t.Fatal("invalid accepted")
			}
			if _, err := f.s.VerificationKey(kid, time.UnixMilli(1000)); err == nil {
				t.Fatal("not blocked")
			}
		})
	}
	f := setup(t)
	good := f.envelope(f.body)
	for _, raw := range [][]byte{[]byte(strings.Replace(string(good), `"kid":"test-root"`, `"kid":"attacker"`, 1)), []byte(strings.Replace(string(good), `"schema":`, `"schema":"duplicate","schema":`, 1)), append(good, []byte(` {}`)...), []byte(`{"publicKey":"attacker"}`)} {
		if err := f.s.Accept(raw, time.UnixMilli(1000)); err == nil {
			t.Fatal("malformed accepted")
		}
	}
	var e Envelope
	_ = json.Unmarshal(good, &e)
	e.Body = strings.Replace(e.Body, "T-TEST", "other", 1)
	bad, _ := json.Marshal(e)
	if err := f.s.Accept(bad, time.UnixMilli(1000)); err == nil {
		t.Fatal("bad signature accepted")
	}
}
func TestNextKeyNeverAuthorizesAndPersistenceFailureBlocks(t *testing.T) {
	f := setup(t)
	f.body.Keys[0].Status = "next"
	if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(1000)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.VerificationKey(f.body.Keys[0].KID, time.UnixMilli(1000)); err == nil {
		t.Fatal("next authorized")
	}
	f.body.Keys[0].Status = "active"
	f.body.Revision++
	f.s.path = filepath.Join(f.path, "impossible")
	if err := f.s.Accept(f.envelope(f.body), time.UnixMilli(1000)); !errors.Is(err, ErrStorage) {
		t.Fatal(err)
	}
}
func TestFetchControlTokenBindingNoRedirectAndFailure(t *testing.T) {
	f := setup(t)
	redirect := false
	status := 200
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runtime/gateway-keyset" || r.URL.Query().Get("runtimeCode") != "test-runtime" || r.URL.Query().Get("gatewayDeployment") != "test-gateway" || r.Header.Get("Authorization") != "Bearer hzy_ctl_fixture" {
			t.Error("wrong trusted request")
		}
		if redirect {
			w.Header().Set("Location", "https://invalid.example/")
			w.WriteHeader(302)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write(f.envelope(f.body))
	}))
	defer server.Close()
	if err := f.s.Fetch(context.Background(), server.URL, "hzy_ctl_fixture", server.Client(), time.UnixMilli(1000)); err != nil {
		t.Fatal(err)
	}
	redirect = true
	if err := f.s.Fetch(context.Background(), server.URL, "hzy_ctl_fixture", server.Client(), time.UnixMilli(1000)); err == nil {
		t.Fatal("redirect accepted")
	}
	if _, err := f.s.VerificationKey(f.body.Keys[0].KID, time.UnixMilli(1000)); err == nil {
		t.Fatal("redirect not blocked")
	}
	redirect = false
	status = 401
	if err := f.s.Fetch(context.Background(), server.URL, "hzy_ctl_fixture", server.Client(), time.UnixMilli(1000)); err == nil {
		t.Fatal("401 accepted")
	}
	if err := f.s.Fetch(context.Background(), "http://127.0.0.1", "hzy_ctl_fixture", server.Client(), time.UnixMilli(1000)); err == nil {
		t.Fatal("plaintext accepted")
	}
}

func TestPlatformCanonicalSignedFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/platform-keyset.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		RootPublicKey string   `json:"rootPublicKey"`
		Envelope      Envelope `json:"envelope"`
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	s, err := New(Binding{"T-TEST", "test", "test-runtime", "test-gateway"}, "fixture-root", f.RootPublicKey, filepath.Join(t.TempDir(), "keys.json"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(f.Envelope)
	if err = s.Accept(raw, time.UnixMilli(1000)); err != nil {
		t.Fatal(err)
	}
	var b Body
	_ = json.Unmarshal([]byte(f.Envelope.Body), &b)
	if _, err = s.VerificationKey(b.Keys[0].KID, time.UnixMilli(1000)); err != nil {
		t.Fatal(err)
	}
}

func TestBadSignaturePersistsBlockAndRejectsDuplicateSignedFields(t *testing.T) {
	f := setup(t)
	now := time.UnixMilli(1000)
	if err := f.s.Accept(f.envelope(f.body), now); err != nil {
		t.Fatal(err)
	}
	var e Envelope
	_ = json.Unmarshal(f.envelope(f.body), &e)
	e.Body = strings.Replace(e.Body, `"revision":1`, `"revision":1,"revision":2`, 1)
	e.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(f.private, []byte(Schema+"\n"+e.Body)))
	raw, _ := json.Marshal(e)
	if err := f.s.Accept(raw, now); err == nil {
		t.Fatal("signed duplicate accepted")
	}
	raw, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	var disk diskState
	_ = json.Unmarshal(raw, &disk)
	if !disk.Blocked {
		t.Fatal("failure not persisted")
	}
	s, err := New(f.s.binding, "test-root", f.root, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.VerificationKey(f.body.Keys[0].KID, now); err == nil {
		t.Fatal("blocked cache restored")
	}
}
