package server

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The legacy HTTP transport retains assets.write; it must still prove the live
// Assets service identity before entering the unified owning-domain transaction.
func verifyLegacyUnifiedAssetsCredential(ctx context.Context, identity auth.Context, tenant, deployment string, verify enterpriseCredentialVerifier) error {
	if tenant == "" || deployment == "" || verify == nil {
		return httperror.New(503, "assets_identity_unavailable", "Assets service binding unavailable")
	}
	if identity.Mode != "jwt" || identity.Tenant != tenant || identity.Deployment != deployment || identity.AppCode != "assets" || identity.ClientID != "assets.runtime" || identity.Subject != "client:assets.runtime" || identity.CredentialID <= 0 {
		return httperror.New(403, "assets_identity_mismatch", "Assets service identity does not match its binding")
	}
	exact := false
	for _, scope := range identity.Scopes {
		if scope == "assets.write" {
			exact = true
			break
		}
	}
	if !exact {
		return httperror.New(403, "assets_exact_scope_required", "Exact Assets write scope required")
	}
	// Console grants join resource/action with a colon; the legacy JWT spelling remains exact above.
	active, err := verify(ctx, identity, "assets:write")
	if err != nil {
		return httperror.New(503, "assets_credential_state_unavailable", "Assets credential state unavailable")
	}
	if !active {
		return httperror.New(403, "assets_credential_inactive", "Assets credential or grant has been revoked")
	}
	return nil
}
