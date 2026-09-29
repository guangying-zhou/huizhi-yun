package server

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDepartmentCabinetSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-cabinet", ErrorCode: "enterprise_codocs_department_cabinet",
	Actions: map[string]enterpriseDelegatedAction{
		"folders":         {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"page", "pageSize", "parent_id"}},
		"list":            {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"page", "pageSize", "folder_id"}},
		"view":            {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"uuid"}},
		"converted-info":  {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"uuid"}},
		"download":        {Method: http.MethodGet, PermitAction: "export", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"uuid"}},
		"upload-plan":     {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"upload":          {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"update":          {Method: http.MethodPatch, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"delete":          {Method: http.MethodDelete, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"folder-create":   {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"folder-update":   {Method: http.MethodPatch, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"folder-delete":   {Method: http.MethodDelete, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"conversion-plan": {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"convert":         {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
		"publish-record":  {Method: http.MethodPost, PermitAction: "publish", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
	},
}

var enterpriseCodocsDepartmentCabinetRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDepartmentCabinetSpec)

func departmentCabinetQuery(input enterpriseDelegatedInput, route enterpriseDelegatedRoute, actor string) (url.Values, error) {
	query, err := enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	query.Set("codocs_trusted_cabinet_department_dept_code", input.Code)
	if route.Action == "folders" || route.Action == "list" {
		for key, fallback := range map[string]int{"page": 1, "pageSize": 20} {
			value := fallback
			if raw := query.Get(key); raw != "" {
				value, err = strconv.Atoi(raw)
				if err != nil || value < 1 || (key == "pageSize" && value > 200) || (key == "page" && value > 1000000) || strconv.Itoa(value) != raw {
					return nil, httperror.New(400, "department_cabinet_pagination_invalid", "Invalid pagination")
				}
			}
			query.Set(key, strconv.Itoa(value))
		}
		for _, key := range []string{"folder_id", "parent_id"} {
			if err := validateDepartmentReadID(query, key); err != nil {
				return nil, err
			}
		}
	}
	if uuid := query.Get("uuid"); uuid != "" && !enterpriseCodocsDocumentReads.Actions["view"].CodePattern.MatchString(uuid) {
		return nil, httperror.New(400, "department_cabinet_uuid_invalid", "Invalid file ID")
	}
	if (route.Action == "view" || route.Action == "download" || route.Action == "converted-info") && query.Get("uuid") == "" {
		return nil, httperror.New(400, "department_cabinet_uuid_invalid", "File ID is required")
	}
	return query, nil
}

func (s *Server) routeEnterpriseCodocsDepartmentCabinet(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.codocs == nil || s.directory == nil {
		return routeResult{}, httperror.New(503, "department_cabinet_unavailable", "Department cabinet unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "codocs", LogicalTarget: "codocs",
	}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.codocs.department-cabinet." + route.Action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "department_cabinet_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseDelegatedInput(body, route.Spec)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseDelegatedPermit(input, verified, route.Spec, route.Spec.Actions[route.Action], time.Now()); err != nil {
		return result, err
	}
	query, err := departmentCabinetQuery(input, route, verified.ActorUID)
	if err != nil {
		return result, err
	}
	if route.Action == "folders" || route.Action == "list" || route.Action == "view" || route.Action == "converted-info" || route.Action == "download" {
		role, roleErr := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), verified.ActorUID, input.Code)
		if roleErr != nil {
			return result, enterpriseCodocsDirectoryError(roleErr)
		}
		if !role.CanRead() {
			return result, httperror.New(403, "department_access_denied", "Department access denied")
		}
		var value any
		switch route.Action {
		case "folders":
			value, err = s.codocs.DepartmentCabinetFolders(r.Context(), query)
		case "list":
			value, err = s.codocs.DepartmentCabinetList(r.Context(), query)
		case "converted-info":
			value, err = s.codocs.DepartmentCabinetConvertedInfo(r.Context(), query.Get("uuid"), query)
		default:
			value, err = s.codocs.DepartmentCabinetFile(r.Context(), query.Get("uuid"), query)
		}
		result.Body = map[string]any{"success": err == nil, "data": value}
		return result, err
	}
	identity := codocsapp.EnterpriseDepartmentCabinetIdentity{
		Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
		Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key"), Department: input.Code,
	}
	lockedRole, release, err := s.lockEnterpriseCodocsDepartment(r.Context(), verified.ActorUID, input.Code)
	if err != nil {
		return result, err
	}
	defer release()
	check := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
		if e := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); e != nil {
			return e
		}
		if route.Action == "publish-record" && !lockedRole.CanRead() || route.Action != "publish-record" && !lockedRole.CanManage() {
			return httperror.New(403, "department_manager_required", "Department manager required")
		}
		return nil
	}
	value, commandErr := s.codocs.EnterpriseDepartmentCabinetCommand(r.Context(), identity, route.Action, input.Payload, check)
	result.Body = map[string]any{"success": commandErr == nil, "data": value}
	return result, commandErr
}
