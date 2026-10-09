package server

import (
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestWorkflowEffectRoutesRequireOnlyExactSchedulerScope(t *testing.T) {
	if !workflowIntegrationEffectRoute(http.MethodGet, "/v1/workflow/delivery-effects/status") {
		t.Fatal("delivery diagnostics must use the precise scheduler scope")
	}
	if got := workflowRuntimeRequiredScope(http.MethodGet, "/v1/workflow/delivery-effects/status"); got != "workflow:integration_operation:execute" {
		t.Fatalf("diagnostic scope = %s", got)
	}
	for _, base := range []string{"/v1/workflow/notification-effects/", "/v1/workflow/actionable-lifecycle-effects/", "/v1/workflow/callback-effects/"} {
		for _, route := range []struct{ method, path string }{
			{http.MethodGet, base + "pending"},
			{http.MethodPost, base + "42/ack"},
			{http.MethodPost, base + "42/fail"},
		} {
			if !workflowIntegrationEffectRoute(route.method, route.path) {
				t.Fatalf("exact effect route did not use scheduler scope: %s %s", route.method, route.path)
			}
			if got := workflowRuntimeRequiredScope(route.method, route.path); got != "workflow:integration_operation:execute" {
				t.Fatalf("effect scope = %s for %s %s", got, route.method, route.path)
			}
		}
		for _, route := range []struct{ method, path string }{
			{http.MethodGet, base + "pending/more"},
			{http.MethodPost, base + "other/ack"},
			{http.MethodPost, base + "42/ack/more"},
			{http.MethodGet, base + "42/ack"},
			{http.MethodPut, base + "42/fail"},
		} {
			if workflowIntegrationEffectRoute(route.method, route.path) {
				t.Fatalf("adjacent route gained scheduler scope: %s %s", route.method, route.path)
			}
			if got := workflowRuntimeRequiredScope(route.method, route.path); got == "workflow:integration_operation:execute" {
				t.Fatalf("adjacent route gained scheduler scope: %s %s", route.method, route.path)
			}
		}
	}
	if workflowIntegrationEffectRoute(http.MethodGet, "/v1/workflow/tasks/pending") {
		t.Fatal("ordinary Workflow user route gained scheduler scope")
	}
	if got := workflowRuntimeRequiredScope(http.MethodGet, "/v1/workflow/tasks/pending"); got != "workflow.read" {
		t.Fatalf("ordinary read scope changed: %s", got)
	}
	if got := workflowRuntimeRequiredScope(http.MethodPost, "/v1/workflow/tasks/42/approve"); got != "workflow.write" {
		t.Fatalf("ordinary write scope changed: %s", got)
	}
}

func TestWorkflowRecoveryRouteIsNarrowerThanOrdinaryRuntimeWrites(t *testing.T) {
	source, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	guard := string(source)
	start := strings.Index(guard, "if r.Method == http.MethodPost && workflowDeliveryRecoveryRoute(path) {")
	if start < 0 {
		t.Fatal("recovery authorization branch missing")
	}
	end := strings.Index(guard[start:], "\n\tif isWorkflowRuntimePath(path) {")
	if end < 0 {
		t.Fatal("recovery must have an isolated authorization branch before ordinary Workflow routes")
	}
	guard = guard[start : start+end]
	for _, required := range []string{
		`authenticateWorkflowEffectService(r, workflowDeliveryRecoveryScope, "workflow.maintenance")`,
		`workflowRecoveryInput(body)`,
		`setRuntimeTrustedBody(body, authCtx, requestID(r))`,
		`body["hzy_runtime_credential_id"] = authCtx.CredentialID`,
	} {
		if !strings.Contains(guard, required) {
			t.Fatalf("recovery guard missing %q", required)
		}
	}
	for _, kind := range []string{"notification", "actionable", "callback"} {
		if !workflowDeliveryRecoveryRoute("/v1/workflow/delivery-effects/" + kind + "/42/recover") {
			t.Fatalf("valid %s recovery route not registered", kind)
		}
	}
	for _, path := range []string{
		"/v1/workflow/delivery-effects/other/42/recover",
		"/v1/workflow/delivery-effects/actionable/42/recover/more",
		"/v1/workflow/delivery-effects/actionable/all/recover",
		"/v1/workflow/delivery-effects/actionable/42/ack",
	} {
		if workflowDeliveryRecoveryRoute(path) {
			t.Fatalf("adjacent route gained recovery capability: %s", path)
		}
	}
}

func TestWorkflowNotificationDetailAuthorizeRequiresOnlyReadScope(t *testing.T) {
	if got := workflowRuntimeRequiredScope(http.MethodPost, "/v1/workflow/notification-details/authorize"); got != "workflow.read" {
		t.Fatalf("notification detail authorize scope = %q, want workflow.read", got)
	}
	// Only the exact read-only viewer check is relaxed; other POST routes still require write.
	for _, path := range []string{"/v1/workflow/notification-details/authorize/extra", "/v1/workflow/actions", "/v1/workflow/instances"} {
		if got := workflowRuntimeRequiredScope(http.MethodPost, path); got != "workflow.write" {
			t.Fatalf("%s scope = %q, want workflow.write", path, got)
		}
	}
	if got := workflowRuntimeRequiredScope(http.MethodGet, "/v1/workflow/notification-details/authorize"); got != "workflow.read" {
		t.Fatalf("GET scope = %q", got)
	}
}
