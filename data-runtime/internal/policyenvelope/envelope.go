// Package policyenvelope verifies Platform's complete policy envelope. It has no
// network/key-discovery access and never falls back to legacy HMAC envelopes.
package policyenvelope

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/url"
	"strings"
)

const Schema = "hzy-policy-envelope.v1"
const MaxBytes = 4 * 1024 * 1024
const MaxAgeMS int64 = 300000
const TestMaxAgeMS int64 = 93600000
const maxSafeInteger int64 = 9007199254740991

var ErrInvalid = errors.New("policy_envelope_invalid")

type Envelope struct {
	Schema    string `json:"schema"`
	Alg       string `json:"alg"`
	KID       string `json:"kid"`
	Body      string `json:"body"`
	Signature string `json:"signature"`
}
type Body struct {
	Purpose         string   `json:"purpose"`
	Issuer          string   `json:"issuer"`
	Tenant          string   `json:"tenant"`
	Environment     string   `json:"environment"`
	Deployments     []string `json:"deployments"`
	BundleVersion   string   `json:"bundleVersion"`
	PolicyRevision  int64    `json:"policyRevision"`
	Status          string   `json:"status"`
	IssuedAt        int64    `json:"issuedAt"`
	ExpiresAt       int64    `json:"expiresAt"`
	PolicyExpiresAt *int64   `json:"policyExpiresAt"`
	PayloadHash     string   `json:"payloadHash"`
	Payload         string   `json:"payload"`
	// Optional; Platform omits it when no Console key is registered.
	ServiceKeys []ServiceKey `json:"serviceKeys,omitempty"`
}

// ServiceKey is a Console deployment's Ed25519 public key (raw, base64url)
// signed into the envelope. Runtime accepts Console service assertions signed
// by it only while the envelope is valid or in outage grace.
type ServiceKey struct {
	Deployment string `json:"deployment"`
	KID        string `json:"kid"`
	PublicKey  string `json:"publicKey"`
	NotAfter   int64  `json:"notAfter"`
}

const MaxServiceKeys = 4

// ServiceKeyID derives the key id from the key bytes, so a kid cannot be
// claimed for a different key.
func ServiceKeyID(publicKey []byte) string {
	digest := sha256.Sum256(publicKey)
	return "csk_" + hex.EncodeToString(digest[:])[:16]
}

// Public returns the decoded key when the entry is well formed.
func (k ServiceKey) Public() (ed25519.PublicKey, bool) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(k.PublicKey)
	if err != nil || len(raw) != ed25519.PublicKeySize || ServiceKeyID(raw) != k.KID {
		return nil, false
	}
	return ed25519.PublicKey(raw), true
}

type Context struct {
	Issuer, Tenant, Environment, Deployment string
	Now, MaxAgeMS                           int64
	// Storage may accept a signed revocation; authorization consumers may not.
	AllowInactive bool
}

func strict(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return ErrInvalid
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return ErrInvalid
	}
	return nil
}
func text(value string) bool {
	return value != "" && len(value) <= 191 && !strings.ContainsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_.:-", r))
	})
}

func Verify(raw []byte, kid, publicKeyPEM string, context Context) (Body, error) {
	var envelope Envelope
	var body Body
	if len(raw) > MaxBytes*2+1024 || strict(raw, &envelope) != nil || envelope.Schema != Schema || envelope.Alg != "Ed25519" || !text(envelope.KID) || envelope.KID != kid || len(envelope.Body) > MaxBytes {
		return body, ErrInvalid
	}
	block, rest := pem.Decode([]byte(publicKeyPEM))
	if block == nil || len(bytes.TrimSpace(rest)) != 0 {
		return body, ErrInvalid
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	public, ok := key.(ed25519.PublicKey)
	if err != nil || !ok {
		return body, ErrInvalid
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(envelope.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(public, []byte(Schema+"\n"+envelope.Body), signature) {
		return body, ErrInvalid
	}
	if strict([]byte(envelope.Body), &body) != nil {
		return Body{}, ErrInvalid
	}
	// Required nullable field must be present (a missing pointer also decodes nil).
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(envelope.Body), &fields) != nil {
		return Body{}, ErrInvalid
	}
	expected := 13
	if _, ok := fields["serviceKeys"]; ok {
		// Present means non-empty; an absent list is expressed by omission.
		if len(body.ServiceKeys) == 0 {
			return Body{}, ErrInvalid
		}
		expected = 14
	}
	if len(fields) != expected {
		return Body{}, ErrInvalid
	}
	if _, ok := fields["policyExpiresAt"]; !ok {
		return Body{}, ErrInvalid
	}
	if err := Validate(body, context); err != nil {
		return Body{}, err
	}
	return body, nil
}

func Validate(body Body, context Context) error {
	issuer, err := url.Parse(context.Issuer)
	if err != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.Path != "" || issuer.RawQuery != "" || issuer.Fragment != "" {
		return ErrInvalid
	}
	if !text(context.Tenant) || !text(context.Deployment) || context.Now < 0 || context.Now > maxSafeInteger || body.Purpose != "enterprise-policy" || body.Issuer != context.Issuer || body.Tenant != context.Tenant || body.Environment != context.Environment || (body.Environment != "prod" && body.Environment != "test" && body.Environment != "dev") || !text(body.BundleVersion) || body.PolicyRevision < 1 || body.PolicyRevision > maxSafeInteger {
		return ErrInvalid
	}
	if body.Status != "active" && body.Status != "suspended" && body.Status != "revoked" {
		return ErrInvalid
	}
	if !context.AllowInactive && body.Status != "active" {
		return ErrInvalid
	}
	age, limit := context.MaxAgeMS, MaxAgeMS
	if age == 0 {
		age = MaxAgeMS
	}
	if context.Environment == "test" {
		limit = TestMaxAgeMS
	}
	if age < 1000 || age > limit || body.IssuedAt < 0 || body.IssuedAt > context.Now || body.ExpiresAt > maxSafeInteger || body.ExpiresAt <= context.Now || body.ExpiresAt <= body.IssuedAt || body.ExpiresAt-body.IssuedAt > age {
		return ErrInvalid
	}
	if body.PolicyExpiresAt != nil && (*body.PolicyExpiresAt > maxSafeInteger || *body.PolicyExpiresAt <= context.Now || body.ExpiresAt > *body.PolicyExpiresAt) {
		return ErrInvalid
	}
	seen, found := map[string]bool{}, false
	if len(body.Deployments) == 0 || len(body.Deployments) > 256 {
		return ErrInvalid
	}
	for _, deployment := range body.Deployments {
		if !text(deployment) || seen[deployment] {
			return ErrInvalid
		}
		seen[deployment] = true
		found = found || deployment == context.Deployment
	}
	if !found || len(body.Payload) > MaxBytes {
		return ErrInvalid
	}
	if len(body.ServiceKeys) > MaxServiceKeys {
		return ErrInvalid
	}
	kids := map[string]bool{}
	for _, key := range body.ServiceKeys {
		if _, ok := key.Public(); !ok || !seen[key.Deployment] || kids[key.KID] || key.NotAfter <= body.IssuedAt || key.NotAfter > maxSafeInteger {
			return ErrInvalid
		}
		kids[key.KID] = true
	}
	hash := sha256.Sum256([]byte(body.Payload))
	if body.PayloadHash != "sha256_"+hex.EncodeToString(hash[:]) {
		return ErrInvalid
	}
	var payload struct {
		Tenant struct {
			TenantCode string `json:"tenantCode"`
		} `json:"tenant"`
		Environment    string `json:"environment"`
		PolicyRevision int64  `json:"policyRevision"`
		Deployments    []struct {
			Code        string `json:"deploymentCode"`
			Environment string `json:"environment"`
			Status      string `json:"status"`
		} `json:"deployments"`
	}
	if json.Unmarshal([]byte(body.Payload), &payload) != nil || payload.Tenant.TenantCode != body.Tenant || payload.Environment != body.Environment || payload.PolicyRevision != body.PolicyRevision {
		return ErrInvalid
	}
	for _, deployment := range body.Deployments {
		match := false
		for _, item := range payload.Deployments {
			if item.Code == deployment && item.Environment == body.Environment && item.Status == "active" {
				match = true
			}
		}
		if !match {
			return ErrInvalid
		}
	}
	return nil
}
