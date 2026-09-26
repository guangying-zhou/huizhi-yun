package server

import (
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Directory-self never accepts a user identifier from the request. The actor
// comes solely from the signed Enterprise delegation verified below.
func (s *Server) routeEnterpriseDirectorySelf(r *http.Request, path string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.directory == nil {
		return routeResult{}, httperror.New(503, "enterprise_directory_self_unavailable", "Directory projection is unavailable")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "console", LogicalTarget: "console", Capability: "console:directory-self:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.console.directory-self.read", Auth: &verified.Service}
	if err := validateDirectorySelfInput(r); err != nil {
		return result, err
	}
	var projection any
	if path == "/v1/enterprise/console/directory-self:departments" {
		projection, err = s.directory.EnterpriseSelfDepartments(r.Context(), verified.ActorUID)
	} else {
		projection, err = s.directory.ConsoleUserProjects(r.Context(), verified.ActorUID, url.Values{})
		if err == nil {
			projection = directorySelfProjects(projection)
		}
	}
	if err != nil || projection == nil {
		return result, httperror.New(503, "directory_self_dependency_unavailable", "Directory projection is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": projection}
	return result, nil
}

func validateDirectorySelfInput(r *http.Request) error {
	if r.URL.RawQuery != "" {
		return httperror.New(400, "directory_self_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return err
	}
	if len(body) != 0 {
		return httperror.New(400, "directory_self_input_invalid", "Directory-self accepts no input fields")
	}
	return nil
}

func directorySelfProjects(raw any) any {
	value, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	managed, ok1 := value["managed"].([]map[string]any)
	joined, ok2 := value["joined"].([]map[string]any)
	if !ok1 || !ok2 {
		return nil
	}
	project := func(rows []map[string]any) []map[string]any {
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			out = append(out, map[string]any{"projectCode": row["projectCode"], "name": row["name"], "subProjects": []any{}})
		}
		return out
	}
	return map[string]any{"managed": project(managed), "joined": project(joined)}
}
