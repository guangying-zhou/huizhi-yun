package policyenvelope

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"testing"
)

func platformFixture(t *testing.T) (Envelope, string, Context) {
	t.Helper()
	raw, err := os.ReadFile("testdata/platform-envelope.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PublicKey string   `json:"publicKey"`
		Envelope  Envelope `json:"envelope"`
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("fixture")
	}
	return fixture.Envelope, fixture.PublicKey, Context{Issuer: "https://platform.example", Tenant: "tenant-1", Environment: "test", Deployment: "console-test", Now: 1000000}
}
func encoded(t *testing.T, envelope Envelope) []byte {
	t.Helper()
	value, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestPlatformNodeEnvelopeInteroperability(t *testing.T) {
	envelope, publicKey, context := platformFixture(t)
	for _, deployment := range []string{"console-test", "enterprise-test"} {
		context.Deployment = deployment
		body, err := Verify(encoded(t, envelope), envelope.KID, publicKey, context)
		if err != nil || body.BundleVersion != "pv_test_12" || body.PolicyRevision != 12 {
			t.Fatalf("body=%v error=%v", body, err)
		}
	}
}

func TestRejectTamperingAndBindings(t *testing.T) {
	original, publicKey, context := platformFixture(t)
	for _, field := range []string{"bundleVersion", "status", "expiresAt", "issuedAt", "policyExpiresAt", "tenant", "environment", "deployments", "policyRevision", "issuer", "purpose", "payload"} {
		t.Run(field, func(t *testing.T) {
			envelope := original
			var body map[string]any
			_ = json.Unmarshal([]byte(envelope.Body), &body)
			body[field] = "tampered"
			modified, _ := json.Marshal(body)
			envelope.Body = string(modified)
			if _, err := Verify(encoded(t, envelope), envelope.KID, publicKey, context); err == nil {
				t.Fatal("tamper accepted")
			}
		})
	}
	for _, change := range []func(*Context){
		func(c *Context) { c.Tenant = "other" }, func(c *Context) { c.Environment = "prod" }, func(c *Context) { c.Deployment = "other" },
		func(c *Context) { c.Issuer = "https://other.example" }, func(c *Context) { c.Now = 999999 }, func(c *Context) { c.Now = 1300000 }, func(c *Context) { c.MaxAgeMS = 999 },
	} {
		c := context
		change(&c)
		if _, err := Verify(encoded(t, original), original.KID, publicKey, c); err == nil {
			t.Fatal("context accepted")
		}
	}
	for _, change := range []func(*Envelope){func(e *Envelope) { e.Alg = "HS256" }, func(e *Envelope) { e.Schema = "legacy" }, func(e *Envelope) { e.KID = "unknown" }} {
		e := original
		change(&e)
		if _, err := Verify(encoded(t, e), original.KID, publicKey, context); err == nil {
			t.Fatal("header accepted")
		}
	}
	if _, err := Verify([]byte(`{"body":"legacy","mac":"unused"}`), original.KID, publicKey, context); err == nil {
		t.Fatal("legacy accepted")
	}
}

func TestValidSignatureStillRequiresSemantics(t *testing.T) {
	original, _, context := platformFixture(t)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(public)
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	signed := func(change func(map[string]any)) Envelope {
		e := original
		var body map[string]any
		_ = json.Unmarshal([]byte(e.Body), &body)
		change(body)
		raw, _ := json.Marshal(body)
		e.Body = string(raw)
		e.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+e.Body)))
		return e
	}
	for _, change := range []func(map[string]any){
		func(b map[string]any) { b["policyRevision"] = 99 }, func(b map[string]any) { b["deployments"] = []string{"other"} },
		func(b map[string]any) { b["payloadHash"] = "wrong" }, func(b map[string]any) { delete(b, "policyExpiresAt") },
		func(b map[string]any) { b["unknown"] = true }, func(b map[string]any) { b["expiresAt"] = 1300001 },
		func(b map[string]any) { b["policyExpiresAt"] = 1000001 },
	} {
		e := signed(change)
		if _, err := Verify(encoded(t, e), e.KID, key, context); err == nil {
			t.Fatal("semantics accepted")
		}
	}
	e := signed(func(b map[string]any) { b["status"] = "revoked" })
	if _, err := Verify(encoded(t, e), e.KID, key, context); err == nil {
		t.Fatal("revocation authorized")
	}
	context.AllowInactive = true
	if body, err := Verify(encoded(t, e), e.KID, key, context); err != nil || body.Status != "revoked" {
		t.Fatal("revocation cannot be persisted", err)
	}
}

func TestServiceKeyVectors(t *testing.T) {
	original, _, context := platformFixture(t)
	raw, err := os.ReadFile("testdata/service-key-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Cases []struct {
			Name        string          `json:"name"`
			ServiceKeys json.RawMessage `json:"serviceKeys"`
			Valid       bool            `json:"valid"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil || len(vectors.Cases) == 0 {
		t.Fatal("vectors", err)
	}
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	for _, c := range vectors.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var body map[string]json.RawMessage
			_ = json.Unmarshal([]byte(original.Body), &body)
			body["serviceKeys"] = c.ServiceKeys
			encodedBody, _ := json.Marshal(body)
			e := original
			e.Body = string(encodedBody)
			e.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+e.Body)))
			verified, err := Verify(encoded(t, e), e.KID, key, context)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v err=%v", c.Valid, err)
			}
			if c.Valid {
				if _, ok := verified.ServiceKeys[0].Public(); !ok {
					t.Fatal("accepted key does not decode")
				}
			}
		})
	}
	var nullKeys map[string]json.RawMessage
	_ = json.Unmarshal([]byte(original.Body), &nullKeys)
	nullKeys["serviceKeys"] = json.RawMessage("null")
	encodedBody, _ := json.Marshal(nullKeys)
	e := original
	e.Body = string(encodedBody)
	e.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+e.Body)))
	if _, err := Verify(encoded(t, e), e.KID, key, context); err == nil {
		t.Fatal("null serviceKeys accepted")
	}
}
