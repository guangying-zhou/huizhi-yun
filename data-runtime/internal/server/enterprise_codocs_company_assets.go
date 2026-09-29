package server

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsCompanyAssetsSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "company-assets", ErrorCode: "enterprise_codocs_company_assets",
	Actions: map[string]enterpriseDelegatedAction{
		"record-access":             {Method: http.MethodPost, PermitAction: "record-access", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/access-records" }},
		"access-records":            {Method: http.MethodGet, PermitAction: "admin", QueryKeys: []string{"path", "from", "to", "page", "pageSize"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/access-records" }},
		"export-access-records":     {Method: http.MethodGet, PermitAction: "export", QueryKeys: []string{"path", "from", "to"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/access-records/export" }},
		"quick-publish-source":      {Method: http.MethodGet, PermitAction: "publish", QueryKeys: []string{"deptCode", "folderId", "page", "pageSize"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/quick-publish/source" }},
		"quick-publish-prepare":     {Method: http.MethodPost, PermitAction: "publish", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/quick-publish/prepare" }},
		"quick-publish-complete":    {Method: http.MethodPost, PermitAction: "publish", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/quick-publish/complete" }},
		"mkdir-prepare":             {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/mkdir/prepare" }},
		"mkdir-complete":            {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/mkdir/complete" }},
		"delete-directory-prepare":  {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/delete-directory/prepare" }},
		"delete-directory-complete": {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/delete-directory/complete" }},
		"move-prepare":              {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/move/prepare" }},
		"move-complete":             {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/move/complete" }},
		"archive-prepare":           {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/archive/prepare" }},
		"archive-complete":          {Method: http.MethodPost, PermitAction: "admin", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/company-assets/archive/complete" }},
	},
}

var enterpriseCodocsOpenDepartmentSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "open-department-documents", ErrorCode: "enterprise_codocs_open_department",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {Method: http.MethodGet, PermitAction: "read", Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/open-department-documents" }},
		"view": {Method: http.MethodGet, PermitAction: "read", CodePattern: regexp.MustCompile(`^[a-fA-F0-9-]{36}$`), Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/open-department-documents" }},
	},
}

var enterpriseCodocsPublishedAssetLinksSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "published-asset-links", ErrorCode: "enterprise_codocs_published_asset_links",
	Actions: map[string]enterpriseDelegatedAction{
		"create":  {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/published-asset-links" }},
		"resolve": {Method: http.MethodGet, PermitAction: "resolve", CodePattern: regexp.MustCompile(`^[A-Za-z0-9_-]{16}$`), Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/published-asset-links/" + in.Code }},
	},
}

var enterpriseCodocsCompanyAssetsRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsCompanyAssetsSpec, enterpriseCodocsOpenDepartmentSpec, enterpriseCodocsPublishedAssetLinksSpec)

func enterpriseCodocsCompanyAssetsQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	var spec enterpriseDelegatedSpec
	switch {
	case strings.HasPrefix(action, "quick-publish-") || strings.HasPrefix(action, "mkdir-") || strings.HasPrefix(action, "delete-directory-") || strings.HasPrefix(action, "move-") || strings.HasPrefix(action, "archive-") || action == "record-access" || action == "access-records" || action == "export-access-records":
		spec = enterpriseCodocsCompanyAssetsSpec
	case action == "list" || action == "view":
		spec = enterpriseCodocsOpenDepartmentSpec
	case action == "create" || action == "resolve":
		spec = enterpriseCodocsPublishedAssetLinksSpec
	default:
		return nil, httperror.New(400, "enterprise_codocs_company_assets_input_invalid", "Invalid action")
	}
	act := spec.Actions[action]
	query, err := enterpriseDelegatedQuery(input, spec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	query.Set("hzy_runtime_source_app", "codocs")
	switch action {
	case "record-access":
		path, pathOK := input.Payload["path"].(string)
		eventID, eventOK := input.Payload["eventId"].(string)
		if !pathOK || !eventOK || len(input.Payload) != 2 {
			return nil, httperror.New(400, spec.ErrorCode+"_input_invalid", "Invalid access record")
		}
		query.Set("path", path)
		query.Set("eventId", eventID)
		query.Set("codocs_trusted_company_asset_access_action", "record")
	case "access-records":
		query.Set("codocs_trusted_company_asset_access_action", "list")
	case "export-access-records":
		query.Set("codocs_trusted_company_asset_access_action", "export")
	case "quick-publish-prepare", "quick-publish-complete":
		query.Set("codocs_trusted_company_quick_publish", "1")
	case "create":
		path, ok := input.Payload["path"].(string)
		if !ok || len(input.Payload) != 1 {
			return nil, httperror.New(400, spec.ErrorCode+"_input_invalid", "Invalid link target")
		}
		query.Set("path", path)
		query.Set("codocs_trusted_published_asset_link_action", "create")
	case "resolve":
		query.Set("codocs_trusted_published_asset_link_action", "resolve")
	case "view":
		query.Set("uuid", input.Code)
		// Set server-side only (the browser query allowlist cannot carry it): the
		// single-document view is the authorization point for reading a v2 body,
		// so the Host receives the exact snapshot reference with the metadata.
		query.Set("include_snapshot_ref", "1")
	}
	return query, nil
}

func (s *Server) routeEnterpriseCodocsCompanyAssets(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	return s.routeEnterpriseCodocsOperation(r, route, enterpriseCodocsCompanyAssetsQuery)
}

// Department OSS objects use the same receipt table, but their current
// relationship must be checked by Runtime after the service/permit gate.
func (s *Server) requireEnterpriseCodocsDepartmentAssetRelation(r *http.Request, actor, path string) error {
	if !strings.HasPrefix(path, "codocs/departments/") {
		return nil
	}
	parts := strings.Split(path, "/")
	if len(parts) < 5 || parts[2] == "" || parts[2] == "." || parts[2] == ".." || !enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern.MatchString(parts[2]) {
		return httperror.New(400, "department_asset_path_invalid", "Invalid department asset path")
	}
	if s.directory == nil {
		return httperror.New(503, "department_directory_unavailable", "Directory unavailable")
	}
	role, err := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), actor, parts[2])
	if err != nil {
		return enterpriseCodocsDirectoryError(err)
	}
	if !role.CanRead() {
		return httperror.New(403, "department_access_denied", "Department access denied")
	}
	return nil
}

// Called only after the shared Enterprise service credential, actor delegation,
// exact capability, signed permit, and action-specific payload/query validation.
// In particular, Host writes never reach the legacy adapter write handlers.
func (s *Server) executeEnterpriseCodocsCompanyAssets(r *http.Request, route enterpriseDelegatedRoute, input enterpriseDelegatedInput, query url.Values, verified enterpriseRequestContext) (any, error) {
	identity := codocsapp.EnterpriseCompanyCommandIdentity{
		Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment,
		TargetDeployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID,
		Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key"),
	}
	var value map[string]any
	var err error
	switch route.Spec.Resource {
	case "company-assets":
		switch route.Action {
		case "record-access":
			if err = s.requireEnterpriseCodocsDepartmentAssetRelation(r, verified.ActorUID, input.Payload["path"].(string)); err != nil {
				return nil, err
			}
			value, err = s.codocs.RecordEnterpriseCompanyAssetAccess(r.Context(), identity, input.Payload["path"].(string), input.Payload["eventId"].(string))
		case "quick-publish-source":
			value, err = s.codocs.EnterpriseCompanyQuickPublishSource(r.Context(), query)
		case "quick-publish-prepare":
			value, err = s.codocs.PrepareEnterpriseCompanyQuickPublish(r.Context(), identity, input.Payload)
		case "quick-publish-complete":
			value, err = s.codocs.CompleteEnterpriseCompanyQuickPublish(r.Context(), identity, input.Payload)
		case "access-records", "export-access-records":
			body, _, readErr := s.codocs.HandleRuntime(r.Context(), http.MethodGet, route.Spec.Actions[route.Action].Target(input), query, nil)
			return body, readErr
		default:
			for _, action := range []string{"mkdir", "delete-directory", "move", "archive"} {
				for _, phase := range []string{"prepare", "complete"} {
					if route.Action == action+"-"+phase {
						if action == "archive" {
							if err = s.requireEnterpriseCodocsDepartmentAssetRelation(r, verified.ActorUID, stringValue(input.Payload["sourcePath"])); err != nil {
								return nil, err
							}
						}
						value, err = s.codocs.EnterpriseCompanyAssetMutation(r.Context(), identity, action, phase, input.Payload)
						return map[string]any{"success": err == nil, "data": value}, err
					}
				}
			}
			return nil, httperror.New(404, "enterprise_codocs_company_action_unknown", "Company asset action is not registered")
		}
	case "open-department-documents":
		body, _, readErr := s.codocs.HandleRuntime(r.Context(), http.MethodGet, route.Spec.Actions[route.Action].Target(input), query, nil)
		return body, readErr
	case "published-asset-links":
		switch route.Action {
		case "create":
			value, err = s.codocs.CreateEnterprisePublishedAssetLink(r.Context(), identity, input.Payload["path"].(string))
		case "resolve":
			body, _, readErr := s.codocs.HandleRuntime(r.Context(), http.MethodGet, route.Spec.Actions[route.Action].Target(input), query, nil)
			return body, readErr
		default:
			return nil, httperror.New(404, "enterprise_codocs_link_action_unknown", "Published link action is not registered")
		}
	default:
		return nil, httperror.New(404, "enterprise_codocs_company_resource_unknown", "Company resource is not registered")
	}
	return map[string]any{"success": err == nil, "data": value}, err
}
