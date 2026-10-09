package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const enterpriseAdminProjectListPath = "/v1/enterprise/aims/admin-projects:list"

type enterpriseAdminProjectPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	Mode       string `json:"mode"`
	Allowed    bool   `json:"allowed"`
	ExpiresAt  int64  `json:"expiresAt"`
}

func (s *Server) routeEnterpriseAdminProjectList(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_admin_projects_unavailable", "Admin project reader unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.admin-projects.list", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "admin_projects_query_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	var input struct {
		Tenant        string                       `json:"tenant"`
		Deployment    string                       `json:"deployment"`
		Query         map[string]string            `json:"query"`
		Authorization enterpriseAdminProjectPermit `json:"authorization"`
	}
	raw, _ := json.Marshal(body)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return result, httperror.New(400, "admin_projects_input_invalid", "Invalid admin project request")
	}
	p := input.Authorization
	if err := validateEnterpriseAdminProjectPermit(input.Tenant, input.Deployment, p, verified, time.Now()); err != nil {
		return result, err
	}
	out, err := s.aims.EnterpriseAdminProjects(r.Context(), input.Query)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}

func validateEnterpriseAdminProjectPermit(tenant, deployment string, p enterpriseAdminProjectPermit, verified enterpriseRequestContext, now time.Time) error {
	if tenant != verified.Route.Binding.Tenant || deployment != verified.Route.HostDeployment || p.Tenant != tenant || p.Deployment != deployment || p.ActorUID != verified.ActorUID || p.Resource != "admin" || p.Action != "admin" || p.Mode != "admin-static" || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "admin_projects_permit_invalid", "Admin project authorization invalid")
	}
	return nil
}
