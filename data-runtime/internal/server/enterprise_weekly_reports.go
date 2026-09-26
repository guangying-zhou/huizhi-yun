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

var enterpriseWeeklyReportReadActions = map[string]string{
	"/v1/enterprise/aims/weekly-reports:list": "list",
	"/v1/enterprise/aims/weekly-reports:view": "view",
}

type enterpriseWeeklyReportReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseWeeklyReportReadInput struct {
	Tenant        string                           `json:"tenant"`
	Deployment    string                           `json:"deployment"`
	ProjectID     string                           `json:"projectId"`
	PeriodKey     string                           `json:"periodKey"`
	Query         map[string]string                `json:"query"`
	Authorization enterpriseWeeklyReportReadPermit `json:"authorization"`
}

var enterpriseWeeklyReportPeriodKey = regexp.MustCompile(`^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$`)

func (s *Server) routeEnterpriseWeeklyReportRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_weekly_reports_unavailable", "Unified weekly report reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims", Capability: "aims:weekly-reports:view",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.weekly_reports." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseWeeklyReportReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseWeeklyReportReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseWeeklyReportReadTarget(action, input, verified.ActorUID)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), http.MethodGet, path, query, map[string]any{})
	if operation == "" {
		operation = "aims.weekly_reports." + action
	}
	result.Operation = "enterprise." + operation
	result.Body = out
	return result, err
}

func decodeEnterpriseWeeklyReportReadInput(body map[string]any) (enterpriseWeeklyReportReadInput, error) {
	var input enterpriseWeeklyReportReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Invalid weekly report read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Invalid weekly report read input")
	}
	return input, nil
}

func validateEnterpriseWeeklyReportReadPermit(input enterpriseWeeklyReportReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment || permit.ActorUID != verified.ActorUID ||
		permit.Resource != "weekly_reports" || permit.Action != "view" || permit.ExpiresAt <= now.UnixMilli() ||
		permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_weekly_report_permit_invalid", "Weekly report read authorization is invalid")
	}
	return nil
}

func enterpriseWeeklyReportReadTarget(action string, input enterpriseWeeklyReportReadInput, actorUID string) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Project ID is invalid")
	}
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Weekly report read query is invalid")
		}
		if enterpriseProjectScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		switch key {
		// Aims 的 weeklyReports 读 includeWorkItems（见 project_weekly_reports.go），
		// 全局周报页始终带这个参数，漏放行会让整表 400。
		case "year", "week", "includeWorkItems":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Weekly report read query is invalid")
		}
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	base := "/v1/aims/projects/" + input.ProjectID + "/weekly-reports"
	switch action {
	case "list":
		return base, query, nil
	case "view":
		if !enterpriseWeeklyReportPeriodKey.MatchString(input.PeriodKey) {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_weekly_report_input_invalid", "Weekly report period is invalid")
		}
		return base + "/" + input.PeriodKey, query, nil
	default:
		return "", nil, httperror.New(http.StatusNotFound, "enterprise_weekly_report_operation_unknown", "Weekly report read operation is not registered")
	}
}
