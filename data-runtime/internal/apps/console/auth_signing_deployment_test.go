package console

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUserSigningDeploymentRegistry(t *testing.T) {
	a := &Adapter{}
	assertHTTPErrorCode(t, a.authorizeUserSigningDeployment("unknown"), 503, "oidc_signing_deployment_unavailable")
	bindings := map[string]string{"aims": "tenant-a-aims", "console": "custom-console", "workflow": "local-workflow"}
	a.SetOIDCSigningDeploymentBindings("runtime-test", bindings)
	bindings["aims"] = "mutated-caller-map"
	for _, value := range []string{"tenant-a-aims", "custom-console", "local-workflow", "runtime-test"} {
		if err := a.authorizeUserSigningDeployment(value); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []any{"tenant-b-aims", "mutated-caller-map", " tenant-a-aims", nil, 42} {
		assertSigningForbidden(t, a.authorizeUserSigningDeployment(value), "oidc_signing_user_deployment_mismatch")
	}
	a.SetOIDCSigningDeploymentBindings("new-runtime", map[string]string{"aims": "new-aims"})
	assertSigningForbidden(t, a.authorizeUserSigningDeployment("tenant-a-aims"), "oidc_signing_user_deployment_mismatch")
	if err := a.authorizeUserSigningDeployment("new-aims"); err != nil {
		t.Fatal(err)
	}
}

func TestServiceSigningDeploymentGrantAndCredentialFacts(t *testing.T) {
	cases := []struct {
		name, app, actual, policy, code string
		status                          int
	}{
		{"credential source registry", "aims", "tenant-a-aims", `{"source":"legacy"}`, "", 0},
		{"target deployment cannot replace source", "aims", "tenant-a-assets", `{"source":"legacy"}`, "oidc_signing_service_deployment_mismatch", 403},
		{"explicit grant", "aims", "grant-bound", `{"tenantCode":"tenant-a","deploymentCode":"grant-bound"}`, "", 0},
		{"grant takes precedence", "aims", "tenant-a-aims", `{"tenantCode":"tenant-a","deploymentCode":"grant-bound"}`, "oidc_signing_service_deployment_mismatch", 403},
		{"other tenant", "aims", "other-bound", `{"tenantCode":"tenant-b","deploymentCode":"other-bound"}`, "oidc_signing_service_deployment_binding_invalid", 403},
		{"partial tenant", "aims", "tenant-a-aims", `{"tenantCode":"tenant-a"}`, "oidc_signing_service_deployment_binding_invalid", 403},
		{"partial deployment", "aims", "tenant-a-aims", `{"deploymentCode":"tenant-a-aims"}`, "oidc_signing_service_deployment_binding_invalid", 403},
		{"numeric binding", "aims", "tenant-a-aims", `{"tenantCode":42,"deploymentCode":"tenant-a-aims"}`, "service_grant_policy_invalid", 403},
		{"null legacy fields", "aims", "tenant-a-aims", `{"tenantCode":null,"deploymentCode":null}`, "", 0},
		{"supporting connector uses console", "connector-runtime", "custom-console", `{}`, "", 0},
		{"no naming fallback", "unknown", "tenant-a-unknown", `{}`, "oidc_signing_deployment_unavailable", 503},
		{"tool unbound", "", "tenant-a-console", `{}`, "oidc_signing_deployment_unavailable", 503},
		{"tool explicit binding", "", "tool-bound", `{"tenantCode":"tenant-a","deploymentCode":"tool-bound"}`, "", 0},
	}
	for _, x := range cases {
		t.Run(x.name, func(t *testing.T) {
			a := &Adapter{tenant: "tenant-a"}
			a.SetOIDCSigningDeploymentBindings("runtime-test", map[string]string{"aims": "tenant-a-aims", "assets": "tenant-a-assets", "console": "custom-console"})
			identity := serviceSigningIdentity{AppCode: x.app, Grants: []serviceScopeGrant{scopeGrant("scope:read", x.policy), scopeGrant("unselected:read", `{"tenantCode":"other","deploymentCode":"other"}`)}}
			err := a.authorizeServiceSigningDeployment(x.actual, identity, map[string]bool{"scope:read": true})
			if x.code != "" {
				assertHTTPErrorCode(t, err, x.status, x.code)
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
	a := &Adapter{tenant: "tenant-a"}
	a.SetOIDCSigningDeploymentBindings("runtime-test", map[string]string{"aims": "tenant-a-aims"})
	for _, policy := range []string{`{"tenantCode":"tenant-a","deploymentCode":"other"}`, `{}`} {
		identity := serviceSigningIdentity{AppCode: "aims", Grants: []serviceScopeGrant{scopeGrant("first:read", `{"tenantCode":"tenant-a","deploymentCode":"grant-bound"}`), scopeGrant("second:read", policy)}}
		assertSigningForbidden(t, a.authorizeServiceSigningDeployment("grant-bound", identity, map[string]bool{"first:read": true, "second:read": true}), "service_grant_policy_conflict")
	}
	a.SetOIDCSigningDeploymentBindings("legacy-enrolled", nil)
	if a.signingSourceDeployment("aims") != "legacy-enrolled" {
		t.Fatal("legacy enrolled binding lost")
	}
}

func TestServiceSigningRejectsForgedDeploymentBeforeKeyUse(t *testing.T) {
	for _, deployment := range []any{"tenant-b-aims", "tenant-a-assets", 42} {
		t.Run("wrong source", func(t *testing.T) {
			a, mock := signingAdapter(t)
			if _, ok := deployment.(string); ok {
				expectActiveSigningGrant(mock)
			}
			body := serviceSigningBody("assets:product:read")
			body["claims"].(map[string]any)["deployment"] = deployment
			_, err := a.SignOIDCToken(context.Background(), body, AuditMutationMeta{ActorID: "console.runtime"})
			if _, ok := deployment.(string); ok {
				assertSigningForbidden(t, err, "oidc_signing_service_deployment_mismatch")
			} else {
				assertHTTPErrorCode(t, err, 400, "oidc_signing_deployment_invalid")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestUserSigningRejectsUnregisteredDeploymentAfterSessionCheck(t *testing.T) {
	a, mock := signingAdapter(t)
	mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).WithArgs(testSigningSID).WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow("u1001"))
	body := userSigningBody(testSigningSID, "user:u1001", "u1001")
	body["claims"].(map[string]any)["deployment"] = "other-tenant-deployment"
	_, err := a.SignOIDCToken(context.Background(), body, AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "oidc_signing_user_deployment_mismatch")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
