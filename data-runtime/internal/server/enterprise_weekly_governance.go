package server

import "net/http"

// 全局周报页：公司周报汇总、周期治理、周报审阅。
//
// 公司周报与周期用周期键（2026-W30），周报用数字 ID，两者分属不同 spec，
// 避免一个 action 同时接受 Code 与 SubID 造成入参含糊。

// 周报治理动作的 current_user_* 是权限/持有人派生标志，不是数据范围键：
// 运行时无法评估 Console 策略与唯一项目总监持有人，因此沿用项目集
// （enterprise_project_portfolios.go）的信任边界——只接受已验签的
// enterprise 服务身份传入；宿主先丢弃调用方自带的同名参数，再按已验证
// 会话的 weekly_reports:review/configure 与 Console 持有人查询（带修订号）
// 注入（enterprise/server/utils/enterpriseAimsWeeklyGovernance.ts）。
var enterpriseCompanyWeeklySummarySpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "company-weekly-summaries", ErrorCode: "enterprise_company_weekly_summaries",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/company-weekly-summaries/" + in.Code },
		},
		"versions": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + "/versions"
			},
		},
		"save-draft": {
			Method: http.MethodPut, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + "/draft"
			},
		},
		"generate": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":generate"
			},
		},
		// 收件人解析标志与总监标志同一信任边界：只有 Host 在服务端按 Runtime 当前
		// 抄送选择、经 Console 目录实际展开为 active UID 后才写入；payload 中的
		// resolvedRecipients/coveredSelectionKeys 仍由 Aims 按冻结选择逐项核对。
		"publish": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision", "company_summary_recipient_resolution_verified"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":publish"
			},
		},
		"cancel-publish": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":cancel-publish"
			},
		},
		"open-correction": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/company-weekly-summaries/" + in.Code + ":open-correction"
			},
		},
		"retry": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
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
			QueryKeys: []string{"page", "pageSize", "deptCode", "status", "current_user_is_project_director"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/weekly-reporting-periods/" + in.Code + "/director-workbench"
			},
		},
		"generate": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_can_configure_weekly_reports", "current_user_project_director_revision"},
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/weekly-reporting-periods/" + in.Code + ":generate"
			},
		},
	},
}

// 周报设置（公司级单行配置）：读取与整体替换。current_user_can_configure_weekly_reports
// 与周期生成同一信任边界——宿主丢弃调用方自带值，只按已验证会话的
// weekly_reports:configure 写入；人员许可固定为本资源的 configure 动作，
// 不接受范围键或对象 ID。整体替换要求 Idempotency-Key（enterprise_delegated.go）。
var enterpriseWeeklyReportingSettingsSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "weekly-reporting-settings", ErrorCode: "enterprise_weekly_reporting_settings",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "configure",
			QueryKeys: []string{"current_user_can_configure_weekly_reports"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/admin/weekly-reporting-settings" },
		},
		"update": {
			Method: http.MethodPut, PermitAction: "configure", AllowPayload: true,
			QueryKeys: []string{"current_user_can_configure_weekly_reports"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/admin/weekly-reporting-settings" },
		},
	},
}

var enterpriseWeeklyReportReviewSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "weekly-report-review", ErrorCode: "enterprise_weekly_report_review",
	Actions: map[string]enterpriseDelegatedAction{
		"review": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/weekly-reports/" + in.ObjectID + ":review" },
		},
		"open-correction": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_is_project_director", "current_user_project_director_revision"},
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
			Method: http.MethodPut, PermitAction: "edit", NeedsProject: true, ScopeResource: "reports",
			CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/weekly-reports/"+in.Code+"/draft")
			},
		},
		"submit": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, ScopeResource: "reports",
			CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/weekly-reports/"+in.Code+":submit")
			},
		},
	},
}
