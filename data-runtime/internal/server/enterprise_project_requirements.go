package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseProjectRequirementReadActions = map[string]string{
	"/v1/enterprise/aims/project-requirements:list":           "list",
	"/v1/enterprise/aims/project-requirements:view":           "view",
	"/v1/enterprise/aims/project-requirements:spec":           "spec",
	"/v1/enterprise/aims/project-requirements:targets":        "targets",
	"/v1/enterprise/aims/project-requirements:versions":       "versions",
	"/v1/enterprise/aims/project-requirements:change-diff":    "change-diff",
	"/v1/enterprise/aims/project-requirements:change-impact":  "change-impact",
	"/v1/enterprise/aims/project-requirements:review-list":    "review-list",
	"/v1/enterprise/aims/project-requirements:review-resolve": "review-resolve",
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
	Tenant                   string                                 `json:"tenant"`
	Deployment               string                                 `json:"deployment"`
	ProjectID                string                                 `json:"projectId"`
	RequirementID            string                                 `json:"requirementId"`
	Query                    map[string]string                      `json:"query"`
	Authorization            enterpriseProjectRequirementReadPermit `json:"authorization"`
	ProjectReadAuthorization *enterpriseNestedProjectReadPermit     `json:"projectReadAuthorization"`
}

func (s *Server) routeEnterpriseProjectRequirementRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_project_requirements_unavailable", "Unified project requirement reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}
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
	ctx, err := s.nestedProjectReadContext(r, input.ProjectID, input.ProjectReadAuthorization, query)
	if err != nil {
		return result, err
	}
	if _, err = s.aims.RequireEnterpriseProjectTab(ctx, input.ProjectID, query, "requirements"); err != nil {
		return result, err
	}
	ctx = aimsapp.WithEnterpriseProjectTabRead(ctx, input.ProjectID)
	if action == "versions" || action == "change-diff" || action == "change-impact" || action == "review-list" || action == "review-resolve" {
		out, e := s.aims.ReadEnterpriseRequirementExtended(ctx, input.ProjectID, input.RequirementID, action, query)
		result.Body = out
		return result, e
	}
	if action != "view" {
		out, err := s.aims.ReadEnterpriseRequirementProjection(ctx, input.ProjectID, action, query)
		result.Body = out
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(ctx, http.MethodGet, path, query, map[string]any{})
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
	return validateNestedProjectReadPermit(input.Tenant, input.Deployment, input.ProjectID, input.ProjectReadAuthorization, verified, now)
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
		case "page", "pageSize", "search", "type", "status", "priority", "milestone_id", "source", "sort", "order", "work_item_id":
			if action == "spec" {
				return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Invalid specification query")
			}
			q.Set(key, value)
		case "include_deleted":
			if action != "spec" || (value != "0" && value != "1") {
				return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Invalid specification query")
			}
			q.Set(key, value)
		default:
			return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Project requirement query is invalid")
		}
	}
	q.Set("current_user", actorUID)
	q.Set("operator_uid", actorUID)
	base := "/v1/aims/projects/" + input.ProjectID + "/requirements"
	if action == "review-list" {
		if input.RequirementID != "" {
			return "", nil, httperror.New(400, "requirement_input_invalid", "Object ID unsupported")
		}
		return base, q, nil
	}
	if action == "versions" || action == "change-diff" || action == "change-impact" || action == "review-resolve" {
		if !enterpriseTimeEntryID.MatchString(input.RequirementID) {
			return "", nil, httperror.New(400, "requirement_input_invalid", "Invalid object ID")
		}
		return base, q, nil
	}
	if action == "spec" || action == "targets" {
		if input.RequirementID != "" {
			return "", nil, httperror.New(400, "enterprise_project_requirement_input_invalid", "Object ID is unsupported")
		}
		if action == "spec" {
			return base + "/spec", q, nil
		}
		return "/v1/aims/projects/" + input.ProjectID + "/requirement-targets", q, nil
	}
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
