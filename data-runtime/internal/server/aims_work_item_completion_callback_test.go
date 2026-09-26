package server

import (
	"errors"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAimsCompletionCallbackRejectsLegacyAndMissingExactScope(t *testing.T) {
	cfg, key := testRuntimeJWTConfig(t)
	cfg.DeploymentBindings = map[string]string{"aims": "deployment-1"}
	cfg.Enterprise.Enabled = true
	s := &Server{cfg: cfg, auth: auth.New(cfg)}
	for _, scope := range []string{"aims.write", aimsapp.WorkItemCompletionCallbackCapability} {
		r := httptest.NewRequest(http.MethodPost, "/v1/aims/service/work-item-completion/workflow-callback?workflow_callback_verified=1", nil)
		r.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForAppSubject(t, key, "aims", scope, "aims.runtime"))
		_, err := s.routeAimsWorkItemCompletionCallback(r)
		var public httperror.Error
		if !errors.As(err, &public) || (public.Status != 401 && public.Status != 403) {
			t.Fatalf("legacy/unbound callback accepted: %v", err)
		}
	}
}
