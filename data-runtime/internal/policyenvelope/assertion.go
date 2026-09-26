package policyenvelope

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
)

// Console steady service identity (R1). A Console deployment signs a short
// assertion with the key Platform signed into its policy envelope. Runtime
// accepts it for console:service-token:issue only while that envelope is valid
// or in outage grace, so key lifetime never outlives the policy it came from.
const (
	AssertionType     = "hzy-console-assertion+jwt"
	AssertionAudience = "hzy-runtime-service-token-issue"
	AssertionUse      = "console_service_assertion"
	AssertionScope    = "console:service-token:issue"
	AssertionMaxAgeMS = int64(60_000)
	assertionSkewMS   = int64(10_000)
)

var (
	ErrAssertionInvalid = errors.New("console_assertion_invalid")
	// ErrAssertionPolicy: authentic key material, but the envelope that
	// authorizes it is no longer valid or in grace.
	ErrAssertionPolicy = errors.New("console_assertion_policy_inactive")
	assertionJTI       = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
)

type AssertionBinding struct {
	Tenant, Deployment string
}

type AssertionClaims struct {
	Issuer     string `json:"iss"`
	Subject    string `json:"sub"`
	Audience   string `json:"aud"`
	TokenUse   string `json:"token_use"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Scope      string `json:"scope"`
	IssuedAt   int64  `json:"iat"`
	ExpiresAt  int64  `json:"exp"`
	ID         string `json:"jti"`
}

type assertionHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	KID string `json:"kid"`
}

func segment(value string, target any) ([]byte, error) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || (target != nil && strict(raw, target) != nil) {
		return nil, ErrAssertionInvalid
	}
	return raw, nil
}

// IsConsoleAssertion only routes a bearer token to this verifier; it is not a
// verification result.
func IsConsoleAssertion(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	var header assertionHeader
	_, err := segment(parts[0], &header)
	return err == nil && header.Typ == AssertionType
}

// VerifyConsoleAssertion checks the assertion against an already authenticated
// snapshot body and its Runtime renewal state. nowMS is Runtime time.
func VerifyConsoleAssertion(token string, body Body, renewal *Renewal, binding AssertionBinding, nowMS int64) (AssertionClaims, Validity, error) {
	var claims AssertionClaims
	parts := strings.Split(token, ".")
	if len(token) > 2048 || len(parts) != 3 {
		return claims, Validity{}, ErrAssertionInvalid
	}
	var header assertionHeader
	if _, err := segment(parts[0], &header); err != nil || header.Alg != "EdDSA" || header.Typ != AssertionType {
		return claims, Validity{}, ErrAssertionInvalid
	}
	if _, err := segment(parts[1], &claims); err != nil {
		return AssertionClaims{}, Validity{}, ErrAssertionInvalid
	}
	signature, err := segment(parts[2], nil)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return AssertionClaims{}, Validity{}, ErrAssertionInvalid
	}
	var key *ServiceKey
	for index := range body.ServiceKeys {
		if body.ServiceKeys[index].KID == header.KID && body.ServiceKeys[index].Deployment == binding.Deployment {
			key = &body.ServiceKeys[index]
		}
	}
	if key == nil {
		return AssertionClaims{}, Validity{}, ErrAssertionInvalid
	}
	public, ok := key.Public()
	if !ok || !ed25519.Verify(public, []byte(parts[0]+"."+parts[1]), signature) {
		return AssertionClaims{}, Validity{}, ErrAssertionInvalid
	}
	subject := "console:" + binding.Deployment
	issuedAt, expiresAt := claims.IssuedAt*1000, claims.ExpiresAt*1000
	if claims.Issuer != subject || claims.Subject != subject || claims.Audience != AssertionAudience ||
		claims.TokenUse != AssertionUse || claims.Scope != AssertionScope ||
		claims.Tenant != binding.Tenant || claims.Deployment != binding.Deployment || body.Tenant != binding.Tenant ||
		!assertionJTI.MatchString(claims.ID) || claims.IssuedAt <= 0 || claims.ExpiresAt > maxSafeInteger/1000 ||
		expiresAt <= issuedAt || expiresAt-issuedAt > AssertionMaxAgeMS ||
		issuedAt > nowMS+assertionSkewMS || expiresAt <= nowMS {
		return AssertionClaims{}, Validity{}, ErrAssertionInvalid
	}
	validity := EvaluateValidity(body, renewal, nowMS)
	if (validity.Verdict != "valid" && validity.Verdict != "grace") || key.NotAfter <= nowMS {
		return AssertionClaims{}, validity, ErrAssertionPolicy
	}
	return claims, validity, nil
}
