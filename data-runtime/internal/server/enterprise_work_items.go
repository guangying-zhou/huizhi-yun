package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseWorkItemReadActions = map[string]string{
	"/v1/enterprise/aims/work-items:list": "list",
	"/v1/enterprise/aims/work-items:view": "view",
	// The task distribution page reads its target, children, deliverables and
	// related documents under the same view capability and project scope.
	"/v1/enterprise/aims/work-items:breakdown-context": "breakdown-context",
}

type enterpriseWorkItemReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseWorkItemReadInput struct {
	Tenant        string                       `json:"tenant"`
	Deployment    string                       `json:"deployment"`
	WorkItemID    string                       `json:"workItemId"`
	Query         map[string]string            `json:"query"`
	Authorization enterpriseWorkItemReadPermit `json:"authorization"`
}

var enterpriseWorkItemID = regexp.MustCompile(`^[1-9][0-9]*$`)

func (s *Server) routeEnterpriseWorkItemRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_work_items_unavailable", "Unified work item reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:work-items:view",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.work_items." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseWorkItemReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseWorkItemReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseWorkItemReadTarget(action, input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, query, map[string]any{})
	if operation == "" {
		operation = "aims.work_items." + action
	}
	result.Operation = "enterprise." + operation
	if action == "view" && err == nil {
		snapshot, version, e := s.aims.EnterpriseWorkItemEditableSnapshot(r.Context(), input.WorkItemID)
		if e != nil {
			return result, e
		}
		if wrapped, ok := out.(map[string]any); ok {
			if data, ok := wrapped["data"].(map[string]any); ok {
				options, e := s.aims.EnterpriseWorkItemAssociationOptions(r.Context(), input.WorkItemID, verified.ActorUID)
				if e != nil {
					return result, e
				}
				data["associationOptions"] = options
				data["editSnapshot"] = snapshot
				data["editVersion"] = version
				completion, e := s.aims.EnterpriseWorkItemCompletionState(r.Context(), input.WorkItemID, verified.ActorUID)
				if e != nil {
					return result, e
				}
				data["completion"] = completion
				actions, e := s.aims.EnterpriseWorkItemStateActions(r.Context(), input.WorkItemID, verified.ActorUID, query)
				if e != nil {
					return result, e
				}
				data["stateActions"] = actions
			}
		}
	}
	if action == "breakdown-context" && err == nil {
		_, version, e := s.aims.EnterpriseWorkItemEditableSnapshot(r.Context(), input.WorkItemID)
		if e != nil {
			return result, e
		}
		if wrapped, ok := out.(map[string]any); ok {
			if data, ok := wrapped["data"].(map[string]any); ok {
				data["editVersion"] = version
			}
		}
	}
	result.Body = out
	return result, err
}

func decodeEnterpriseWorkItemReadInput(body map[string]any) (enterpriseWorkItemReadInput, error) {
	var input enterpriseWorkItemReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Invalid work item read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Invalid work item read input")
	}
	return input, nil
}

func validateEnterpriseWorkItemReadPermit(input enterpriseWorkItemReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment || permit.ActorUID != verified.ActorUID ||
		permit.Resource != "work_items" || permit.Action != "view" || permit.ExpiresAt <= now.UnixMilli() ||
		permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_work_item_permit_invalid", "Work item read authorization is invalid")
	}
	return nil
}

func enterpriseWorkItemReadTarget(action string, input enterpriseWorkItemReadInput, actorUID string) (string, url.Values, error) {
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Work item read query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		switch key {
		case "page", "pageSize", "search", "projectId", "projectCode", "type", "status", "milestoneId", "assigneeUid", "reporterUid", "priority", "tier", "parentId":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Work item read query is invalid")
		}
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	switch action {
	case "list":
		return "/v1/aims/work-items", query, nil
	case "view", "breakdown-context":
		if !enterpriseWorkItemID.MatchString(input.WorkItemID) {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Work item ID is invalid")
		}
		if _, err := strconv.ParseInt(input.WorkItemID, 10, 64); err != nil {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_work_item_input_invalid", "Work item ID is invalid")
		}
		if action == "breakdown-context" {
			return "/v1/aims/work-items/" + input.WorkItemID + "/breakdown-context", query, nil
		}
		return "/v1/aims/work-items/" + input.WorkItemID, query, nil
	default:
		return "", nil, httperror.New(http.StatusNotFound, "enterprise_work_item_operation_unknown", "Work item read operation is not registered")
	}
}
