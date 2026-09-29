package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The audience is an enrolled, active auth client, not a signing caller's
// invented application. SSO sessions deliberately do not bind to one client.
func (a *Adapter) authorizeUserSigningClient(ctx context.Context, claims map[string]any) error {
	audience, ok := claims["aud"].(string)
	if !ok || audience == "" {
		return httperror.New(http.StatusForbidden, "oidc_signing_user_client_not_active", "User token audience is not an active auth client")
	}
	if azp, present := claims["azp"]; present {
		value, ok := azp.(string)
		if !ok || value != audience {
			return httperror.New(http.StatusForbidden, "oidc_signing_user_azp_mismatch", "User token azp must equal audience")
		}
	}
	var registered string
	err := a.db.QueryRowContext(ctx, `
  SELECT client_id FROM auth_clients
  WHERE client_id=? AND status='active'
  LIMIT 1
 `, audience).Scan(&registered)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && registered != audience) {
		return httperror.New(http.StatusForbidden, "oidc_signing_user_client_not_active", "User token audience is not an active auth client")
	}
	return err
}
