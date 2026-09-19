package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseProjectPlanReadActions = map[string]string{"/v1/enterprise/aims/project-plan:milestones": "milestones", "/v1/enterprise/aims/project-plan:items": "items"}

type enterpriseProjectPlanPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseProjectPlanInput struct {
	Tenant        string                      `json:"tenant"`
	Deployment    string                      `json:"deployment"`
	ProjectID     string                      `json:"projectId"`
	Query         map[string]string           `json:"query"`
	Authorization enterpriseProjectPlanPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectPlanRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_plan_unavailable", "Unified project plan reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:project-plan:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project_plan." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_project_plan_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectPlanInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectPlanPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseProjectPlanTarget(action, input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, query, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}
func decodeEnterpriseProjectPlanInput(body map[string]any) (enterpriseProjectPlanInput, error) {
	var input enterpriseProjectPlanInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_project_plan_input_invalid", "Invalid project plan input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil {
		return input, httperror.New(400, "enterprise_project_plan_input_invalid", "Invalid project plan input")
	}
	return input, nil
}
func validateEnterpriseProjectPlanPermit(input enterpriseProjectPlanInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "project-plan" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_plan_permit_invalid", "Project plan authorization is invalid")
	}
	return nil
}
func enterpriseProjectPlanTarget(action string, input enterpriseProjectPlanInput, actor string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(400, "enterprise_project_plan_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(400, "enterprise_project_plan_input_invalid", "Project ID is invalid")
	}
	q := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(400, "enterprise_project_plan_input_invalid", "Project plan query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			q.Set(key, value)
			continue
		}
		if key == "page" || key == "pageSize" || (action == "items" && key == "milestoneId") {
			q.Set(key, value)
			continue
		}
		return "", nil, httperror.New(400, "enterprise_project_plan_input_invalid", "Project plan query is invalid")
	}
	q.Set("current_user", actor)
	q.Set("operator_uid", actor)
	base := "/v1/aims/projects/" + input.ProjectID
	if action == "milestones" {
		return base + "/milestones", q, nil
	}
	if action == "items" {
		return base + "/work-items", q, nil
	}
	return "", nil, httperror.New(404, "enterprise_project_plan_operation_unknown", "Project plan operation is not registered")
}
