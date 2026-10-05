package console

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The server injects its authenticator's live issuer. Request claims and Console
// config do not establish signing authority, even for an authenticated workload.
func (a *Adapter) SetOIDCSigningIssuerSource(source func() string) {
	a.oidcSigningIssuerMu.Lock()
	defer a.oidcSigningIssuerMu.Unlock()
	a.oidcSigningIssuerSource = source
}

func (a *Adapter) resolveOIDCSigningIssuer(requested any) (string, error) {
	a.oidcSigningIssuerMu.RLock()
	source := a.oidcSigningIssuerSource
	a.oidcSigningIssuerMu.RUnlock()
	trusted := ""
	if source != nil {
		trusted = source()
	}
	parsed, err := url.Parse(trusted)
	if err != nil || trusted == "" || trusted != strings.TrimSpace(trusted) ||
		parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", httperror.New(http.StatusServiceUnavailable, "oidc_signing_issuer_unavailable", "Runtime signing issuer is unavailable")
	}
	issuer, err := requiredAuthString(requested, "issuer", 1000)
	if err != nil {
		return "", err
	}
	if issuer != trusted {
		return "", httperror.New(http.StatusForbidden, "oidc_signing_issuer_mismatch", "Requested issuer differs from Runtime trust")
	}
	return trusted, nil
}
