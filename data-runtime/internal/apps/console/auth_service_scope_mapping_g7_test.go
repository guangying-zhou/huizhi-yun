package console

import (
	"testing"
)

// R3 rehearsal (P0-12): production rows created by seed v1.92 for aims.runtime carry an audience-prefixed
// semanticScope and no `audience` key. The issuer never authorizes an unbound grant, so those rows cannot
// sign either the short scope or the physical scope until G-7 binds them to the canonical short semantic scope.
func TestProductionAimsWorkerGrantsAreOnlyIssuableAfterG7Binding(t *testing.T) {
	const short = "aims:integration_operation:execute"
	for _, audience := range []string{"data-runtime", "tenant-runtime"} {
		physical := audience + ":" + short
		before := scopeGrant(physical, `{"source":"seed:v1.92","purpose":"aims-integration-operation-worker","semanticScope":"`+physical+`"}`)
		for _, requested := range []string{short, physical} {
			_, err := mapServiceAudienceScopes("aims.runtime", audience, []string{requested}, []serviceScopeGrant{before})
			assertSigningForbidden(t, err, "insufficient_scope")
		}
		after := scopeGrant(physical, `{"source":"seed:g7-prod-service-grants","purpose":"aims-integration-operation-worker","tenantCode":"C000001","deploymentCode":"C000001-aims","audience":"`+audience+`","semanticScope":"`+short+`"}`)
		for _, requested := range []string{short, physical} {
			selected, err := mapServiceAudienceScopes("aims.runtime", audience, []string{requested}, []serviceScopeGrant{after})
			if err != nil || len(selected) != 1 || !selected[physical] {
				t.Fatalf("bound grant must issue %q for %s: %v %v", requested, audience, selected, err)
			}
		}
		other := "tenant-runtime"
		if audience == other {
			other = "data-runtime"
		}
		_, err := mapServiceAudienceScopes("aims.runtime", other, []string{short}, []serviceScopeGrant{after})
		assertSigningForbidden(t, err, "insufficient_scope")
	}
}
