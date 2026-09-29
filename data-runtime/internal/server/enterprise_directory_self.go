package server

import (
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	enterpriseDirectorySelfDepartmentsPath           = "/v1/enterprise/console/directory-self:departments"
	enterpriseDirectorySelfProjectsPath              = "/v1/enterprise/console/directory-self:projects"
	enterpriseDirectorySelfAccessibleDepartmentsPath = "/v1/enterprise/console/directory-self:accessible-departments"
)

// enterpriseDirectorySelfPaths is the complete fixed path set; each entry must
// match exactly one Foundation Host operation.
var enterpriseDirectorySelfPaths = map[string]string{
	enterpriseDirectorySelfDepartmentsPath:           "console.directory-self-departments",
	enterpriseDirectorySelfProjectsPath:              "console.directory-self-projects",
	enterpriseDirectorySelfAccessibleDepartmentsPath: "console.directory-self-accessible-departments",
}

// Directory-self never accepts a user identifier from the request. The actor
// comes solely from the signed Enterprise delegation verified below.
func (s *Server) routeEnterpriseDirectorySelf(r *http.Request, path string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.directory == nil {
		return routeResult{}, httperror.New(503, "enterprise_directory_self_unavailable", "Directory projection is unavailable")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "console", LogicalTarget: "console",
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
	switch path {
	case enterpriseDirectorySelfDepartmentsPath:
		projection, err = s.directory.EnterpriseSelfDepartments(r.Context(), verified.ActorUID)
	case enterpriseDirectorySelfAccessibleDepartmentsPath:
		var rows []map[string]any
		rows, err = s.directory.ConsoleAccessibleDepartments(r.Context(), verified.ActorUID)
		if err == nil {
			projection = directorySelfAccessibleDepartments(rows)
		}
	case enterpriseDirectorySelfProjectsPath:
		projection, err = s.directory.ConsoleUserProjects(r.Context(), verified.ActorUID, url.Values{})
		if err == nil {
			projection = directorySelfProjects(projection)
		}
	default:
		return result, httperror.New(http.StatusNotFound, "route_not_found", "Route not found")
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

// Accessible departments keep the standalone Aims rule (own, managed and led
// departments plus all descendants) but expose only the selector fields.
// Manager/leader identities and member lists never leave the Runtime here.
func directorySelfAccessibleDepartments(rows []map[string]any) any {
	if rows == nil {
		return nil
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		code, ok1 := row["deptCode"].(string)
		name, ok2 := row["name"].(string)
		if !ok1 || !ok2 || code == "" {
			return nil
		}
		out = append(out, map[string]any{"deptCode": code, "name": name})
	}
	return out
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
