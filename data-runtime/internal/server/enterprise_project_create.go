package server

import (
	"bytes"
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/http"
	"strings"
	"time"
)

const enterpriseProjectCreatePath = "/v1/enterprise/aims/projects:create"

type enterpriseProjectCreatePermit struct {
	ActorUID       string                   `json:"actorUid"`
	Tenant         string                   `json:"tenant"`
	Deployment     string                   `json:"deployment"`
	Resource       string                   `json:"resource"`
	Action         string                   `json:"action"`
	Allowed        bool                     `json:"allowed"`
	ExpiresAt      int64                    `json:"expiresAt"`
	ProjectCode    string                   `json:"projectCode"`
	DeptCode       string                   `json:"deptCode"`
	ProjectID      string                   `json:"projectId"`
	WorkItemID     string                   `json:"workItemId"`
	Scope          *projectscope.Projection `json:"scope"`
	BundleVersion  string                   `json:"bundleVersion"`
	BundleHash     string                   `json:"bundleHash"`
	PolicyRevision *int64                   `json:"policyRevision"`
}
type enterpriseProjectCreateInput struct {
	Personnel     []aimsapp.EnterprisePersonnelPermit `json:"personnel"`
	Tenant        string                              `json:"tenant"`
	Deployment    string                              `json:"deployment"`
	Input         map[string]any                      `json:"input"`
	Authorization enterpriseProjectCreatePermit       `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectCreate(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_create_unavailable", "Unified project creation is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.projects.create", Auth: &verified.Service, Status: http.StatusCreated}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_project_create_input_invalid", "Query parameters are not supported")
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 {
		return result, httperror.New(400, "enterprise_project_create_key_invalid", "Idempotency-Key is required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectCreateInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectCreatePermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	descendants := map[string][]string{}
	if len(input.Authorization.Scope.DepartmentTreeRoots) > 0 {
		if s.directory == nil {
			return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), input.Authorization.Scope.DepartmentTreeRoots)
		if err != nil {
			return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
	}
	out, err := s.aims.CreateEnterpriseProject(r.Context(), aimsapp.EnterpriseProjectCreateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, Personnel: input.Personnel, CreateScope: &aimsapp.EnterpriseProjectCommandScope{Projection: *input.Authorization.Scope, Descendants: descendants, ExpiresAt: input.Authorization.ExpiresAt}, ProjectCode: input.Authorization.ProjectCode, DeptCode: input.Authorization.DeptCode}, input.Input)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
func decodeEnterpriseProjectCreateInput(body map[string]any) (enterpriseProjectCreateInput, error) {
	var input enterpriseProjectCreateInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_project_create_input_invalid", "Invalid project create input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil || input.Input == nil {
		return input, httperror.New(400, "enterprise_project_create_input_invalid", "Invalid project create input")
	}
	return input, nil
}
func validateEnterpriseProjectCreatePermit(input enterpriseProjectCreateInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "projects" || p.Action != "create" || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() || p.ProjectID != "" || p.WorkItemID != "" || p.ProjectCode == "" || p.ProjectCode != strings.TrimSpace(firstProjectCreateText(input.Input, "projectCode")) || p.DeptCode != strings.TrimSpace(firstProjectCreateText(input.Input, "deptCode")) || p.Scope == nil || p.Scope.Validate() != nil || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 {
		return httperror.New(403, "enterprise_project_create_permit_invalid", "Project create authorization is invalid")
	}
	return nil
}

func firstProjectCreateText(input map[string]any, key string) string {
	value, _ := input[key].(string)
	return value
}
