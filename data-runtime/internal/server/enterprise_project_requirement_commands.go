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

var enterpriseProjectRequirementWritePaths = map[string]string{
	"/v1/enterprise/aims/project-requirements:review-sync":         "review-sync",
	"/v1/enterprise/aims/project-requirements:review-create-tasks": "review-create-tasks",
	"/v1/enterprise/aims/project-requirements:create":              "create",
	"/v1/enterprise/aims/project-requirements:content-create":      "content-create",
	"/v1/enterprise/aims/project-requirements:import":              "import",
	"/v1/enterprise/aims/project-requirements:update":              "update",
	"/v1/enterprise/aims/project-requirements:delete":              "delete",
	"/v1/enterprise/aims/project-requirements:content-update":      "content-update",
	"/v1/enterprise/aims/project-requirements:content-delete":      "content-delete",
	"/v1/enterprise/aims/project-requirements:content-restore":     "content-restore",
	"/v1/enterprise/aims/project-requirements:change-create":       "change-create",
	"/v1/enterprise/aims/project-requirements:task-create":         "task-create",
	"/v1/enterprise/aims/project-requirements:review-create":       "review-create",
	"/v1/enterprise/aims/project-requirements:review-append":       "review-append",
	"/v1/enterprise/aims/project-requirements:review-withdraw":     "review-withdraw",
}

type enterpriseRequirementWriteInput struct {
	Tenant        string                                `json:"tenant"`
	Deployment    string                                `json:"deployment"`
	ProjectID     string                                `json:"projectId"`
	ObjectID      string                                `json:"objectId"`
	Input         map[string]any                        `json:"input"`
	ProjectScope  map[string]string                     `json:"projectScope"`
	Authorization enterpriseDelegatedProjectWritePermit `json:"authorization"`
}

func validateEnterpriseRequirementWritePermit(input enterpriseRequirementWriteInput, verified enterpriseRequestContext, action string, now time.Time) error {
	p := input.Authorization
	_, ok := enterpriseProjectRequirementWritePaths["/v1/enterprise/aims/project-requirements:"+action]
	needsObject := action == "review-sync" || action == "review-create-tasks" || action == "change-create" || action == "task-create" || action == "review-append" || action == "review-withdraw" || action == "update" || action == "delete" || action == "content-update" || action == "content-delete" || action == "content-restore"
	if !ok || !enterpriseProjectID.MatchString(input.ProjectID) || needsObject && !enterpriseProjectID.MatchString(input.ObjectID) || !needsObject && input.ObjectID != "" {
		return httperror.New(400, "requirement_input_invalid", "Invalid requirement target")
	}
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "requirements" || p.Action != "edit" || !p.Allowed || p.ProjectID != input.ProjectID || p.ObjectID != input.ObjectID || p.WorkItemID != "" || p.SubID != "" || p.Scope == nil || p.Scope.Validate() != nil || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "requirement_permit_invalid", "Requirement authorization is invalid")
	}
	return nil
}
func (s *Server) routeEnterpriseRequirementWrite(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_requirements_unavailable", "Unified requirement writes are unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.requirements." + action, Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 || r.URL.RawQuery != "" {
		return result, httperror.New(400, "requirement_input_invalid", "Idempotency-Key is required and query is unsupported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, _ := json.Marshal(body)
	var input enterpriseRequirementWriteInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Input == nil {
		return result, httperror.New(400, "requirement_input_invalid", "Invalid requirement input")
	}
	if err = validateEnterpriseRequirementWritePermit(input, verified, action, time.Now()); err != nil {
		return result, err
	}
	for key := range input.ProjectScope {
		if !enterpriseDelegatedScopeKey.MatchString(key) {
			return result, httperror.New(400, "requirement_input_invalid", "Invalid project scope field")
		}
	}
	descendants := map[string][]string{}
	p := input.Authorization
	if len(p.Scope.DepartmentTreeRoots) > 0 {
		if s.directory == nil {
			return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), p.Scope.DepartmentTreeRoots)
		if err != nil {
			return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
	}
	identity := aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, ProjectScope: input.ProjectScope, CommandScope: &aimsapp.EnterpriseProjectCommandScope{Projection: *p.Scope, Descendants: descendants, ExpiresAt: p.ExpiresAt}}
	out, err := s.aims.WriteEnterpriseRequirement(r.Context(), identity, input.ProjectID, input.ObjectID, action, input.Input)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
