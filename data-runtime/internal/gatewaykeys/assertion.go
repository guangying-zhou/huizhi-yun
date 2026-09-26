package gatewaykeys

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"
)

const ExchangePath = "/v1/console/auth/service-tokens/gateway-exchange"
const AssertionType = "hzy-gateway-service-assertion+jwt"

var ErrAssertion = errors.New("gateway_assertion_invalid")
var ErrKey = errors.New("gateway_assertion_key_invalid")
var jtiPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22,64}$`)

type Assertion struct {
	Issuer            string `json:"iss"`
	Subject           string `json:"sub"`
	Audience          string `json:"aud"`
	Tenant            string `json:"tenant"`
	Environment       string `json:"environment"`
	GatewayDeployment string `json:"gateway_deployment"`
	RuntimeCode       string `json:"runtime_code"`
	AppCode           string `json:"source_app"`
	Deployment        string `json:"source_deployment"`
	OAuthAudience     string `json:"oauth_audience"`
	Scope             string `json:"scope"`
	ClientID          string `json:"client_id"`
	SourceBinding     string `json:"source_binding"`
	Method            string `json:"method"`
	Path              string `json:"path"`
	IssuedAt          int64  `json:"iat"`
	NotBefore         int64  `json:"nbf"`
	ExpiresAt         int64  `json:"exp"`
	JTI               string `json:"jti"`
	KID               string `json:"-"`
}

func CanonicalScope(value string) string {
	fields := strings.Fields(value)
	sort.Strings(fields)
	out := make([]string, 0, len(fields))
	for _, v := range fields {
		if len(out) == 0 || out[len(out)-1] != v {
			out = append(out, v)
		}
	}
	return strings.Join(out, " ")
}

// WithAssertion holds the validated keyset across the issuing transaction, so a
// loaded revocation cannot race with its commit. It never accepts Console's
// opinion of the Gateway signature. The callback receives verified claims only.
func (s *Store) WithAssertion(raw string, now time.Time, fn func(Assertion) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.failure != nil {
		return s.failure
	}
	if !s.ready || now.UnixMilli() < s.body.IssuedAt-30000 || now.UnixMilli() >= s.body.ExpiresAt {
		return ErrUnavailable
	}
	if len(raw) > 16384 {
		return ErrAssertion
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return ErrAssertion
	}
	decoded := make([][]byte, 3)
	for i, v := range parts {
		b, err := base64.RawURLEncoding.DecodeString(v)
		if err != nil || base64.RawURLEncoding.EncodeToString(b) != v {
			return ErrAssertion
		}
		decoded[i] = b
	}
	var header struct {
		Alg  string `json:"alg"`
		Type string `json:"typ"`
		KID  string `json:"kid"`
	}
	if strictJSON(decoded[0], &header) != nil || header.Alg != "EdDSA" || header.Type != AssertionType || !kidPattern.MatchString(header.KID) {
		return ErrAssertion
	}
	var key ed25519.PublicKey
	for _, k := range s.body.Keys {
		if k.KID == header.KID && k.Status == "active" && now.UnixMilli() >= k.NotBefore && now.UnixMilli() < k.NotAfter {
			b, _ := base64.RawURLEncoding.DecodeString(k.PublicKey)
			key = ed25519.PublicKey(b)
		}
	}
	if key == nil {
		return ErrKey
	}
	if !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), decoded[2]) {
		return ErrAssertion
	}
	var a Assertion
	if strictJSON(decoded[1], &a) != nil {
		return ErrAssertion
	}
	a.KID = header.KID
	if a.Issuer != "gateway:"+s.binding.GatewayDeployment || a.Subject != a.Issuer || a.Audience != ExchangePath || a.Method != "POST" || a.Path != ExchangePath || a.SourceBinding != "trusted-gateway" || a.Tenant != s.binding.Tenant || a.Environment != s.binding.Environment || a.GatewayDeployment != s.binding.GatewayDeployment || a.RuntimeCode != s.binding.RuntimeCode {
		return ErrAssertion
	}
	for _, v := range []string{a.AppCode, a.Deployment, a.ClientID, a.OAuthAudience} {
		if !idPattern.MatchString(v) || len(v) > 191 {
			return ErrAssertion
		}
	}
	if len(a.AppCode) > 64 || len(a.Deployment) > 128 || len(a.ClientID) > 128 || a.AppCode != strings.ToLower(a.AppCode) || len(a.Scope) == 0 || len(a.Scope) > 4096 || a.Scope != CanonicalScope(a.Scope) || !jtiPattern.MatchString(a.JTI) {
		return ErrAssertion
	}
	jti, err := base64.RawURLEncoding.DecodeString(a.JTI)
	if err != nil || len(jti) < 16 || base64.RawURLEncoding.EncodeToString(jti) != a.JTI {
		return ErrAssertion
	}
	sec := now.Unix()
	if a.IssuedAt <= 0 || a.NotBefore != a.IssuedAt || a.ExpiresAt <= a.IssuedAt || a.ExpiresAt-a.IssuedAt > 60 || a.IssuedAt > sec+30 || a.ExpiresAt <= sec-30 {
		return ErrAssertion
	}
	return fn(a)
}

// MarshalAssertion is intentionally absent: signing belongs to the Gateway,
// whose private key never reaches Runtime or Console.

// DecodeExchangeBody also rejects duplicate members in the unsigned transport
// object; the signed assertion remains the only source of Gateway identity.
func DecodeExchangeBody(raw []byte) (map[string]any, error) {
	var body map[string]any
	if strictJSON(raw, &body) != nil || body == nil {
		return nil, ErrAssertion
	}
	allowed := map[string]bool{"assertion": true, "audience": true, "scope": true, "clientId": true, "issuer": true, "ttlSeconds": true, "policyVersion": true, "caps": true}
	for key := range body {
		if !allowed[key] {
			return nil, ErrAssertion
		}
	}
	return body, nil
}
