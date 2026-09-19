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

var enterpriseProjectMemberPaths = map[string]struct{ action, capability string }{"/v1/enterprise/aims/project-members:add": {"add", aimsapp.EnterpriseProjectMemberAddCapability}, "/v1/enterprise/aims/project-members:role": {"role", aimsapp.EnterpriseProjectMemberRoleCapability}, "/v1/enterprise/aims/project-members:remove": {"remove", aimsapp.EnterpriseProjectMemberRemoveCapability}}

type enterpriseProjectMemberPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ProjectID  string `json:"projectId"`
	Allowed    bool   `json:"allowed"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseProjectMemberInput struct {
	Personnel     []aimsapp.EnterprisePersonnelPermit `json:"personnel"`
	Tenant        string                              `json:"tenant"`
	Deployment    string                              `json:"deployment"`
	ProjectID     string                              `json:"projectId"`
	Input         map[string]any                      `json:"input"`
	Authorization enterpriseProjectMemberPermit       `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectMemberWrite(r *http.Request, spec struct{ action, capability string }) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_members_unavailable", "Unified project member writes are not enabled")
	}
	if r.URL.RawQuery != "" {
		return routeResult{}, httperror.New(400, "enterprise_project_member_input_invalid", "Query parameters are not supported")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims", Action: "execute", Capability: spec.capability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-members." + spec.action, Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 {
		return result, httperror.New(400, "enterprise_project_member_key_invalid", "Idempotency-Key is required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	var input enterpriseProjectMemberInput
	raw, _ := json.Marshal(body)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Input == nil {
		return result, httperror.New(400, "enterprise_project_member_input_invalid", "Invalid project member input")
	}
	if err = validateEnterpriseProjectMemberPermit(input, verified, spec.action, time.Now()); err != nil {
		return result, err
	}
	out, err := s.aims.WriteEnterpriseProjectMember(r.Context(), aimsapp.EnterpriseProjectMemberIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, Personnel: input.Personnel}, input.ProjectID, spec.action, input.Input)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}

func validateEnterpriseProjectMemberPermit(input enterpriseProjectMemberInput, verified enterpriseRequestContext, action string, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "project-members" || p.Action != action || p.ProjectID != input.ProjectID || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_member_permit_invalid", "Project member authorization is invalid")
	}
	return nil
}
