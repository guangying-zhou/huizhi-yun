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

func (s *Server) routeEnterpriseProjectUpdate(r *http.Request) (routeResult, error) {
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims", Capability: aimsapp.EnterpriseProjectUpdateCapability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.projects.update", Auth: &verified.Service}
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
	if err = validateEnterpriseProjectUpdatePermit(input.Tenant, input.Deployment, input.ProjectID, p, verified, time.Now()); err != nil {
		return result, err
	}
	out, err := s.aims.UpdateEnterpriseProject(r.Context(), aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, Personnel: input.Personnel}, input.ProjectID, input.Input)
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
	Allowed    bool   `json:"allowed"`
	ExpiresAt  int64  `json:"expiresAt"`
}, verified enterpriseRequestContext, now time.Time) error {
	if tenant != verified.Route.Binding.Tenant || deployment != verified.Route.HostDeployment || p.Tenant != tenant || p.Deployment != deployment || p.ActorUID != verified.ActorUID || p.Resource != "projects" || p.Action != "edit" || p.ProjectID != projectID || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_update_permit_invalid", "Project update authorization is invalid")
	}
	return nil
}
