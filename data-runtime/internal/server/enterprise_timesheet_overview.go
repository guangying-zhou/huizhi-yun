package server

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"time"
)

const enterpriseTimesheetOverviewPath = "/v1/enterprise/aims/timesheet-overview:view"

type enterpriseTimesheetOverviewPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseTimesheetOverviewInput struct {
	Tenant        string                            `json:"tenant"`
	Deployment    string                            `json:"deployment"`
	Query         map[string]string                 `json:"query"`
	Authorization enterpriseTimesheetOverviewPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseTimesheetOverview(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_timesheet_overview_unavailable", "Unified timesheet overview is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:timesheet-overview:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.timesheet_overview.view", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_timesheet_overview_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseTimesheetOverviewInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseTimesheetOverviewPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, q, err := enterpriseTimesheetOverviewTarget(input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, q, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}
func decodeEnterpriseTimesheetOverviewInput(body map[string]any) (enterpriseTimesheetOverviewInput, error) {
	var input enterpriseTimesheetOverviewInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_timesheet_overview_input_invalid", "Invalid timesheet overview input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil {
		return input, httperror.New(400, "enterprise_timesheet_overview_input_invalid", "Invalid timesheet overview input")
	}
	return input, nil
}
func validateEnterpriseTimesheetOverviewPermit(input enterpriseTimesheetOverviewInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "timesheet" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_timesheet_overview_permit_invalid", "Timesheet overview authorization is invalid")
	}
	return nil
}
func enterpriseTimesheetOverviewTarget(input enterpriseTimesheetOverviewInput, actor string) (string, url.Values, error) {
	q := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(400, "enterprise_timesheet_overview_input_invalid", "Timesheet overview query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			q.Set(key, value)
			continue
		}
		if key == "startDate" || key == "endDate" || key == "page" || key == "pageSize" {
			q.Set(key, value)
			continue
		}
		return "", nil, httperror.New(400, "enterprise_timesheet_overview_input_invalid", "Timesheet overview query is invalid")
	}
	q.Set("current_user", actor)
	q.Set("operator_uid", actor)
	return "/v1/aims/users/" + url.PathEscape(actor) + "/visible-time-entries", q, nil
}
