package server

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDepartmentAccessSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-access", ErrorCode: "enterprise_codocs_department_access",
	Actions: map[string]enterpriseDelegatedAction{
		"resolve": {Method: http.MethodGet, PermitAction: "read", CodePattern: regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`), Target: func(enterpriseDelegatedInput) string { return "" }},
	},
}

var enterpriseCodocsDepartmentDocumentsSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-documents", ErrorCode: "enterprise_codocs_department_documents",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			QueryKeys: []string{"page", "pageSize", "published_mode", "exclude_weekly_reports", "search", "folder_id"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/codocs/documents" }},
		"trash": {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			QueryKeys: []string{"page", "pageSize"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents/trash" }},
		"create": {Method: http.MethodPost, PermitAction: "create", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents" }},
		"view": {Method: http.MethodGet, PermitAction: "read", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID }},
		"download": {Method: http.MethodGet, PermitAction: "export", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID }},
		"readonly": {Method: http.MethodPatch, PermitAction: "edit", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID }},
		"recycle": {Method: http.MethodDelete, PermitAction: "edit", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID }},
		"edit-metadata": {Method: http.MethodPatch, PermitAction: "edit", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID }},
		"restore-plan": {Method: http.MethodPost, PermitAction: "edit", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID + "/restore-plan" }},
		"restore": {Method: http.MethodPost, PermitAction: "edit", NeedsSub: true, SubPattern: regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID + "/restore" }},
	},
}

var enterpriseCodocsDepartmentFoldersSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-folders", ErrorCode: "enterprise_codocs_department_folders",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			QueryKeys: []string{"page", "pageSize", "parent_id"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/folders" }},
		"create": {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/folders" }},
		"update": {Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID }},
		"delete": {Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID }},
		"open": {Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID + "/open" }},
	},
}

var enterpriseCodocsDepartmentAccessRoutes = buildEnterpriseDelegatedRoutes(
	enterpriseCodocsDepartmentAccessSpec, enterpriseCodocsDepartmentDocumentsSpec, enterpriseCodocsDepartmentFoldersSpec,
)

func enterpriseCodocsDepartmentReadQuery(input enterpriseDelegatedInput, route enterpriseDelegatedRoute, actor string) (url.Values, error) {
	query, err := enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], actor)
	if err != nil {
		return nil, err
	}
	if route.Spec.Resource == "department-documents" && (route.Action == "view" || route.Action == "download") {
		query.Set("dept_code", input.Code)
		query.Set("hzy_runtime_actor_delegated", "1")
		query.Set("trusted_department_read_dept_code", input.Code)
		return query, nil
	}
	for key, fallback := range map[string]int{"page": 1, "pageSize": 20} {
		value := fallback
		if raw := query.Get(key); raw != "" {
			value, err = strconv.Atoi(raw)
			if err != nil || value < 1 || (key == "pageSize" && value > 200) || (key == "page" && value > 1000000) || strconv.Itoa(value) != raw {
				return nil, httperror.New(http.StatusBadRequest, "department_pagination_invalid", "Invalid pagination")
			}
		}
		query.Set(key, strconv.Itoa(value))
	}
	if route.Spec.Resource == "department-documents" {
		if mode := query.Get("published_mode"); mode != "" && mode != "published" && mode != "unpublished" {
			return nil, httperror.New(http.StatusBadRequest, "department_document_filter_invalid", "Invalid document filter")
		}
		if exclude := query.Get("exclude_weekly_reports"); exclude != "" && exclude != "true" && exclude != "false" {
			return nil, httperror.New(http.StatusBadRequest, "department_document_filter_invalid", "Invalid document filter")
		}
		if len([]rune(query.Get("search"))) > 100 {
			return nil, httperror.New(http.StatusBadRequest, "department_document_filter_invalid", "Invalid document filter")
		}
		if err := validateDepartmentReadID(query, "folder_id"); err != nil {
			return nil, err
		}
		query.Set("type", "department")
	} else {
		if err := validateDepartmentReadID(query, "parent_id"); err != nil {
			return nil, err
		}
		query.Set("folder_type", "department")
	}
	query.Set("dept_code", input.Code)
	query.Set("hzy_runtime_actor_delegated", "1")
	query.Set("codocs_trusted_department_read_dept_code", input.Code)
	return query, nil
}

func validateDepartmentReadID(query url.Values, key string) error {
	if !query.Has(key) {
		return nil
	}
	value := query.Get(key)
	if value == "null" {
		return nil
	}
	if value == "" || strings.TrimSpace(value) != value || !enterpriseDelegatedID.MatchString(value) {
		return httperror.New(http.StatusBadRequest, "department_folder_filter_invalid", "Invalid folder filter")
	}
	if _, err := strconv.ParseInt(value, 10, 64); err != nil {
		return httperror.New(http.StatusBadRequest, "department_folder_filter_invalid", "Invalid folder filter")
	}
	return nil
}

func (s *Server) routeEnterpriseCodocsDepartmentAccess(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.directory == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "department_access_unavailable", "Department access unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "codocs", LogicalTarget: "codocs",
	}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.codocs." + route.Spec.Resource + "." + route.Action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "department_access_input_invalid", "Query parameters are not supported")
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
	lockedRole := directoryapp.CodocsDepartmentNone
	if route.Spec.Resource == "department-documents" && (route.Action == "create" || route.Action == "readonly" || route.Action == "recycle" || route.Action == "edit-metadata" || route.Action == "restore-plan" || route.Action == "restore") ||
		route.Spec.Resource == "department-folders" && route.Action != "list" {
		var release func()
		lockedRole, release, err = s.lockEnterpriseCodocsDepartment(r.Context(), verified.ActorUID, input.Code)
		if err != nil {
			return result, err
		}
		defer release()
	}
	if route.Spec.Resource == "department-documents" && route.Action == "create" {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_documents_unavailable", "Department documents unavailable")
		}
		if _, err = enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID); err != nil {
			return result, err
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
			return result, httperror.New(http.StatusBadRequest, "department_document_idempotency_key_invalid", "Idempotency-Key is required")
		}
		identity := codocsapp.EnterpriseDepartmentFolderIdentity{
			Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
			Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: key, Department: input.Code,
		}
		checkWriter := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
			if err := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); err != nil {
				return err
			}
			role := lockedRole
			if !role.CanWrite() {
				return httperror.New(http.StatusForbidden, "department_writer_required", "Department writer required")
			}
			return nil
		}
		created, createErr := s.codocs.CreateEnterpriseDepartmentDocument(r.Context(), identity, input.Payload, checkWriter)
		result.Body = map[string]any{"success": createErr == nil, "data": created}
		return result, createErr
	}
	if route.Spec.Resource == "department-documents" && (route.Action == "readonly" || route.Action == "recycle") {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_documents_unavailable", "Department documents unavailable")
		}
		if _, err = enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID); err != nil {
			return result, err
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
			return result, httperror.New(http.StatusBadRequest, "department_document_idempotency_key_invalid", "Idempotency-Key is required")
		}
		identity := codocsapp.EnterpriseDepartmentFolderIdentity{
			Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
			Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: key, Department: input.Code,
		}
		checkManager := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
			if err := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); err != nil {
				return err
			}
			role := lockedRole
			if !role.CanManage() {
				return httperror.New(http.StatusForbidden, "department_manager_required", "Department manager required")
			}
			return nil
		}
		managed, manageErr := s.codocs.ManageEnterpriseDepartmentDocument(r.Context(), identity, route.Action, input.SubID, input.Payload, checkManager)
		result.Body = map[string]any{"success": manageErr == nil, "data": managed}
		return result, manageErr
	}
	if route.Spec.Resource == "department-documents" && route.Action == "edit-metadata" {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_documents_unavailable", "Department documents unavailable")
		}
		if _, err = enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID); err != nil {
			return result, err
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
			return result, httperror.New(http.StatusBadRequest, "department_document_idempotency_key_invalid", "Idempotency-Key is required")
		}
		identity := codocsapp.EnterpriseDepartmentFolderIdentity{
			Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
			Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: key, Department: input.Code,
		}
		relation := func(ctx context.Context, tx *sql.Tx, actor, department string) (bool, bool, error) {
			if err := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); err != nil {
				return false, false, err
			}
			role := lockedRole
			return role.CanWrite(), role.CanManage(), nil
		}
		updated, updateErr := s.codocs.EditEnterpriseDepartmentDocumentMetadata(r.Context(), identity, input.SubID, input.Payload, relation)
		result.Body = map[string]any{"success": updateErr == nil, "data": updated}
		return result, updateErr
	}
	if route.Spec.Resource == "department-documents" && (route.Action == "restore-plan" || route.Action == "restore") {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_documents_unavailable", "Department documents unavailable")
		}
		if _, err = enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID); err != nil {
			return result, err
		}
		identity := codocsapp.EnterpriseDepartmentFolderIdentity{
			Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
			Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Department: input.Code,
		}
		checkManager := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
			if err := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); err != nil {
				return err
			}
			role := lockedRole
			if !role.CanManage() {
				return httperror.New(http.StatusForbidden, "department_manager_required", "Department manager required")
			}
			return nil
		}
		var planned map[string]any
		if route.Action == "restore" {
			key := r.Header.Get("Idempotency-Key")
			if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
				return result, httperror.New(http.StatusBadRequest, "department_document_idempotency_key_invalid", "Idempotency-Key is required")
			}
			identity.Key = key
			planned, err = s.codocs.RestoreEnterpriseDepartmentDocument(r.Context(), identity, input.SubID, input.Payload, checkManager)
		} else {
			planned, err = s.codocs.PlanEnterpriseDepartmentDocumentRestore(r.Context(), identity, input.SubID, input.Payload, checkManager)
		}
		result.Body = map[string]any{"success": err == nil, "data": planned}
		return result, err
	}
	if route.Spec.Resource == "department-folders" && route.Action != "list" {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_folders_unavailable", "Department folders unavailable")
		}
		if _, err = enterpriseDelegatedQuery(input, route.Spec, route.Spec.Actions[route.Action], verified.ActorUID); err != nil {
			return result, err
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
			return result, httperror.New(http.StatusBadRequest, "department_folder_idempotency_key_invalid", "Idempotency-Key is required")
		}
		identity := codocsapp.EnterpriseDepartmentFolderIdentity{
			Tenant: verified.Route.Binding.Tenant, SourceDeployment: verified.Route.HostDeployment, TargetDeployment: s.cfg.DeploymentBindings["codocs"],
			Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: key, Department: input.Code,
		}
		checkManager := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
			if err := checkLockedEnterpriseCodocsDepartment(actor, department, verified.ActorUID, input.Code, lockedRole); err != nil {
				return err
			}
			role := lockedRole
			if !role.CanManage() {
				return httperror.New(http.StatusForbidden, "department_manager_required", "Department manager required")
			}
			return nil
		}
		if route.Action == "create" {
			created, createErr := s.codocs.CreateEnterpriseDepartmentFolder(r.Context(), identity, input.Payload, checkManager)
			result.Body = map[string]any{"success": createErr == nil, "data": created}
			return result, createErr
		}
		folderID, parseErr := strconv.ParseInt(input.ObjectID, 10, 64)
		if parseErr != nil || folderID < 1 {
			return result, httperror.New(http.StatusBadRequest, "department_folder_id_invalid", "Invalid folder identifier")
		}
		updated, updateErr := s.codocs.ManageEnterpriseDepartmentFolder(r.Context(), identity, route.Action, folderID, input.Payload, checkManager)
		result.Body = map[string]any{"success": updateErr == nil, "data": updated}
		return result, updateErr
	}
	if route.Spec.Resource != "department-access" {
		if s.codocs == nil {
			return result, httperror.New(http.StatusServiceUnavailable, "department_documents_unavailable", "Department documents unavailable")
		}
		query, err := enterpriseCodocsDepartmentReadQuery(input, route, verified.ActorUID)
		if err != nil {
			return result, err
		}
		role, err := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), verified.ActorUID, input.Code)
		if err != nil {
			return result, enterpriseCodocsDirectoryError(err)
		}
		if !role.CanRead() {
			return result, httperror.New(http.StatusForbidden, "department_access_denied", "Department access denied")
		}
		result.Body, _, err = s.codocs.HandleRuntime(r.Context(), route.Spec.Actions[route.Action].Method, route.Spec.Actions[route.Action].Target(input), query, nil)
		if err == nil && route.Spec.Resource == "department-documents" && (route.Action == "view" || route.Action == "download") {
			if err := validateEnterpriseDepartmentDocumentResponse(result.Body, input); err != nil {
				return result, err
			}
		}
		return result, err
	}
	role, err := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), verified.ActorUID, input.Code)
	if err != nil {
		return result, enterpriseCodocsDirectoryError(err)
	}
	result.Body = map[string]any{"success": true, "data": map[string]any{
		"role": role, "canRead": role.CanRead(), "canWrite": role.CanWrite(), "canManage": role.CanManage(),
	}}
	return result, nil
}

func validateEnterpriseDepartmentDocumentResponse(body any, input enterpriseDelegatedInput) error {
	response, ok := body.(map[string]any)
	if !ok || response["success"] != true {
		return httperror.New(http.StatusServiceUnavailable, "department_document_response_invalid", "Invalid department document response")
	}
	doc, ok := response["data"].(map[string]any)
	if !ok || stringValue(doc["uuid"]) != input.SubID || stringValue(doc["doc_type"]) != "department" || stringValue(doc["dept_code"]) != input.Code {
		return httperror.New(http.StatusNotFound, "department_document_not_found", "Department document not found")
	}
	return nil
}

func enterpriseCodocsDirectoryError(err error) error {
	if _, ok := err.(httperror.Error); ok {
		return err
	}
	return httperror.New(http.StatusServiceUnavailable, "department_directory_unavailable", "Directory unavailable")
}
