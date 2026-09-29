package server

import (
	"bytes"
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/http"
	"strings"
	"time"
)

var enterpriseWorkItemWritePaths = map[string]string{"/v1/enterprise/aims/work-items:create": "create", "/v1/enterprise/aims/work-items:edit": "edit", "/v1/enterprise/aims/work-items:delete": "delete", "/v1/enterprise/aims/work-items:associate": "associate", "/v1/enterprise/aims/work-items:complete": "complete", "/v1/enterprise/aims/work-items:matter-complete": "matter-complete", "/v1/enterprise/aims/work-items:completion-replay": "completion-replay", "/v1/enterprise/aims/work-items:append-tasks": "append-tasks", "/v1/enterprise/aims/work-items:breakdown": "breakdown"}

func init() {
	for action := range aimsapp.EnterpriseWorkItemStateCapabilities {
		enterpriseWorkItemWritePaths["/v1/enterprise/aims/work-items:"+action] = action
	}
	for action := range aimsapp.EnterpriseWorkItemDistributionCapabilities {
		enterpriseWorkItemWritePaths["/v1/enterprise/aims/work-items:"+action] = action
	}
}

type enterpriseWorkItemWritePermit struct {
	enterpriseProjectMemberPermit
	WorkItemID     string                   `json:"workItemId"`
	Scope          *projectscope.Projection `json:"scope"`
	BundleVersion  string                   `json:"bundleVersion"`
	BundleHash     string                   `json:"bundleHash"`
	PolicyRevision *int64                   `json:"policyRevision"`
}
type enterpriseWorkItemWriteInput struct {
	ProjectScope  map[string]string                   `json:"projectScope"`
	Personnel     []aimsapp.EnterprisePersonnelPermit `json:"personnel"`
	Tenant        string                              `json:"tenant"`
	Deployment    string                              `json:"deployment"`
	ProjectID     string                              `json:"projectId"`
	WorkItemID    string                              `json:"workItemId"`
	Input         map[string]any                      `json:"input"`
	Authorization enterpriseWorkItemWritePermit       `json:"authorization"`
}

func validateEnterpriseWorkItemWritePermit(input enterpriseWorkItemWriteInput, verified enterpriseRequestContext, action string, now time.Time) error {
	_, stateCommand := aimsapp.EnterpriseWorkItemStateCapabilities[action]
	scopedCommand := action == "create" || action == "edit" || action == "delete" || action == "associate" || stateCommand || action == "complete" || action == "matter-complete" || action == "completion-replay" || action == "confirm-distribute" || action == "revoke-distribute" || action == "confirm-append" || action == "reject-append" || action == "append-tasks" || action == "breakdown"
	// Confirming a distribution is the explicitly granted confirm action;
	// revoking it is a planning edit reserved further inside the transaction.
	if action == "confirm-distribute" || action == "confirm-append" || action == "reject-append" {
		action = "confirm"
	} else if action == "revoke-distribute" || action == "append-tasks" || action == "breakdown" {
		action = "edit"
	}
	if _, ok := aimsapp.EnterpriseWorkItemStateCapabilities[action]; ok {
		action = "edit"
	}
	if action == "associate" || action == "complete" || action == "matter-complete" {
		action = "edit"
	}
	p := input.Authorization
	resource := "work_items"
	if action == "completion-replay" {
		resource = "integration_operations"
		action = "replay"
	}
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != resource || p.Action != action || p.ProjectID != input.ProjectID || p.WorkItemID != input.WorkItemID || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_work_item_write_permit_invalid", "Work item authorization is invalid")
	}
	if scopedCommand {
		if !enterpriseProjectID.MatchString(input.ProjectID) || (action == "create" && input.WorkItemID != "") || (action != "create" && !enterpriseProjectID.MatchString(input.WorkItemID)) || p.Scope == nil || p.Scope.Validate() != nil || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 {
			return httperror.New(403, "enterprise_work_item_write_permit_invalid", "Work item scoped authorization is invalid")
		}
	} else if p.Scope != nil || p.BundleVersion != "" || p.BundleHash != "" || p.PolicyRevision != nil {
		return httperror.New(400, "enterprise_work_item_write_input_invalid", "Scoped command fields are not supported for this action")
	}
	return nil
}
func (s *Server) routeEnterpriseWorkItemWrite(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_work_items_unavailable", "Unified work item writes are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.work-items." + action, Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 || r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_work_item_write_input_invalid", "Idempotency-Key is required and query parameters are unsupported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, _ := json.Marshal(body)
	var input enterpriseWorkItemWriteInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Input == nil {
		return result, httperror.New(400, "enterprise_work_item_write_input_invalid", "Invalid work item input")
	}
	if err = validateEnterpriseWorkItemWritePermit(input, verified, action, time.Now()); err != nil {
		return result, err
	}
	identity := aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key, Personnel: input.Personnel}
	identity.ProjectScope = input.ProjectScope
	if input.Authorization.Scope != nil {
		descendants := map[string][]string{}
		if len(input.Authorization.Scope.DepartmentTreeRoots) > 0 {
			if s.directory == nil {
				return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
			}
			descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), input.Authorization.Scope.DepartmentTreeRoots)
			if err != nil {
				return result, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
			}
		}
		identity.CommandScope = &aimsapp.EnterpriseProjectCommandScope{Projection: *input.Authorization.Scope, Descendants: descendants, ExpiresAt: input.Authorization.ExpiresAt}
	}
	var out map[string]any
	if action == "breakdown" {
		out, err = s.aims.SaveEnterpriseWorkItemBreakdown(r.Context(), identity, input.ProjectID, input.WorkItemID, input.Input)
	} else if action == "append-tasks" {
		out, err = s.aims.AppendEnterpriseWorkItemTasks(r.Context(), identity, input.ProjectID, input.WorkItemID, input.Input)
	} else if _, ok := aimsapp.EnterpriseWorkItemDistributionCapabilities[action]; ok {
		out, err = s.aims.DistributeEnterpriseWorkItem(r.Context(), identity, input.ProjectID, input.WorkItemID, action, input.Input)
	} else if _, ok := aimsapp.EnterpriseWorkItemStateCapabilities[action]; ok {
		out, err = s.aims.TransitionEnterpriseWorkItem(r.Context(), identity, input.ProjectID, input.WorkItemID, action, input.Input)
	} else if action == "delete" {
		out, err = s.aims.DeleteEnterpriseWorkItem(r.Context(), identity, input.ProjectID, input.WorkItemID, input.Input)
	} else if action == "complete" {
		out, err = s.aims.RequestEnterpriseWorkItemCompletion(r.Context(), identity, input.ProjectID, input.WorkItemID, input.Input)
	} else if action == "matter-complete" {
		out, err = s.aims.RequestEnterpriseWorkItemCompletionKind(r.Context(), identity, input.ProjectID, input.WorkItemID, "matter", input.Input)
	} else if action == "completion-replay" {
		out, err = s.aims.ReplayEnterpriseWorkItemCompletion(r.Context(), identity, input.ProjectID, input.WorkItemID, input.Input)
	} else {
		out, err = s.aims.WriteEnterpriseWorkItem(r.Context(), identity, input.ProjectID, input.WorkItemID, action, input.Input)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
