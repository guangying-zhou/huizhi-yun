package server

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const enterpriseProjectBoardPath = "/v1/enterprise/aims/project-board:view"

type enterpriseProjectBoardPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseProjectBoardInput struct {
	Tenant        string                       `json:"tenant"`
	Deployment    string                       `json:"deployment"`
	ProjectID     string                       `json:"projectId"`
	Query         map[string]string            `json:"query"`
	Authorization enterpriseProjectBoardPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectBoard(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_board_unavailable", "Unified project board reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:project-board:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project_board.view", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_project_board_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectBoardInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectBoardPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, q, err := enterpriseProjectBoardTarget(input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, q, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}
func decodeEnterpriseProjectBoardInput(body map[string]any) (enterpriseProjectBoardInput, error) {
	var input enterpriseProjectBoardInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_project_board_input_invalid", "Invalid project board input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil {
		return input, httperror.New(400, "enterprise_project_board_input_invalid", "Invalid project board input")
	}
	return input, nil
}
func validateEnterpriseProjectBoardPermit(input enterpriseProjectBoardInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "project-board" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_board_permit_invalid", "Project board authorization is invalid")
	}
	return nil
}
func enterpriseProjectBoardTarget(input enterpriseProjectBoardInput, actor string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(400, "enterprise_project_board_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(400, "enterprise_project_board_input_invalid", "Project ID is invalid")
	}
	q := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 || !enterpriseProjectScopeKey.MatchString(key) {
			return "", nil, httperror.New(400, "enterprise_project_board_input_invalid", "Project board query is invalid")
		}
		q.Set(key, value)
	}
	q.Set("current_user", actor)
	q.Set("operator_uid", actor)
	return "/v1/aims/projects/" + input.ProjectID + "/board-data", q, nil
}
