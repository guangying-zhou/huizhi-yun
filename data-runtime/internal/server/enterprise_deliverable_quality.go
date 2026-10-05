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

var enterpriseQualityPaths = map[string]string{
	"/v1/enterprise/aims/deliverable-quality:submission-resume":   "submission-resume",
	"/v1/enterprise/aims/deliverable-quality:submission-create":   "submission-create",
	"/v1/enterprise/aims/deliverable-quality:submission-activate": "submission-activate",
	"/v1/enterprise/aims/deliverable-quality:completeness":        "completeness",
	"/v1/enterprise/aims/deliverable-quality:waiver":              "waiver",
}

type enterpriseQualityInput struct {
	Tenant        string                                `json:"tenant"`
	Deployment    string                                `json:"deployment"`
	ProjectID     string                                `json:"projectId"`
	ObjectID      string                                `json:"objectId"`
	Input         map[string]any                        `json:"input"`
	ProjectScope  map[string]string                     `json:"projectScope"`
	Authorization enterpriseDelegatedProjectWritePermit `json:"authorization"`
	Facts         aimsapp.EnterpriseQualityFacts        `json:"facts"`
}

func validateEnterpriseQualityPermit(input enterpriseQualityInput, verified enterpriseRequestContext, action string, now time.Time) error {
	p := input.Authorization
	_, ok := enterpriseQualityPaths["/v1/enterprise/aims/deliverable-quality:"+action]
	if !ok || !enterpriseProjectID.MatchString(input.ProjectID) || !enterpriseProjectID.MatchString(input.ObjectID) {
		return httperror.New(400, "quality_input_invalid", "Invalid quality target")
	}
	resource, permitAction := "projects", "view"
	if action == "waiver" {
		resource, permitAction = "quality_reviews", "waive"
	}

	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != resource || p.Action != permitAction || !p.Allowed || p.ProjectID != input.ProjectID || p.ObjectID != input.ObjectID || p.WorkItemID != "" || p.SubID != "" || p.Scope == nil || p.Scope.Validate() != nil || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "quality_permit_invalid", "Quality authorization is invalid")
	}
	return nil
}
func (s *Server) routeEnterpriseQualityWrite(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_quality_unavailable", "Unified quality writes are unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.quality." + action, Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 || r.URL.RawQuery != "" {
		return result, httperror.New(400, "quality_input_invalid", "Idempotency-Key is required and query is unsupported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, _ := json.Marshal(body)
	var input enterpriseQualityInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Input == nil {
		return result, httperror.New(400, "quality_input_invalid", "Invalid quality input")
	}
	if err = validateEnterpriseQualityPermit(input, verified, action, time.Now()); err != nil {
		return result, err
	}
	for key := range input.ProjectScope {
		if !enterpriseDelegatedScopeKey.MatchString(key) {
			return result, httperror.New(400, "quality_input_invalid", "Invalid project scope field")
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
	out, err := s.aims.WriteEnterpriseDeliverableQuality(r.Context(), identity, input.ProjectID, input.ObjectID, action, input.Input, input.Facts)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
