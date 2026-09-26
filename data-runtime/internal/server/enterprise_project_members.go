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

const enterpriseProjectMemberListPath = "/v1/enterprise/aims/project-members:list"

type enterpriseProjectMemberReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseProjectMemberReadInput struct {
	Tenant        string                            `json:"tenant"`
	Deployment    string                            `json:"deployment"`
	ProjectID     string                            `json:"projectId"`
	Query         map[string]string                 `json:"query"`
	Authorization enterpriseProjectMemberReadPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectMemberList(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_project_members_unavailable", "Unified project member reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims", Capability: "aims:project-members:view",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project_members.list", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectMemberReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectMemberReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseProjectMemberReadTarget(input, verified.ActorUID)
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

func decodeEnterpriseProjectMemberReadInput(body map[string]any) (enterpriseProjectMemberReadInput, error) {
	var input enterpriseProjectMemberReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Invalid project member read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Invalid project member read input")
	}
	return input, nil
}

func validateEnterpriseProjectMemberReadPermit(input enterpriseProjectMemberReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment || permit.ActorUID != verified.ActorUID ||
		permit.Resource != "projects" || permit.Action != "view" || permit.ExpiresAt <= now.UnixMilli() ||
		permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_project_member_permit_invalid", "Project member read authorization is invalid")
	}
	return nil
}

func enterpriseProjectMemberReadTarget(input enterpriseProjectMemberReadInput, actorUID string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Project ID is invalid")
	}
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Project member read query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		switch key {
		case "page", "pageSize", "search", "role", "status":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_member_input_invalid", "Project member read query is invalid")
		}
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	return "/v1/aims/projects/" + input.ProjectID + "/members", query, nil
}
