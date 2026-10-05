package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWorkflowPendingPaginationRejectsCrossTenantAndDeploymentBeforeRead(t *testing.T) {
	a, key := newContractJWTAuthenticator(t)
	a.cfg.DeploymentBindings = map[string]string{"workflow": "tenant-a-workflow"}
	claims := contractJWTClaims()
	claims["app_code"] = "workflow"
	claims["source_app"] = "workflow"
	claims["deployment"] = "tenant-a-workflow"
	claims["scope"] = "data-runtime:workflow:read"
	req := httptest.NewRequest(http.MethodGet, "/v1/workflow/tasks/pending?page=1&pageSize=20&resource_code=tasks&action_code=complete&exclude_initiator=true", nil)
	check := func() { req.Header.Set("Authorization", "Bearer "+signContractJWT(t, key, claims)) }
	check()
	if _, e := a.Authenticate(req, Requirement{AppCode: "workflow", Scope: "workflow.read"}); e != nil {
		t.Fatal(e)
	}
	claims["tenant"] = "tenant-b"
	check()
	_, e := a.Authenticate(req, Requirement{AppCode: "workflow", Scope: "workflow.read"})
	assertAuthHTTPError(t, e, 403, "tenant_mismatch")
	claims["tenant"] = "tenant-a"
	claims["deployment"] = "tenant-b-workflow"
	check()
	_, e = a.Authenticate(req, Requirement{AppCode: "workflow", Scope: "workflow.read"})
	assertAuthHTTPError(t, e, 403, "deployment_mismatch")
}
