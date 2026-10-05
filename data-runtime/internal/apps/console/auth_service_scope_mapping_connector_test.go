package console

import (
	"database/sql"
	"testing"
)

// S4 B17 fix 12: the connector runtime client's four requests are authorised by an audience-only fact
// (grant.scope == requested scope, scope prefixed by the audience); without the audience they stay denied.
func TestConnectorAudienceFactsAuthoriseExactlyTheRequestedPairs(t *testing.T) {
	legacy := sql.NullString{String: `{"source":"connector-runtime-enrollment","tenantCode":"C000001"}`, Valid: true}
	bound := func(audience string) sql.NullString {
		return sql.NullString{String: `{"source":"connector-runtime-enrollment","tenantCode":"C000001","audience":"` + audience + `","audienceFacts":"s4-b17-audience-facts-connector"}`, Valid: true}
	}
	pairs := []struct{ audience, scope string }{
		{"data-runtime", "data-runtime:integration_config:view"},
		{"data-runtime", "data-runtime:credential_vault:resolve"},
		{"console", "console:connector-runtime:heartbeat"},
		{"console", "console:directory-profiles:sync"},
	}
	for _, pair := range pairs {
		if _, err := mapServiceAudienceScopes("connector-runtime.C000001-console", pair.audience, []string{pair.scope}, []serviceScopeGrant{{scope: pair.scope, scopeJSON: legacy}}); err == nil {
			t.Fatalf("%s/%s must be denied without an audience fact", pair.audience, pair.scope)
		}
		if _, err := mapServiceAudienceScopes("connector-runtime.C000001-console", pair.audience, []string{pair.scope}, []serviceScopeGrant{{scope: pair.scope, scopeJSON: bound(pair.audience)}}); err != nil {
			t.Fatalf("%s/%s must be allowed with its audience fact: %v", pair.audience, pair.scope, err)
		}
		other := "console"
		if pair.audience == "console" {
			other = "data-runtime"
		}
		if _, err := mapServiceAudienceScopes("connector-runtime.C000001-console", other, []string{pair.scope}, []serviceScopeGrant{{scope: pair.scope, scopeJSON: bound(pair.audience)}}); err == nil {
			t.Fatalf("%s must not be allowed for audience %s", pair.scope, other)
		}
	}
}
