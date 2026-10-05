package webdev

import (
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWebDevServiceIssuePathsAreNarrowlyShaped(t *testing.T) {
	if !isWebDevServiceIssueDetailPath("/v1/webdev/service/issues/ISS-1") {
		t.Fatal("single service Issue detail must be recognized")
	}
	if !isWebDevServiceIssueClaimPath("/v1/webdev/service/issues/ISS-1/claim") {
		t.Fatal("single service Issue claim must be recognized")
	}
	for _, path := range []string{
		"/v1/webdev/service/issues/",
		"/v1/webdev/service/issues/mine",
		"/v1/webdev/service/issues/settings",
		"/v1/webdev/service/issues/ISS-1/events",
		"/v1/webdev/service/issues/ISS-1/claim/extra",
	} {
		if isWebDevServiceIssueDetailPath(path) || isWebDevServiceIssueClaimPath(path) {
			t.Fatalf("unlisted service path %q was accepted", path)
		}
	}
}

func TestWebDevIssueTenantUsesOnlyRuntimeInjectedContext(t *testing.T) {
	query := url.Values{
		"tenant":                  []string{"forged-query-tenant"},
		"hzy_runtime_tenant_code": []string{"trusted-tenant"},
	}
	body := map[string]any{
		"tenant":                  "forged-body-tenant",
		"hzy_runtime_tenant_code": "other-trusted-value-must-not-win",
	}
	if got := trustedRuntimeTenant(query, body); got != "trusted-tenant" {
		t.Fatalf("trusted tenant=%q", got)
	}

	_, err := requireTrustedRuntimeTenant(url.Values{"tenant": []string{"forged"}}, map[string]any{"tenant": "forged"})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_webdev_tenant_required" {
		t.Fatalf("missing trusted tenant error=%T %v", err, err)
	}
}
