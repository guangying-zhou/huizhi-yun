package server

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"time"
)

type enterpriseProjectOutputInput struct {
	Tenant                   string                             `json:"tenant"`
	Deployment               string                             `json:"deployment"`
	ProjectID                string                             `json:"projectId"`
	Query                    map[string]string                  `json:"query"`
	Authorization            enterpriseDelegatedPermit          `json:"authorization"`
	ProjectReadAuthorization *enterpriseNestedProjectReadPermit `json:"projectReadAuthorization"`
}

func validateProjectOutputInput(in enterpriseProjectOutputInput, v enterpriseRequestContext, now time.Time) (url.Values, error) {
	p := in.Authorization
	if in.Tenant != v.Route.Binding.Tenant || in.Deployment != v.Route.HostDeployment || p.Tenant != in.Tenant || p.Deployment != in.Deployment || p.ActorUID != v.ActorUID || p.Resource != "projects" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return nil, httperror.New(403, "project_output_permit_invalid", "Project output authorization invalid")
	}
	if err := requireEnterpriseDelegatedID(in.ProjectID, true); err != nil {
		return nil, err
	}
	if err := validateNestedProjectReadPermit(in.Tenant, in.Deployment, in.ProjectID, in.ProjectReadAuthorization, v, now); err != nil {
		return nil, err
	}
	q := url.Values{"current_user": {v.ActorUID}}
	for k, value := range in.Query {
		if value == "" || len(value) > 1000 || (!enterpriseProjectScopeKey.MatchString(k) && k != "page" && k != "pageSize") {
			return nil, httperror.New(400, "project_output_input_invalid", "Invalid output query")
		}
		q.Set(k, value)
	}
	return q, nil
}
func (s *Server) routeEnterpriseProjectOutput(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "project_output_unavailable", "Project output unavailable")
	}
	v, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-output.view", Auth: &v.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "project_output_input_invalid", "Query unsupported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var in enterpriseProjectOutputInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil {
		return result, httperror.New(400, "project_output_input_invalid", "Invalid output input")
	}
	q, err := validateProjectOutputInput(in, v, time.Now())
	if err != nil {
		return result, err
	}
	ctx, err := s.nestedProjectReadContext(r, in.ProjectID, in.ProjectReadAuthorization, q)
	if err != nil {
		return result, err
	}
	result.Body, err = s.aims.ReadEnterpriseProjectOutput(ctx, in.ProjectID, q)
	return result, err
}
