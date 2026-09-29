package server

import (
	"bytes"
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
	"time"
)

const enterpriseProjectUpdatePath = "/v1/enterprise/aims/projects:update"
const enterpriseAdminProjectUpdatePath = "/v1/enterprise/aims/admin-projects:update"

func (s *Server) routeEnterpriseProjectUpdate(r *http.Request, admin bool) (routeResult, error) {
	operation := "enterprise.aims.projects.update"
	if admin {
		operation = "enterprise.aims.admin-projects.update"
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: operation, Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 {
		return result, httperror.New(400, "enterprise_project_update_key_invalid", "Idempotency-Key is required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	var input struct {
		Personnel     []aimsapp.EnterprisePersonnelPermit `json:"personnel"`
		Tenant        string                              `json:"tenant"`
		Deployment    string                              `json:"deployment"`
		ProjectID     string                              `json:"projectId"`
		Input         map[string]any                      `json:"input"`
		Authorization struct {
			ActorUID   string `json:"actorUid"`
			Tenant     string `json:"tenant"`
			Deployment string `json:"deployment"`
			Resource   string `json:"resource"`
			Action     string `json:"action"`
			ProjectID  string `json:"projectId"`
			Mode       string `json:"mode"`
			Allowed    bool   `json:"allowed"`
			ExpiresAt  int64  `json:"expiresAt"`
		} `json:"authorization"`
	}
	raw, _ := json.Marshal(body)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Input == nil {
		return result, httperror.New(400, "enterprise_project_update_input_invalid", "Invalid project update input")
	}
	p := input.Authorization
	if err = validateEnterpriseProjectUpdatePermit(input.Tenant, input.Deployment, input.ProjectID, p, verified, time.Now(), admin); err != nil {
		return result, err
	}
	_, securityChanged := input.Input["securityLevel"]
	_, confidentialityChanged := input.Input["confidentialityLevel"]
	_, whitelistChanged := input.Input["accessWhitelist"]
	if (securityChanged || confidentialityChanged || whitelistChanged) && !p.Allowed {
		return result, httperror.New(403, "project_access_control_edit_scope_required", "Scoped project edit access required")
	}
	out, err := s.aims.UpdateEnterpriseProject(r.Context(), aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, Personnel: input.Personnel, StaticProjectEdit: p.Mode == "static-or-project-manager" && p.Allowed, AdminProject: admin}, input.ProjectID, input.Input)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}

func validateEnterpriseProjectUpdatePermit(tenant, deployment, projectID string, p struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ProjectID  string `json:"projectId"`
	Mode       string `json:"mode"`
	Allowed    bool   `json:"allowed"`
	ExpiresAt  int64  `json:"expiresAt"`
}, verified enterpriseRequestContext, now time.Time, admin bool) error {
	validMode := validProjectWriteAuthorizationMode(p.Mode, p.Allowed)
	resource, action := "projects", "edit"
	if admin {
		resource, action = "admin", "admin"
		validMode = p.Mode == "admin-static" && p.Allowed
	}
	if tenant != verified.Route.Binding.Tenant || deployment != verified.Route.HostDeployment || p.Tenant != tenant || p.Deployment != deployment || p.ActorUID != verified.ActorUID || p.Resource != resource || p.Action != action || p.ProjectID != projectID || !validMode || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_update_permit_invalid", "Project update authorization is invalid")
	}
	return nil
}

func validProjectWriteAuthorizationMode(mode string, allowed bool) bool {
	return (mode == "" && allowed) || mode == "static-or-project-manager"
}
