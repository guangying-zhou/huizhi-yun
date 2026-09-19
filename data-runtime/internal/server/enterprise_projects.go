package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseProjectReadActions = map[string]string{
	"/v1/enterprise/aims/projects:list": "list",
	"/v1/enterprise/aims/projects:view": "view",
}

type enterpriseProjectReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseProjectReadInput struct {
	Tenant        string                      `json:"tenant"`
	Deployment    string                      `json:"deployment"`
	ProjectID     string                      `json:"projectId"`
	Query         map[string]string           `json:"query"`
	Authorization enterpriseProjectReadPermit `json:"authorization"`
}

var enterpriseProjectID = regexp.MustCompile(`^[1-9][0-9]*$`)
var enterpriseProjectScopeKey = regexp.MustCompile(`^current_user_(?:dept_codes|management_dept_codes|is_project_admin|project_admin_(?:dept_codes|project_codes|member_scope|owner_scope|member_project_codes|owner_project_codes))$`)

// Enterprise project reads retain Aims' existing data-scope execution.  The
// Host resolves the user session and scoped-admin projection; this endpoint
// verifies that the projection is bound to the signed actor before dispatching
// to the Aims adapter.  It intentionally exposes only list and detail reads.
func (s *Server) routeEnterpriseProjectRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_projects_unavailable", "Unified project reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:projects:view",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.projects." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseProjectReadTarget(action, input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, query, map[string]any{})
	if operation == "" {
		operation = "aims.projects." + action
	}
	result.Operation = "enterprise." + operation
	if action == "view" && err == nil {
		snapshot, version, versionErr := s.aims.EnterpriseProjectEditableSnapshot(r.Context(), input.ProjectID)
		if versionErr != nil {
			return result, versionErr
		}
		if wrapped, ok := out.(map[string]any); ok {
			if data, ok := wrapped["data"].(map[string]any); ok {
				for key, value := range snapshot {
					data[key] = value
				}
				data["editVersion"] = version
			}
		}
	}
	result.Body = out
	return result, err
}

func decodeEnterpriseProjectReadInput(body map[string]any) (enterpriseProjectReadInput, error) {
	var input enterpriseProjectReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Invalid project read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Invalid project read input")
	}
	return input, nil
}

func validateEnterpriseProjectReadPermit(input enterpriseProjectReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment ||
		permit.ActorUID != verified.ActorUID || permit.Resource != "projects" || permit.Action != "view" ||
		permit.ExpiresAt <= now.UnixMilli() || permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_project_permit_invalid", "Project read authorization is invalid")
	}
	return nil
}

func enterpriseProjectReadTarget(action string, input enterpriseProjectReadInput, actorUID string) (string, url.Values, error) {
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Project read query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		switch key {
		// 键名以 Aims 实际读取的为准。项目 store 在发送前已把驼峰转成蛇形
		// （params.set('lifecycle_status', …)），所以蛇形才是真正的线上格式；
		// 驼峰保留为兼容入口，并在此翻译，否则会被 Aims 静默忽略。
		case "lifecycleStatus":
			query.Set("lifecycle_status", value)
		case "portfolioId":
			query.Set("portfolio_id", value)
		case "participatingOnly":
			query.Set("participating_only", value)
		case "page", "pageSize", "search", "category", "includeArchived",
			"lifecycle_status", "portfolio_id", "participating_only",
			"domain_code", "dept_code", "leader_uid":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Project read query is invalid")
		}
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	switch action {
	case "list":
		return "/v1/aims/projects", query, nil
	case "view":
		if !enterpriseProjectID.MatchString(input.ProjectID) {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Project ID is invalid")
		}
		// Keep this conversion explicit: the regex already rejects leading signs,
		// zero and oversized non-numeric identifiers.
		if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_input_invalid", "Project ID is invalid")
		}
		return "/v1/aims/projects/" + input.ProjectID, query, nil
	default:
		return "", nil, httperror.New(http.StatusNotFound, "enterprise_project_operation_unknown", "Project read operation is not registered")
	}
}
