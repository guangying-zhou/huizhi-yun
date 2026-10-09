package console

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type serviceScopeGrant struct {
	scope     string
	scopeJSON sql.NullString
}
type legacyServiceAudience struct{ client, audience, scope, prefix string }

// The approved C000001 audience-facts migration has completed. Keep the
// compatibility structure empty: missing/NULL audience never authorizes a
// service scope. Other environments must register their own grant facts before
// adopting this version; no implicit legacy fallback may be reintroduced.
var legacyServiceAudiences = []legacyServiceAudience{}

func legacyServiceAudienceAllows(client, audience, scope string) bool {
	for _, entry := range legacyServiceAudiences {
		if entry.client == client && entry.audience == audience &&
			(entry.scope == scope || (entry.prefix != "" && strings.HasPrefix(scope, entry.prefix))) {
			return true
		}
	}
	return false
}

// All signing lanes use this mapping. A registered audience always wins over
// physical scope prefixes and compatibility; malformed policy fails closed.
func mapServiceAudienceScopes(client, audience string, requested []string, grants []serviceScopeGrant) (map[string]bool, error) {
	if audience == "" {
		return nil, httperror.New(http.StatusForbidden, "service_grant_audience_invalid", "Service audience is required")
	}
	selected := map[string]bool{}
	for _, scope := range requested {
		matched := ""
		for _, grant := range grants {
			var policy map[string]any
			if grant.scopeJSON.Valid && json.Unmarshal([]byte(grant.scopeJSON.String), &policy) != nil {
				return nil, httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "service grant policy binding is invalid")
			}
			bound := ""
			if raw, exists := policy["audience"]; exists && raw != nil {
				text, ok := raw.(string)
				if !ok || strings.TrimSpace(text) == "" {
					return nil, httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "service grant audience is invalid")
				}
				bound = strings.TrimSpace(text)
			}
			allowed := false
			if bound != "" {
				semantic, _ := policy["semanticScope"].(string)
				allowed = bound == audience && ((grant.scope == scope && strings.HasPrefix(scope, audience+":")) || strings.TrimSpace(semantic) == scope)
			} else {
				allowed = grant.scope == scope && legacyServiceAudienceAllows(client, audience, scope)
			}
			if !allowed {
				continue
			}
			if matched != "" && matched != grant.scope {
				return nil, httperror.New(http.StatusForbidden, "service_grant_policy_conflict", "service grants have conflicting semantic scope bindings")
			}
			matched = grant.scope
		}
		if matched == "" {
			return nil, httperror.New(http.StatusForbidden, "insufficient_scope", "insufficient_scope: scope does not match audience or active grant")
		}
		selected[matched] = true
	}
	return selected, nil
}
