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

var enterpriseProjectRequirementReadActions = map[string]string{
	"/v1/enterprise/aims/project-requirements:list": "list",
	"/v1/enterprise/aims/project-requirements:view": "view",
}

type enterpriseProjectRequirementReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseProjectRequirementReadInput struct {
	Tenant        string                                 `json:"tenant"`
	Deployment    string                                 `json:"deployment"`
	ProjectID     string                                 `json:"projectId"`
	RequirementID string                                 `json:"requirementId"`
	Query         map[string]string                      `json:"query"`
	Authorization enterpriseProjectRequirementReadPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectRequirementRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_project_requirements_unavailable", "Unified project requirement reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:requirements:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project_requirements." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_project_requirement_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectRequirementReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectRequirementReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseProjectRequirementReadTarget(action, input, verified.ActorUID)
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

func decodeEnterpriseProjectRequirementReadInput(body map[string]any) (enterpriseProjectRequirementReadInput, error) {
	var input enterpriseProjectRequirementReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_project_requirement_input_invalid", "Invalid project requirement read input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil {
		return input, httperror.New(400, "enterprise_project_requirement_input_invalid", "Invalid project requirement read input")
	}
	return input, nil
}
func validateEnterpriseProjectRequirementReadPermit(input enterpriseProjectRequirementReadInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "requirements" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_requirement_permit_invalid", "Project requirement read authorization is invalid")
	}
	return nil
}
func enterpriseProjectRequirementReadTarget(action string, input enterpriseProjectRequirementReadInput, actorUID string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Project ID is invalid")
	}
	q := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Project requirement query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			q.Set(key, value)
			continue
		}
		switch key {
		case "page", "pageSize", "search", "type", "status", "priority", "milestone_id", "source", "sort", "order":
			q.Set(key, value)
		default:
			return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Project requirement query is invalid")
		}
	}
	q.Set("current_user", actorUID)
	q.Set("operator_uid", actorUID)
	base := "/v1/aims/projects/" + input.ProjectID + "/requirements"
	if action == "list" {
		if input.RequirementID != "" {
			return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Requirement ID is not accepted")
		}
		return base, q, nil
	}
	if action == "view" && enterpriseTimeEntryID.MatchString(input.RequirementID) {
		return base + "/" + input.RequirementID, q, nil
	}
	return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Requirement ID is invalid")
}
