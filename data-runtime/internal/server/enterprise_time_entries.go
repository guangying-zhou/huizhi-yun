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

var enterpriseTimeEntryReadActions = map[string]string{
	"/v1/enterprise/aims/time-entries:list": "list",
	"/v1/enterprise/aims/time-entries:view": "view",
}

type enterpriseTimeEntryReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseTimeEntryReadInput struct {
	Tenant        string                        `json:"tenant"`
	Deployment    string                        `json:"deployment"`
	ProjectID     string                        `json:"projectId"`
	TimeEntryID   string                        `json:"timeEntryId"`
	Query         map[string]string             `json:"query"`
	Authorization enterpriseTimeEntryReadPermit `json:"authorization"`
}

var enterpriseTimeEntryID = regexp.MustCompile(`^[1-9][0-9]*$`)

func (s *Server) routeEnterpriseTimeEntryRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_time_entries_unavailable", "Unified time entry reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:time-entries:view",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.time_entries." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseTimeEntryReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseTimeEntryReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseTimeEntryReadTarget(action, input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, query, map[string]any{})
	if operation == "" {
		operation = "aims.time_entries." + action
	}
	result.Operation = "enterprise." + operation
	result.Body = out
	return result, err
}

func decodeEnterpriseTimeEntryReadInput(body map[string]any) (enterpriseTimeEntryReadInput, error) {
	var input enterpriseTimeEntryReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Invalid time entry read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Invalid time entry read input")
	}
	return input, nil
}

func validateEnterpriseTimeEntryReadPermit(input enterpriseTimeEntryReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment || permit.ActorUID != verified.ActorUID ||
		permit.Resource != "timesheet" || permit.Action != "view" || permit.ExpiresAt <= now.UnixMilli() ||
		permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_time_entry_permit_invalid", "Time entry read authorization is invalid")
	}
	return nil
}

func enterpriseTimeEntryReadTarget(action string, input enterpriseTimeEntryReadInput, actorUID string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Project ID is invalid")
	}
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Time entry read query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		switch key {
		case "startDate", "endDate", "uid":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Time entry read query is invalid")
		}
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	base := "/v1/aims/projects/" + input.ProjectID + "/time-entries"
	switch action {
	case "list":
		return base, query, nil
	case "view":
		if !enterpriseTimeEntryID.MatchString(input.TimeEntryID) {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Time entry ID is invalid")
		}
		if _, err := strconv.ParseInt(input.TimeEntryID, 10, 64); err != nil {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_time_entry_input_invalid", "Time entry ID is invalid")
		}
		return base + "/" + input.TimeEntryID, query, nil
	default:
		return "", nil, httperror.New(http.StatusNotFound, "enterprise_time_entry_operation_unknown", "Time entry read operation is not registered")
	}
}
