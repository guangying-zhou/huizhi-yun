package server

// Host -> Runtime department document collaboration routes (R1). They reuse
// the exact `department-documents` permit resource and the Enterprise Host
// service capability (codocs:enterprise-host:execute); no capability or grant
// is added. Registered only when apps.codocs.snapshotV2Enabled,
// collaborationV2Enabled and departmentCollaborationV2Enabled are all true.
//
//	department-documents:collaboration-open  POST  permit edit  ticket for a writer
//	department-documents:snapshot-read       POST  permit read  published head
//	department-documents:snapshot-prepare    POST  permit edit  v1 -> v2 conversion
//	department-documents:snapshot-publish    POST  permit edit  v1 -> v2 conversion
//	department-documents:versions            POST  permit read  version list (read-only history)
//	department-documents:version-view        POST  permit read  one version row
//
// See docs/Codocs-Host-Department-Collaboration-Design.md.

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var departmentCollaborationDocumentUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Snapshot and session actions are served in-process; nothing is proxied.
func departmentCollaborationTarget(in enterpriseDelegatedInput) string {
	return "/v1/codocs/documents/" + in.SubID + "/snapshot"
}

var enterpriseCodocsDepartmentCollaborationSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "department-documents", ErrorCode: "enterprise_codocs_department_collaboration",
	Actions: map[string]enterpriseDelegatedAction{
		"collaboration-open": {Method: http.MethodPost, PermitAction: "edit", NeedsSub: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, Target: departmentCollaborationTarget},
		"snapshot-read":      {Method: http.MethodGet, PermitAction: "read", NeedsSub: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, Target: departmentCollaborationTarget},
		"snapshot-prepare":   {Method: http.MethodPost, PermitAction: "edit", NeedsSub: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true, Target: departmentCollaborationTarget},
		"snapshot-publish":   {Method: http.MethodPost, PermitAction: "edit", NeedsSub: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern, AllowPayload: true, Target: departmentCollaborationTarget},
		// Read-only version history (A11): rows are served by the Codocs adapter under
		// the exact department read context; the Host reads the snapshot object.
		"versions": {Method: http.MethodGet, PermitAction: "read", NeedsSub: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.SubID + "/versions" }},
		"version-view": {Method: http.MethodGet, PermitAction: "read", NeedsSub: true, NeedsObject: true, SubPattern: departmentCollaborationDocumentUUID, CodePattern: enterpriseCodocsDepartmentAccessSpec.Actions["resolve"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.SubID + "/versions/" + in.ObjectID
			}},
	},
}

// A separate route table from enterpriseCodocsDepartmentAccessRoutes: these
// operations are registered only behind the department collaboration switch.
var enterpriseCodocsDepartmentCollaborationRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDepartmentCollaborationSpec)

func (s *Server) departmentCollaborationEnabled() bool {
	codocs := s.cfg.Apps.Codocs
	return codocs.SnapshotV2Enabled && codocs.CollaborationV2Enabled && codocs.DepartmentCollaborationV2Enabled
}

func departmentCollabRole(role directoryapp.EnterpriseCodocsDepartmentRole) codocsapp.DepartmentCollabRole {
	return codocsapp.DepartmentCollabRole{CanWrite: role.CanWrite(), CanManage: role.CanManage()}
}

// departmentRoleLocker adapts the Directory batch lock for the Codocs adapter.
// A Directory failure is a 503, never a permission verdict.
func (s *Server) departmentRoleLocker() codocsapp.DepartmentRoleLocker {
	return func(ctx context.Context, dept string, uids []string) (map[string]codocsapp.DepartmentCollabRole, func(), error) {
		if s.directory == nil {
			return nil, nil, httperror.New(http.StatusServiceUnavailable, "department_directory_unavailable", "Directory unavailable")
		}
		roles, tx, err := s.directory.LockEnterpriseCodocsDepartmentAccessBatch(ctx, dept, uids)
		if err != nil {
			return nil, nil, enterpriseCodocsDirectoryError(err)
		}
		out := make(map[string]codocsapp.DepartmentCollabRole, len(roles))
		for uid, role := range roles {
			out[uid] = departmentCollabRole(role)
		}
		return out, func() { _ = tx.Rollback() }, nil
	}
}

func (s *Server) routeEnterpriseCodocsDepartmentCollaboration(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.codocs == nil || s.directory == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "department_collaboration_unavailable", "Department collaboration unavailable")
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
		return result, httperror.New(http.StatusBadRequest, "department_collaboration_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseDelegatedInput(body, route.Spec)
	if err != nil {
		return result, err
	}
	act := route.Spec.Actions[route.Action]
	if err = validateEnterpriseDelegatedPermit(input, verified, route.Spec, act, time.Now()); err != nil {
		return result, err
	}
	query, err := enterpriseDelegatedQuery(input, route.Spec, act, verified.ActorUID)
	if err != nil {
		return result, err
	}
	if route.Action == "versions" || route.Action == "version-view" {
		value, readErr := s.readEnterpriseDepartmentVersions(r.Context(), route, input, query, verified.ActorUID)
		result.Body = value
		return result, readErr
	}
	if route.Action == "snapshot-read" && len(input.Payload) != 0 || route.Action == "collaboration-open" && len(input.Payload) != 0 ||
		(route.Action == "snapshot-prepare" || route.Action == "snapshot-publish") && len(input.Payload) == 0 {
		return result, httperror.New(http.StatusBadRequest, "department_collaboration_input_invalid", "Invalid department collaboration input")
	}
	dept, documentUUID := input.Code, strings.ToLower(input.SubID)
	identity := codocsapp.PersonalFolderCreationIdentity{
		Tenant: verified.Route.Binding.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"],
		Actor: verified.ActorUID, Client: verified.Service.ClientID, RequestID: requestID(r),
	}
	if route.Action == "snapshot-read" {
		// Reading needs any department relation and converts nothing.
		role, roleErr := s.directory.EnterpriseCodocsDepartmentAccess(r.Context(), verified.ActorUID, dept)
		if roleErr != nil {
			return result, enterpriseCodocsDirectoryError(roleErr)
		}
		if !role.CanRead() {
			return result, httperror.New(http.StatusForbidden, "department_access_denied", "Department access denied")
		}
		read, readErr := s.codocs.ReadDepartmentDocumentSnapshot(r.Context(), identity, dept, documentUUID)
		var value any
		if readErr == nil {
			value = snapshotReadValue(read)
		}
		result.Body = map[string]any{"success": readErr == nil, "data": value}
		return result, readErr
	}
	if route.Action != "collaboration-open" {
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 191 || !enterpriseDeliverableIntentKey.MatchString(key) {
			return result, httperror.New(http.StatusBadRequest, "department_document_idempotency_key_invalid", "Idempotency-Key is required")
		}
		identity.Key = key
	}
	// Directory shared locks stay held until the Codocs transaction has ended.
	directoryRole, release, err := s.lockEnterpriseCodocsDepartment(r.Context(), verified.ActorUID, dept)
	if err != nil {
		return result, err
	}
	defer release()
	if !directoryRole.CanWrite() {
		return result, httperror.New(http.StatusForbidden, "department_writer_required", "Department writer required")
	}
	role := departmentCollabRole(directoryRole)
	switch route.Action {
	case "collaboration-open":
		session, openErr := s.codocs.OpenDepartmentCollaborationSession(r.Context(), identity, dept, documentUUID, role)
		var value any
		if openErr == nil {
			// The one-time ticket goes to the verified user's browser; only its
			// hash is stored. Same shape as the personal open.
			value = map[string]any{"sessionId": session.SessionID, "epoch": session.Epoch, "generation": session.Generation, "expiresAt": session.ExpiresAt.UTC().Format(time.RFC3339), "reused": session.Reused, "ticket": session.Ticket}
		}
		result.Body = map[string]any{"success": openErr == nil, "data": value}
		return result, openErr
	default:
		publish := route.Action == "snapshot-publish"
		cmd, objects, decodeErr := decodeSnapshotCommand(documentUUID, input.Payload, publish)
		if decodeErr != nil {
			return result, decodeErr
		}
		if cmd.YjsSHA256 != "" || objects.Yjs != nil {
			return result, httperror.New(http.StatusBadRequest, "department_snapshot_conversion_invalid", "Department conversion publishes Markdown only")
		}
		var plan codocsapp.SnapshotPlan
		var snapshotErr error
		if publish {
			plan, snapshotErr = s.codocs.PublishDepartmentConversionSnapshot(r.Context(), identity, dept, role, cmd, objects, s.codocsSnapshotVerifier())
		} else {
			plan, snapshotErr = s.codocs.PrepareDepartmentConversionSnapshot(r.Context(), identity, dept, role, cmd)
		}
		var value any
		if snapshotErr == nil {
			value = map[string]any{"candidate": plan.Candidate, "prefix": plan.Prefix, "generation": plan.Generation, "replayed": plan.Replayed}
		}
		result.Body = map[string]any{"success": snapshotErr == nil, "data": value}
		return result, snapshotErr
	}
}

// readEnterpriseDepartmentVersions serves the read-only history. Any department
// relation is enough (same as viewing the document); the document must belong
// to the requested department, and the adapter re-checks the exact department
// read context. No capability, no write, no storage access.
func (s *Server) readEnterpriseDepartmentVersions(ctx context.Context, route enterpriseDelegatedRoute, input enterpriseDelegatedInput, query url.Values, actor string) (any, error) {
	role, err := s.directory.EnterpriseCodocsDepartmentAccess(ctx, actor, input.Code)
	if err != nil {
		return nil, enterpriseCodocsDirectoryError(err)
	}
	if !role.CanRead() {
		return nil, httperror.New(http.StatusForbidden, "department_access_denied", "Department access denied")
	}
	query.Set("dept_code", input.Code)
	query.Set("hzy_runtime_actor_delegated", "1")
	query.Set("trusted_department_read_dept_code", input.Code)
	query.Set("codocs_trusted_department_read_dept_code", input.Code)
	doc, _, err := s.codocs.HandleRuntime(ctx, http.MethodGet, "/v1/codocs/documents/"+input.SubID, query, nil)
	if err != nil {
		return nil, err
	}
	if err = validateEnterpriseDepartmentDocumentResponse(doc, input); err != nil {
		return nil, err
	}
	body, _, err := s.codocs.HandleRuntime(ctx, route.Spec.Actions[route.Action].Method, route.Spec.Actions[route.Action].Target(input), query, nil)
	return body, err
}
