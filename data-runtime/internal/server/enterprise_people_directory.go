package server

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

var enterprisePeopleDirectoryPaths = map[string]string{
	"/v1/enterprise/people/directory-lifecycle:prepare-due": "prepare-due",
	"/v1/enterprise/people/directory-lifecycle:claim":       "claim",
	"/v1/enterprise/people/directory-lifecycle:ack":         "ack",
	"/v1/enterprise/people/directory-lifecycle:fail":        "fail",
}

func (s *Server) routeEnterprisePeopleDirectory(r *http.Request, op string) (routeResult, error) {
	result := routeResult{Operation: "enterprise.people.directory." + op}
	identity, e := s.authenticateEnterpriseSystem(r, "people", "")
	result.Auth = &identity
	if e != nil {
		return result, e
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil {
		return result, httperror.New(503, "people_directory_unavailable", "People domain unavailable")
	}
	if e = validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); e != nil {
		return result, e
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "people_directory_input_invalid", "Query unsupported")
	}
	body, e := readJSONBody(r)
	if e != nil {
		return result, e
	}
	raw, e := json.Marshal(body)
	if e != nil {
		return result, e
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var input enterpriseapf.PeopleDirectoryInput
	if e = d.Decode(&input); e != nil {
		return result, httperror.New(400, "people_directory_input_invalid", "Invalid delivery input")
	}
	binding, e := s.cfg.EnterpriseBinding()
	if e != nil {
		return result, apfError(e)
	}
	service := enterpriseapf.PeopleFactsService{Registry: s.enterpriseRegistry, Binding: binding}
	out, e := service.Directory(r.Context(), op, input, enterpriseapf.Identity{Tenant: identity.Tenant, Deployment: s.cfg.DeploymentBindings["enterprise"], Client: identity.ClientID, RequestID: requestID(r)})
	result.Body = map[string]any{"code": 0, "data": out}
	return result, apfError(e)
}
