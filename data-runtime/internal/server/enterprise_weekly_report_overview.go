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

const enterpriseWeeklyReportOverviewPath = "/v1/enterprise/aims/weekly-report-overview:view"

type enterpriseWeeklyReportOverviewPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}
type enterpriseWeeklyReportOverviewInput struct {
	Tenant        string                               `json:"tenant"`
	Deployment    string                               `json:"deployment"`
	Query         map[string]string                    `json:"query"`
	Authorization enterpriseWeeklyReportOverviewPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseWeeklyReportOverview(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_weekly_report_overview_unavailable", "Unified weekly report overview is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:weekly-report-overview:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.weekly_report_overview.view", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_weekly_report_overview_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseWeeklyReportOverviewInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseWeeklyReportOverviewPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	q, err := enterpriseWeeklyReportOverviewQuery(input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, "/v1/aims/weekly-reports", q, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}
func decodeEnterpriseWeeklyReportOverviewInput(body map[string]any) (enterpriseWeeklyReportOverviewInput, error) {
	var input enterpriseWeeklyReportOverviewInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(400, "enterprise_weekly_report_overview_input_invalid", "Invalid weekly report overview input")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&input); err != nil {
		return input, httperror.New(400, "enterprise_weekly_report_overview_input_invalid", "Invalid weekly report overview input")
	}
	return input, nil
}
func validateEnterpriseWeeklyReportOverviewPermit(input enterpriseWeeklyReportOverviewInput, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "weekly_reports" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_weekly_report_overview_permit_invalid", "Weekly report overview authorization is invalid")
	}
	return nil
}
func enterpriseWeeklyReportOverviewQuery(input enterpriseWeeklyReportOverviewInput, actor string) (url.Values, error) {
	q := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return nil, httperror.New(400, "enterprise_weekly_report_overview_input_invalid", "Weekly report overview query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			q.Set(key, value)
			continue
		}
		switch key {
		case "year", "week", "search", "deptCode", "category", "includeWorkItems":
			q.Set(key, value)
		default:
			return nil, httperror.New(400, "enterprise_weekly_report_overview_input_invalid", "Weekly report overview query is invalid")
		}
	}
	q.Set("current_user", actor)
	q.Set("operator_uid", actor)
	q.Set("current_user_can_view_weekly_report_summary", "1")
	return q, nil
}
