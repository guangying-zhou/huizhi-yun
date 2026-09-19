package server

import "net/http"

// 全局周报页：公司周报汇总、周期治理、周报审阅。
//
// 公司周报与周期用周期键（2026-W30），周报用数字 ID，两者分属不同 spec，
// 避免一个 action 同时接受 Code 与 SubID 造成入参含糊。

var enterpriseCompanyWeeklySummarySpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "company-weekly-summaries", ErrorCode: "enterprise_company_weekly_summaries",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/company-weekly-summaries/" + in.Code },
		},
		"versions": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + "/versions"
			},
		},
		"save-draft": {
			Method: http.MethodPut, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + "/draft"
			},
		},
		"generate": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":generate"
			},
		},
		"publish": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":publish"
			},
		},
		"cancel-publish": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":cancel-publish"
			},
		},
		"open-correction": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":open-correction"
			},
		},
		"retry": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":retry"
			},
		},
	},
}

var enterpriseWeeklyReportingPeriodSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "weekly-reporting-periods", ErrorCode: "enterprise_weekly_reporting_periods",
	Actions: map[string]enterpriseDelegatedAction{
		"director-workbench": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "deptCode", "status"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/weekly-reporting-periods/" + in.Code + "/director-workbench"
			},
		},
		"generate": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/weekly-reporting-periods/" + in.Code + ":generate"
			},
		},
	},
}

var enterpriseWeeklyReportReviewSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "weekly-report-review", ErrorCode: "enterprise_weekly_report_review",
	Actions: map[string]enterpriseDelegatedAction{
		"review": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/weekly-reports/" + in.ObjectID + ":review" },
		},
		"open-correction": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/weekly-reports/" + in.ObjectID + ":open-correction"
			},
		},
	},
}

// 项目周报页：按周期保存草稿与提交。周期键与项目 ID 同时出现，
// 路径形状与 Aims 的 projectWeeklyReportPeriodPath 一致。
var enterpriseProjectWeeklyReportSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-weekly-report-period", ErrorCode: "enterprise_project_weekly_report_period",
	Actions: map[string]enterpriseDelegatedAction{
		"save-draft": {
			Method: http.MethodPut, PermitAction: "edit", NeedsProject: true,
			CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/weekly-reports/"+in.Code+"/draft")
			},
		},
		"submit": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true,
			CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/weekly-reports/"+in.Code+":submit")
			},
		},
	},
}
