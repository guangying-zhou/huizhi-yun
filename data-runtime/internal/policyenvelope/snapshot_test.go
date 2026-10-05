package policyenvelope

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"testing"
)

func TestPreparePreservesReplayFreshnessAndDurableWatermark(t *testing.T) {
	fixture, _, context := platformFixture(t)
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	candidate := func(revision, issued int64, version string) Envelope {
		var body Body
		_ = json.Unmarshal([]byte(fixture.Body), &body)
		body.PolicyRevision = revision
		body.IssuedAt = issued
		body.ExpiresAt = issued + MaxAgeMS
		body.BundleVersion = version
		var payload map[string]any
		_ = json.Unmarshal([]byte(body.Payload), &payload)
		payload["policyRevision"] = revision
		raw, _ := json.Marshal(payload)
		body.Payload = string(raw)
		hash := sha256.Sum256(raw)
		body.PayloadHash = "sha256_" + hex.EncodeToString(hash[:])
		raw, _ = json.Marshal(body)
		envelope := fixture
		envelope.Body = string(raw)
		envelope.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+envelope.Body)))
		return envelope
	}
	first := candidate(12, context.Now, "pv_test_12")
	stored, err := Prepare(first, nil, first.KID, key, context)
	if err != nil {
		t.Fatal(err)
	}
	context.Now += 1000
	wrongScope := stored
	wrongScope.Tenant = "other"
	if _, err := Prepare(first, &wrongScope, first.KID, key, context); err == nil {
		t.Fatal("cross-tenant watermark accepted")
	}
	replay, err := Prepare(first, &stored, first.KID, key, context)
	if err != nil || replay.AcceptedAt != stored.AcceptedAt || replay.ETag != stored.ETag {
		t.Fatal("replay renewed freshness", err)
	}
	// Simulate a new reader after process restart: only the persisted watermark remains.
	newer := candidate(13, context.Now, "pv_test_13")
	advanced, err := Prepare(newer, &stored, newer.KID, key, context)
	if err != nil {
		t.Fatal(err)
	}
	context.Now += MaxAgeMS + 1
	rollback := candidate(12, context.Now, "pv_test_12")
	if _, err := Prepare(rollback, &advanced, rollback.KID, key, context); err == nil {
		t.Fatal("expired durable watermark lost")
	}
	// Same revision with a changed payload cannot overwrite an accepted fact set.
	conflict := candidate(13, context.Now, "pv_test_13")
	var body Body
	_ = json.Unmarshal([]byte(conflict.Body), &body)
	body.Payload = body.Payload + " " // Different exact signed payload is deliberately conservative.
	hash := sha256.Sum256([]byte(body.Payload))
	body.PayloadHash = "sha256_" + hex.EncodeToString(hash[:])
	raw, _ := json.Marshal(body)
	conflict.Body = string(raw)
	conflict.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+conflict.Body)))
	if _, err := Prepare(conflict, &advanced, conflict.KID, key, context); err == nil {
		t.Fatal("same revision conflict accepted")
	}
	refreshed := candidate(13, context.Now, "pv_test_13")
	for _, field := range []string{"bundleVersion", "deployments", "policyExpiresAt"} {
		t.Run("same revision "+field, func(t *testing.T) {
			var value map[string]any
			_ = json.Unmarshal([]byte(refreshed.Body), &value)
			switch field {
			case "bundleVersion":
				value[field] = "changed_version"
			case "deployments":
				value[field] = []string{context.Deployment}
			case "policyExpiresAt":
				value[field] = context.Now + MaxAgeMS
			}
			raw, _ := json.Marshal(value)
			changed := refreshed
			changed.Body = string(raw)
			changed.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+changed.Body)))
			if _, err := Prepare(changed, &advanced, changed.KID, key, context); err == nil {
				t.Fatal("same revision metadata replaced")
			}
		})
	}
	if next, err := Prepare(refreshed, &advanced, refreshed.KID, key, context); err != nil || next.AcceptedAt != context.Now {
		t.Fatal("fresh authentic revalidation failed", err)
	}
	// Signed tenant lifecycle changes the current revision's status in both
	// directions, strictly ordered by IssuedAt; policy facts stay pinned.
	withStatus := func(issued int64, status string) Envelope {
		envelope := candidate(13, issued, "pv_test_13")
		var value map[string]any
		_ = json.Unmarshal([]byte(envelope.Body), &value)
		value["status"] = status
		raw, _ := json.Marshal(value)
		envelope.Body = string(raw)
		envelope.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(Schema+"\n"+envelope.Body)))
		return envelope
	}
	suspended, err := Prepare(withStatus(context.Now, "suspended"), &advanced, first.KID, key, context)
	if err != nil {
		t.Fatal("signed suspension of the current revision rejected", err)
	}
	if _, err := Prepare(withStatus(context.Now, "active"), &suspended, first.KID, key, context); err == nil {
		t.Fatal("reactivation without a newer IssuedAt accepted")
	}
	context.Now += 1000
	if _, err := Prepare(withStatus(context.Now, "active"), &suspended, first.KID, key, context); err != nil {
		t.Fatal("signed reactivation rejected", err)
	}
}
