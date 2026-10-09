package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// OrgBrand reads only public tenant branding, never the administration profile.
func (a *Adapter) OrgBrand(ctx context.Context) (map[string]string, error) {
	var tenant, name string
	var short, display sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT tenant_code,org_name,org_short_name,display_name FROM org_profiles WHERE singleton_key=1 LIMIT 1`).Scan(&tenant, &name, &short, &display)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_profile_unavailable", "Console tenant profile is not initialized")
	}
	if err != nil {
		return nil, err
	}
	if a.tenant == "" || tenant != a.tenant {
		return nil, httperror.New(http.StatusForbidden, "console_tenant_binding_mismatch", "Console database tenant does not match this runtime")
	}
	first := func(values ...string) string {
		for _, value := range values {
			if v := strings.TrimSpace(value); v != "" {
				return v
			}
		}
		return ""
	}
	return map[string]string{"shortName": first(short.String, display.String, name), "displayName": first(display.String, name)}, nil
}
