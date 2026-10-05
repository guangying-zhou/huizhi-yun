package server

import (
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

func (s *Server) routeAimsWorkItemCompletionCallback(r *http.Request) (routeResult, error) {
	identity, err := s.authenticateEnterpriseSystem(r, "aims", aimsapp.WorkItemCompletionCallbackCapability)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.work_item_completion_requests.workflow_callback", Auth: &identity}
	if identity.AppCode == "aims" {
		result.Operation = "aims.work_item_completion_requests.workflow_callback.legacy"
	}
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return result, httperror.New(503, "work_item_completion_unavailable", "Completion unavailable")
	}
	if identity.AppCode == "enterprise" && r.URL.RawQuery != "" || identity.AppCode == "aims" && (len(r.URL.Query()) != 1 || r.URL.Query().Get("workflow_callback_verified") != "1") {
		return result, httperror.New(400, "work_item_completion_callback_query_invalid", "Only the verified callback marker is supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body["app_code"] != "aims" {
		return result, httperror.New(403, "work_item_completion_callback_app_mismatch", "Callback business app mismatch")
	}
	setRuntimeTrustedBody(body, identity, requestID(r))
	query := r.URL.Query()
	query.Set("workflow_callback_verified", "1")
	callback, err := aimsapp.VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, body)
	if err != nil {
		return result, err
	}
	data, err := s.aims.ApplyWorkItemCompletionCallback(r.Context(), callback)
	result.Body = map[string]any{"code": 0, "data": data}
	return result, err
}
