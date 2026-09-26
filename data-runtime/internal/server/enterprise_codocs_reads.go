package server

import (
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Host identity stays enterprise. Only these explicit user-domain operations
// reach the existing Codocs adapter and its existing database; this is not a
// generic /v1/codocs proxy or a grant to the legacy service-only endpoints.
var enterpriseCodocsDocumentReads = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_documents",
	Actions: map[string]enterpriseDelegatedAction{
		"check-name": {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"title", "doc_type", "folder_id", "exclude_uuid"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents/check-name" }},
		"download":   {Method: http.MethodGet, PermitAction: "export", CodePattern: regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`), Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code }},
		"list":       {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"page", "pageSize", "type", "folder_id", "starred", "exclude_worklogs", "search", "sort", "order"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents" }},
		"view":       {Method: http.MethodGet, PermitAction: "read", CodePattern: regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`), QueryKeys: []string{"include_deleted"}, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code }},
		"trash":      {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"type"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents/trash" }},
		"folders":    {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"page", "pageSize", "folder_type", "parent_id"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/folders" }},
	},
}

var enterpriseCodocsReadRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDocumentReads)

func enterpriseCodocsReadQuery(input enterpriseDelegatedInput, action string, actor string) (url.Values, error) {
	act, exists := enterpriseCodocsDocumentReads.Actions[action]
	invalid := httperror.New(400, "enterprise_codocs_documents_input_invalid", "Invalid document read input")
	if !exists || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsDocumentReads, act, actor)
	if err != nil {
		return nil, err
	}
	// The marker is created only after the transport actor has been verified.
	// Caller-supplied actor, owner and department privilege markers are rejected
	// by the action whitelist above, not merged into this trusted context.
	query.Set("hzy_runtime_actor_delegated", "1")
	if action == "check-name" || action == "trash" {
		query.Set("owner", actor)
		query.Set("owner_uid", actor)
	}
	if action == "check-name" {
		title := strings.TrimSpace(query.Get("title"))
		if title == "" || len([]rune(title)) > 255 {
			return nil, invalid
		}
		query.Set("title", title)
		switch query.Get("doc_type") {
		case "private", "slide", "worklog", "weekly-report":
		default:
			return nil, invalid
		}
		folder := query.Get("folder_id")
		if folder == "" {
			query.Set("folder_id", "null")
		} else if folder != "null" {
			id, parseErr := strconv.ParseInt(folder, 10, 64)
			if parseErr != nil || id < 1 || id > 9007199254740991 || strconv.FormatInt(id, 10) != folder {
				return nil, invalid
			}
		}
		if exclude := query.Get("exclude_uuid"); exclude != "" && !enterpriseCodocsDocumentReads.Actions["view"].CodePattern.MatchString(exclude) {
			return nil, invalid
		}
	}
	if action == "list" || action == "folders" {
		query.Set("owner", actor)
		query.Set("owner_uid", actor)
		for key, fallback := range map[string]int{"page": 1, "pageSize": 20} {
			value := fallback
			if raw := query.Get(key); raw != "" {
				value, err = strconv.Atoi(raw)
				if err != nil || value < 1 || (key == "pageSize" && value > 200) || (key == "page" && value > 1000000) {
					return nil, invalid
				}
			}
			query.Set(key, strconv.Itoa(value))
		}
	}
	if action == "list" || action == "trash" {
		switch query.Get("type") {
		case "", "private", "slide", "worklog", "weekly-report":
		default:
			return nil, invalid
		}
	}
	if action == "folders" {
		switch query.Get("folder_type") {
		case "private", "slide":
		default:
			return nil, invalid
		}
	}
	return query, nil
}

func (s *Server) routeEnterpriseCodocsRead(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	return s.routeEnterpriseCodocsOperation(r, route, enterpriseCodocsReadQuery)
}

func (s *Server) routeEnterpriseCodocsOperation(r *http.Request, route enterpriseDelegatedRoute, buildQuery func(enterpriseDelegatedInput, string, string) (url.Values, error)) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.codocs == nil {
		return routeResult{}, httperror.New(503, "enterprise_codocs_unavailable", "Codocs domain is unavailable")
	}
	action := route.Spec.Actions[route.Action]
	ctxRoute := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "codocs", LogicalTarget: "codocs",
		Capability: route.Spec.Domain + ":" + route.Spec.Resource + ":" + action.PermitAction,
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, ctxRoute, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.codocs." + route.Spec.Resource + "." + route.Action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_codocs_documents_input_invalid", "Query parameters are not supported")
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
	query, err := buildQuery(input, route.Action, verified.ActorUID)
	if err != nil {
		return result, err
	}
	if route.Spec.Resource == "personal-cabinet" && route.Action == "converted-info" {
		value, readErr := s.codocs.PersonalCabinetConvertedInfo(r.Context(), input.Code, query)
		result.Body = map[string]any{"success": readErr == nil, "data": value}
		return result, readErr
	}
	if route.Spec.Resource == "personal-cabinet" && (route.Action == "conversion-plan" || route.Action == "convert") {
		identity := codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}
		var value map[string]any
		var conversionErr error
		if route.Action == "conversion-plan" {
			value, conversionErr = s.codocs.PlanPersonalCabinetConversion(r.Context(), identity, input.Code, input.Payload)
		} else {
			value, conversionErr = s.codocs.CommitPersonalCabinetConversion(r.Context(), identity, input.Code, input.Payload)
		}
		result.Body = map[string]any{"success": conversionErr == nil, "data": value}
		return result, conversionErr
	}
	if route.Spec.Resource == "personal-cabinet" && (route.Action == "upload-plan" || route.Action == "upload") {
		identity := codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}
		var value map[string]any
		var uploadErr error
		if route.Action == "upload-plan" {
			value, uploadErr = s.codocs.PlanPersonalCabinetUpload(r.Context(), identity, input.Payload)
		} else {
			value, uploadErr = s.codocs.CommitPersonalCabinetUpload(r.Context(), identity, input.Payload)
		}
		result.Body = map[string]any{"success": uploadErr == nil, "data": value}
		return result, uploadErr
	}
	if route.Spec.Resource == "personal-cabinet" && route.Action == "delete" {
		value, deleteErr := s.codocs.DeletePersonalCabinetFile(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Code)
		result.Body = map[string]any{"success": deleteErr == nil, "data": value}
		return result, deleteErr
	}
	if route.Spec.Resource == "document-access-records" && route.Action == "record" {
		value, recordErr := s.codocs.RecordEnterpriseDocumentAccess(r.Context(), input.Code, verified.ActorUID, input.Payload["eventId"].(string), input.Payload["pathSha256"].(string))
		result.Body = map[string]any{"success": recordErr == nil, "data": value}
		return result, recordErr
	}
	if route.Spec.Resource == "personal-documents" && (route.Action == "snapshot-prepare" || route.Action == "snapshot-publish" || route.Action == "snapshot-read" || route.Action == "collaboration-open") {
		identity := codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}
		value, snapshotErr := s.enterpriseCodocsDocumentSnapshot(r.Context(), route.Action, identity, input.Code, input.Payload)
		result.Body = map[string]any{"success": snapshotErr == nil, "data": value}
		return result, snapshotErr
	}
	if route.Spec.Resource == "personal-documents" && (route.Action == "update" || route.Action == "update-plan") {
		identity := codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}
		var value map[string]any
		var updateErr error
		if route.Action == "update-plan" {
			value, updateErr = s.codocs.PlanPersonalDocumentUpdate(r.Context(), identity, input.Code, input.Payload)
		} else {
			value, updateErr = s.codocs.CommitPersonalDocumentUpdate(r.Context(), identity, input.Code, input.Payload)
		}
		result.Body = map[string]any{"success": updateErr == nil, "data": value}
		return result, updateErr
	}
	if route.Spec.Resource == "document-transfer" && route.Action == "project" {
		value, transferErr := s.codocs.TransferPersonalDocumentToProject(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Code, input.Payload)
		result.Body = map[string]any{"success": transferErr == nil, "data": value}
		return result, transferErr
	}
	if route.Spec.Resource == "document-transfer" && route.Action == "department" {
		deptCode, _ := input.Payload["dept_code"].(string)
		message, _ := input.Payload["message"].(string)
		value, transferErr := s.codocs.CreatePersonalDocumentDepartmentTransfer(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Code, deptCode, message)
		result.Body = map[string]any{"success": transferErr == nil, "data": value}
		return result, transferErr
	}
	if route.Spec.Resource == "personal-documents" && route.Action == "restore-plan" {
		value, planErr := s.codocs.PlanPersonalDocumentRestore(r.Context(), input.Code, verified.ActorUID, input.Payload)
		result.Body = map[string]any{"success": planErr == nil, "data": value}
		return result, planErr
	}
	if route.Spec.Resource == "personal-documents" && route.Action == "restore" {
		value, restoreErr := s.codocs.RestorePersonalDocument(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Code, input.Payload)
		result.Body = map[string]any{"success": restoreErr == nil, "data": value}
		return result, restoreErr
	}
	if route.Spec.Resource == "personal-documents" && route.Action == "recycle" {
		value, recycleErr := s.codocs.RecyclePersonalDocument(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Code)
		result.Body = map[string]any{"success": recycleErr == nil, "data": value}
		return result, recycleErr
	}
	if route.Spec.Resource == "personal-documents" && route.Action == "create" {
		value, creationErr := s.codocs.CreatePersonalDocument(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Payload)
		result.Body = map[string]any{"success": creationErr == nil, "data": value}
		return result, creationErr
	}
	if route.Spec.Resource == "personal-folders" && route.Action == "create" {
		value, creationErr := s.codocs.CreatePersonalFolder(r.Context(), codocsapp.PersonalFolderCreationIdentity{Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}, input.Payload)
		result.Body = map[string]any{"success": creationErr == nil, "data": value}
		return result, creationErr
	}
	if route.Spec.Resource == "document-annotations" && route.Action != "list" {
		value, mutationErr := s.codocs.MutateEnterpriseAnnotation(r.Context(), codocsapp.PersonalFolderCreationIdentity{
			Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], Actor: verified.ActorUID,
			Client: verified.Service.ClientID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key"),
		}, route.Action, input.Code, input.ObjectID, input.SubID, input.Payload)
		result.Body = map[string]any{"success": mutationErr == nil, "data": value}
		return result, mutationErr
	}
	payload := input.Payload
	result.Body, _, err = s.codocs.HandleRuntime(r.Context(), action.Method, action.Target(input), query, payload)
	return result, err
}
