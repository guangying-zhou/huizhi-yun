package console

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

type serviceSigningIdentity struct {
	ClientCode, ClientName, ClientType, AppCode string
	Grants                                      []serviceScopeGrant
}

// The credential row owns every source identity claim. Check all assertions
// before writing any canonical values, so rejected requests cannot be rewritten.
func bindServiceSigningIdentity(claims, hzy map[string]any, identity serviceSigningIdentity) error {
	if identity.ClientCode == "" || identity.ClientType == "" {
		return httperror.New(http.StatusServiceUnavailable, "oidc_signing_service_identity_unavailable", "stored service identity is incomplete")
	}
	expectedClaims := map[string]string{"sub": "client:" + identity.ClientCode, "source_app": identity.AppCode}
	expectedHZY := map[string]string{"subjectCode": identity.ClientCode, "clientCode": identity.ClientCode, "clientName": identity.ClientName, "clientType": identity.ClientType, "appCode": identity.AppCode}
	for _, pair := range []struct {
		input    map[string]any
		expected map[string]string
	}{{claims, expectedClaims}, {hzy, expectedHZY}} {
		for key, expected := range pair.expected {
			if value, exists := pair.input[key]; exists {
				text, ok := value.(string)
				if !ok || text != expected {
					return httperror.New(http.StatusForbidden, "oidc_signing_service_identity_mismatch", "service identity does not match the authenticated credential")
				}
			}
		}
	}
	for key, value := range expectedClaims {
		claims[key] = value
	}
	for key, value := range expectedHZY {
		hzy[key] = value
	}
	return nil
}
