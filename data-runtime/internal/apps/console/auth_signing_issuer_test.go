package console

import (
	"context"
	"net/http"
	"testing"
)

func TestOIDCSigningIssuerRejectsMismatchAndMissingTrustBeforeAnyDatabaseWork(t *testing.T) {
	paths := map[string]func(*Adapter, string) error{
		"generic sign": func(a *Adapter, issuer string) error {
			body := userSigningBody(testSigningSID, "user:u1001", "u1001")
			body["claims"].(map[string]any)["iss"] = issuer
			_, err := a.SignOIDCToken(context.Background(), body, AuditMutationMeta{})
			return err
		},
		"Console issue": func(a *Adapter, issuer string) error {
			_, err := a.IssueConsoleRuntimeServiceToken(context.Background(), map[string]any{
				"audience": "data-runtime", "scope": "console:auth-oidc:read", "ttlSeconds": 300, "issuer": issuer,
			}, "test-console", AuditMutationMeta{})
			return err
		},
		"Gateway exchange": func(a *Adapter, issuer string) error {
			body := gatewayBody()
			body["issuer"] = issuer
			_, err := a.ExchangeGatewayServiceToken(context.Background(), body, gatewayClaims(), "C000001", "test-console", AuditMutationMeta{})
			return err
		},
		"credential exchange": func(a *Adapter, issuer string) error {
			body := exchangeTestBody()
			body["issuer"] = issuer
			_, err := a.ExchangeConsoleServiceClientToken(context.Background(), body, "C000001", "test-console", AuditMutationMeta{})
			return err
		},
	}
	for name, issue := range paths {
		t.Run(name, func(t *testing.T) {
			// Nil DB proves all failures happen before identity/key/replay/audit effects.
			a := &Adapter{tenant: "C000001"}
			assertHTTPErrorCode(t, issue(a, "https://caller.test"), http.StatusServiceUnavailable, "oidc_signing_issuer_unavailable")
			a.SetOIDCSigningIssuerSource(func() string { return "https://trusted.test" })
			assertHTTPErrorCode(t, issue(a, "https://caller.test"), http.StatusForbidden, "oidc_signing_issuer_mismatch")
		})
	}
}

func TestOIDCSigningIssuerUsesLiveRuntimeTrustWithoutRequestFallback(t *testing.T) {
	a := &Adapter{}
	trusted := "https://old.test"
	a.SetOIDCSigningIssuerSource(func() string { return trusted })
	if got, err := a.resolveOIDCSigningIssuer(trusted); err != nil || got != trusted {
		t.Fatalf("issuer=%q err=%v", got, err)
	}
	trusted = "https://accepted-bootstrap.test"
	assertHTTPErrorCode(t, func() error { _, err := a.resolveOIDCSigningIssuer("https://old.test"); return err }(), http.StatusForbidden, "oidc_signing_issuer_mismatch")
	if got, err := a.resolveOIDCSigningIssuer(trusted); err != nil || got != trusted {
		t.Fatalf("issuer did not follow Runtime trust: %q %v", got, err)
	}
	for _, invalid := range []string{"", "not-a-url", "https://user:password@trusted.test", "https://trusted.test?query=1", "https://trusted.test#fragment", " https://trusted.test"} {
		trusted = invalid
		_, err := a.resolveOIDCSigningIssuer("https://caller.test")
		assertHTTPErrorCode(t, err, http.StatusServiceUnavailable, "oidc_signing_issuer_unavailable")
	}
	a.SetOIDCSigningIssuerSource(nil)
	_, err := a.resolveOIDCSigningIssuer("https://caller.test")
	assertHTTPErrorCode(t, err, http.StatusServiceUnavailable, "oidc_signing_issuer_unavailable")
}
