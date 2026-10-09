package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAimsMilestoneReceivableWorkflowCallbackIsNarrow(t *testing.T) {
	base := map[string]any{"resource_code": "milestones", "action_code": "milestone_completion"}
	if !isAimsMilestoneReceivableWorkflowCallback(http.MethodPost, "/v1/aims/service/workflow/callback", base) {
		t.Fatal("milestone completion callback was not selected")
	}
	for name, input := range map[string]struct {
		method, path string
		body         map[string]any
	}{
		"project initiation": {http.MethodPost, "/v1/aims/service/workflow/callback", map[string]any{"resource_code": "projects", "action_code": "initiation"}},
		"wrong action":       {http.MethodPost, "/v1/aims/service/workflow/callback", map[string]any{"resource_code": "milestones", "action_code": "review"}},
		"wrong path":         {http.MethodPost, "/v1/aims/milestones/1/completion-requests", base},
		"wrong method":       {http.MethodGet, "/v1/aims/service/workflow/callback", base},
	} {
		t.Run(name, func(t *testing.T) {
			if isAimsMilestoneReceivableWorkflowCallback(input.method, input.path, input.body) {
				t.Fatal("unrelated Aims path was selected")
			}
		})
	}
}

func TestAimsMilestoneReceivableCapabilityRequiresExactScope(t *testing.T) {
	if !hasExactCapability([]string{"aims.write", aimsMilestoneReceivableCapability}, aimsMilestoneReceivableCapability) {
		t.Fatal("exact capability rejected")
	}
	for _, scopes := range [][]string{{"aims.write"}, {"altoc:receivable:*"}, {"*"}, {"data-runtime:" + aimsMilestoneReceivableCapability}} {
		if hasExactCapability(scopes, aimsMilestoneReceivableCapability) {
			t.Fatalf("non-exact capability accepted: %#v", scopes)
		}
	}
}

func TestAimsMilestoneReceivableCoordinatorRequiresStrictBoundServiceIdentity(t *testing.T) {
	cfg, private := testRuntimeJWTConfig(t)
	cfg.DeploymentBindings = map[string]string{"aims": "deployment-1"}
	cfg.Enterprise.Enabled = true
	cfg.Enterprise.EnableMilestoneReceivable = true
	server := &Server{cfg: cfg, auth: auth.New(cfg), enterpriseMilestoneReceivable: &enterprisecontracts.MilestoneReceivableService{}}
	request := httptest.NewRequest(http.MethodPost, "/v1/aims/service/workflow/callback?workflow_callback_verified=1", nil)
	// This otherwise-valid legacy Aims runtime token intentionally omits the
	// complete source/target/client/credential service binding required only by
	// the opt-in coordinator.
	request.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForAppSubject(t, private, "aims", "aims.write "+aimsMilestoneReceivableCapability, "aims.runtime"))
	_, err := server.routeAimsMilestoneReceivableWorkflowCallback(request, auth.Context{Mode: string(config.AuthJWT)}, map[string]any{"resource_code": "milestones", "action_code": "milestone_completion"})
	var public httperror.Error
	if !errors.As(err, &public) || public.Code != "service_claims_required" {
		t.Fatalf("unbound service identity error = %T %v", err, err)
	}
}
