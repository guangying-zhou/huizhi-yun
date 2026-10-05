package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func scopeGrant(scope, policy string) serviceScopeGrant {
	return serviceScopeGrant{scope: scope, scopeJSON: sql.NullString{String: policy, Valid: policy != ""}}
}

// This historical fixture freezes the migrated audience set. It is
// independent of the implementation table; adding a broad client/audience pair
// or reintroducing excluded legacy rows must fail the contract.
func TestServiceAudienceCompatibilityContract(t *testing.T) {
	var f struct {
		Prefix          struct{ Client, Audience, ScopePrefix string }
		Exact, Excluded []struct{ Client, Audience, Scope string }
	}
	raw, err := os.ReadFile("testdata/service-audience-compatibility.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Exact) != 22 || len(legacyServiceAudiences) != 0 {
		t.Fatal("migrated fixture or empty compatibility cardinality changed")
	}
	for _, x := range f.Exact {
		if legacyServiceAudienceAllows(x.Client, x.Audience, x.Scope) {
			t.Fatalf("legacy compatibility reintroduced %#v", x)
		}
		_, err := mapServiceAudienceScopes(x.Client, x.Audience, []string{x.Scope}, []serviceScopeGrant{scopeGrant(x.Scope, `{"source":"legacy"}`)})
		assertSigningForbidden(t, err, "insufficient_scope")
		policy, _ := json.Marshal(map[string]string{"audience": x.Audience, "semanticScope": x.Scope})
		if _, err = mapServiceAudienceScopes(x.Client, x.Audience, []string{x.Scope}, []serviceScopeGrant{scopeGrant(x.Scope, string(policy))}); err != nil {
			t.Fatal(err)
		}
		for _, variant := range []struct{ client, audience, scope string }{
			{x.Client, "unrelated-runtime", x.Scope}, {"unregistered.runtime", x.Audience, x.Scope}, {x.Client, x.Audience, x.Scope + ":extra"},
		} {
			_, err := mapServiceAudienceScopes(variant.client, variant.audience, []string{variant.scope}, []serviceScopeGrant{scopeGrant(variant.scope, "")})
			assertSigningForbidden(t, err, "insufficient_scope")
		}
		_, err = mapServiceAudienceScopes(x.Client, x.Audience, []string{x.Scope}, nil)
		assertSigningForbidden(t, err, "insufficient_scope")
	}
	for _, x := range f.Excluded {
		_, err := mapServiceAudienceScopes(x.Client, x.Audience, []string{x.Scope}, []serviceScopeGrant{scopeGrant(x.Scope, "")})
		assertSigningForbidden(t, err, "insufficient_scope")
	}
	for _, scope := range []string{"console:policy-bundle:read", "console:auth-session:write", "console:auth-oidc:sign"} {
		_, err := mapServiceAudienceScopes(f.Prefix.Client, f.Prefix.Audience, []string{scope}, []serviceScopeGrant{scopeGrant(scope, "")})
		assertSigningForbidden(t, err, "insufficient_scope")
		policy, _ := json.Marshal(map[string]string{"audience": f.Prefix.Audience, "semanticScope": scope})
		if _, err = mapServiceAudienceScopes(f.Prefix.Client, f.Prefix.Audience, []string{scope}, []serviceScopeGrant{scopeGrant(scope, string(policy))}); err != nil {
			t.Fatal(err)
		}
		_, err = mapServiceAudienceScopes(f.Prefix.Client, "tenant-runtime", []string{scope}, []serviceScopeGrant{scopeGrant(scope, "")})
		assertSigningForbidden(t, err, "insufficient_scope")
	}
}

func TestServiceAudienceRegisteredGrantOverridesPhysicalPrefixAndLegacy(t *testing.T) {
	cases := []struct{ name, client, audience, scope, physical, policy, code string }{
		{"semantic binding", "aims.runtime", "data-runtime", "aims:project-documents:read", "data-runtime:aims:project-documents:read", `{"audience":"data-runtime","semanticScope":"aims:project-documents:read"}`, ""},
		{"exact physical binding", "aims.runtime", "aims", "aims:projects:read", "aims:projects:read", `{"audience":"aims"}`, ""},
		{"physical prefix cannot override JSON", "workflow.runtime", "workflow", "workflow:callback", "workflow:callback", `{"audience":"aims","semanticScope":"workflow:callback"}`, "insufficient_scope"},
		{"compat cannot override JSON", "console.runtime", "data-runtime", "console:policy-bundle:read", "console:policy-bundle:read", `{"audience":"console","semanticScope":"console:policy-bundle:read"}`, "insufficient_scope"},
		{"semantic cross audience", "aims.runtime", "tenant-runtime", "aims:project-documents:read", "data-runtime:aims:project-documents:read", `{"audience":"data-runtime","semanticScope":"aims:project-documents:read"}`, "insufficient_scope"},
		{"no implicit physical-prefix legacy", "aims.runtime", "aims", "aims:projects:read", "aims:projects:read", `{"source":"legacy"}`, "insufficient_scope"},
		{"null audience legacy", "enterprise.runtime", "console", "console:policy-bundle:read", "console:policy-bundle:read", `{"audience":null}`, "insufficient_scope"},
		{"invalid JSON", "console.runtime", "data-runtime", "console:policy-bundle:read", "console:policy-bundle:read", `{`, "service_grant_policy_invalid"},
		{"nonstring audience", "console.runtime", "data-runtime", "console:policy-bundle:read", "console:policy-bundle:read", `{"audience":123}`, "service_grant_policy_invalid"},
		{"empty audience is not missing", "console.runtime", "data-runtime", "console:policy-bundle:read", "console:policy-bundle:read", `{"audience":""}`, "service_grant_policy_invalid"},
	}
	for _, x := range cases {
		t.Run(x.name, func(t *testing.T) {
			selected, err := mapServiceAudienceScopes(x.client, x.audience, []string{x.scope}, []serviceScopeGrant{scopeGrant(x.physical, x.policy)})
			if x.code != "" {
				assertSigningForbidden(t, err, x.code)
			} else if err != nil || !selected[x.physical] {
				t.Fatalf("selection %v error %v", selected, err)
			}
		})
	}
	_, err := mapServiceAudienceScopes("aims.runtime", "data-runtime", []string{"aims:projects:read"}, []serviceScopeGrant{
		scopeGrant("first:read", `{"audience":"data-runtime","semanticScope":"aims:projects:read"}`), scopeGrant("second:read", `{"audience":"data-runtime","semanticScope":"aims:projects:read"}`),
	})
	assertSigningForbidden(t, err, "service_grant_policy_conflict")
}

func TestServiceSigningAudienceAndTargetAreCredentialBound(t *testing.T) {
	for _, tc := range []struct{ name, audience, target, policy, code string }{
		{"registered", "assets", "assets", `{"audience":"assets","semanticScope":"assets:product:read"}`, ""},
		{"wrong audience", "finance", "finance", `{"audience":"assets","semanticScope":"assets:product:read"}`, "insufficient_scope"},
		{"wrong target", "assets", "finance", `{"audience":"assets"}`, "oidc_signing_service_target_mismatch"},
		{"missing target", "assets", "", `{"audience":"assets"}`, ""},
		{"unregistered legacy", "assets", "assets", "", "insufficient_scope"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, mock := signingAdapter(t)
			expectServiceCredential(mock, "active")
			var policy any = tc.policy
			if tc.policy == "" {
				policy = nil
			}
			mock.ExpectQuery(`(?s)SELECT resource_code,action,scope_json.*FROM service_client_grants`).WithArgs(uint64(9)).WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).AddRow("assets:product", "read", policy))
			claims := serviceSigningBody("assets:product:read")["claims"].(map[string]any)
			claims["aud"] = tc.audience
			if tc.target == "" {
				delete(claims, "target_app")
			} else {
				claims["target_app"] = tc.target
			}
			err := a.authorizeServiceSigningClaims(context.Background(), claims, claims["hzy"].(map[string]any))
			if tc.code != "" {
				assertSigningForbidden(t, err, tc.code)
			} else if err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConsoleIssueRejectsLegacyScopeForUnregisteredAudienceBeforeSigning(t *testing.T) {
	a, mock := signingAdapter(t)
	mock.ExpectQuery(`(?s)SELECT id,status,app_code,client_type,current_credential_id.*FROM service_clients`).WithArgs(consoleRuntimeClientCode).WillReturnRows(sqlmock.NewRows([]string{"id", "status", "app_code", "client_type", "current_credential_id"}).AddRow(64, "active", "console", "runtime", 4))
	mock.ExpectQuery(`(?s)SELECT scc.id.*FROM service_client_credentials`).WithArgs(int64(4), uint64(64), consoleRuntimeClientCode).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(4))
	mock.ExpectQuery(`(?s)SELECT resource_code,action FROM service_client_grants`).WithArgs(uint64(64)).WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action"}).AddRow("console:auth-oidc", "read"))
	mock.ExpectQuery(`(?s)SELECT sc.id,sc.status.*FROM service_client_credentials`).WithArgs(int64(4), consoleRuntimeClientCode).WillReturnRows(sqlmock.NewRows([]string{"id", "status", "current", "credential_status", "expires", "client_code", "client_name", "client_type", "app_code"}).AddRow(64, "active", 4, "active", nil, consoleRuntimeClientCode, "Console Runtime", "runtime", "console"))
	mock.ExpectQuery(`(?s)SELECT resource_code,action,scope_json FROM service_client_grants`).WithArgs(uint64(64)).WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).AddRow("console:auth-oidc", "read", `{"source":"tenant-runtime-bootstrap"}`))
	_, err := a.IssueConsoleRuntimeServiceToken(context.Background(), map[string]any{"audience": "tenant-runtime", "scope": "console:auth-oidc:read", "issuer": "https://console.example.test", "ttlSeconds": 300}, "tenant-a-console", AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "insufficient_scope")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
