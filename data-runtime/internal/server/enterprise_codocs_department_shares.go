package server

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDepartmentSharesSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-shares", ErrorCode: "enterprise_codocs_department_shares",
	Actions: map[string]enterpriseDelegatedAction{
		"list":   {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, QueryKeys: []string{"page", "pageSize"}},
		"decide": {Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true},
	},
}

var enterpriseCodocsDepartmentSharesRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDepartmentSharesSpec)

func (s *Server) routeEnterpriseCodocsDepartmentShares(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.codocs == nil || s.directory == nil {
		return routeResult{}, httperror.New(503, "department_shares_unavailable", "Department shares unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "codocs", LogicalTarget: "codocs"}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.codocs.department-shares." + route.Action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "department_shares_input_invalid", "Query parameters are not supported")
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
	query, err := enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID)
	if err != nil {
		return result, err
	}
	query.Del("current_user")
	query.Del("operator_uid")
	if route.Action == "list" {
		page, pageSize := 1, 20
		for key := range query {
			if key != "page" && key != "pageSize" {
				return result, httperror.New(400, "department_shares_pagination_invalid", "Invalid pagination")
			}
		}
		for key, target := range map[string]*int{"page": &page, "pageSize": &pageSize} {
			if raw := query.Get(key); raw != "" {
				value, e := strconv.Atoi(raw)
				if e != nil || value < 1 || (key == "pageSize" && value > 200) || (key == "page" && value > 1000000) || strconv.Itoa(value) != raw {
					return result, httperror.New(400, "department_shares_pagination_invalid", "Invalid pagination")
				}
				*target = value
			}
		}
		role, e := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), verified.ActorUID, input.Code)
		if e != nil {
			return result, enterpriseCodocsDirectoryError(e)
		}
		if !role.CanRead() {
			return result, httperror.New(403, "department_access_denied", "Department access denied")
		}
		value, e := s.codocs.DepartmentSharesForEnterprise(r.Context(), input.Code, page, pageSize)
		result.Body = map[string]any{"success": e == nil, "data": value}
		return result, e
	}
	if len(query) != 0 || len(input.Payload) != 1 {
		return result, httperror.New(400, "department_shares_input_invalid", "Invalid decision input")
	}
	action, ok := input.Payload["action"].(string)
	if !ok || (action != "accept" && action != "reject") {
		return result, httperror.New(400, "department_shares_input_invalid", "Invalid decision action")
	}
	shareID, err := strconv.ParseInt(input.ObjectID, 10, 64)
	if err != nil || shareID < 1 || strconv.FormatInt(shareID, 10) != input.ObjectID {
		return result, httperror.New(400, "department_shares_id_invalid", "Invalid share ID")
	}
	identity := codocsapp.EnterpriseDepartmentShareIdentity{Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key"), Department: input.Code}
	lockedRole, release, err := s.lockEnterpriseCodocsDepartment(r.Context(), verified.ActorUID, input.Code)
	if err != nil {
		return result, err
	}
	defer release()
	check := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
		if e := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); e != nil {
			return e
		}
		if !lockedRole.CanManage() {
			return httperror.New(403, "department_manager_required", "Department manager required")
		}
		return nil
	}
	value, e := s.codocs.DecideEnterpriseDepartmentShare(r.Context(), identity, shareID, action, check)
	result.Body = map[string]any{"success": e == nil, "data": value}
	return result, e
}
