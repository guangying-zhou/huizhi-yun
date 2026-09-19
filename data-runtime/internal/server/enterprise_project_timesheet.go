package server

import (
	"net/http"
	"regexp"
)

// 工时与任务中心：全局任务中心、项目工时、全局工时三页的依赖。
//
// 其中两条路径段不是数字：用户 uid 与周期键。它们各自带正则，
// 长度与字符集都收紧到实际形态，不共用通用兜底。

var enterpriseDelegatedUID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
var enterpriseDelegatedPeriodKey = regexp.MustCompile(`^[0-9]{4}-W[0-9]{2}$`)

var enterpriseMyWorkItemSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "my-work-items", ErrorCode: "enterprise_my_work_items",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", AllowScope: true,
			// 键取自 Aims 的 myWorkItems 实际读取集合，不是推测：
			// filter / uid / projectId(project_id) / search / tier。
			// uid 可放行：Aims 对 uid != current_user 直接 403，
			// 而 current_user 由本层用已验签 actor 写入。
			QueryKeys: []string{"filter", "uid", "projectId", "project_id", "search", "tier"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/my-work-items" },
		},
	},
}

var enterpriseTimeEntryReviewSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "time-entry-reviews", ErrorCode: "enterprise_time_entry_reviews",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "status", "cycleCode", "uid"},
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/time-entry-reviews")
			},
		},
		"submit": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/time-entry-reviews")
			},
		},
	},
}

var enterpriseUserTimeEntrySpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "user-time-entries", ErrorCode: "enterprise_user_time_entries",
	Actions: map[string]enterpriseDelegatedAction{
		// 读取的是 Code 指定用户的工时；Aims 侧仍按 current_user 与范围键判定可见性，
		// 宿主不得据此放宽——Code 只决定查询目标，不决定授权。
		"list": {
			Method: http.MethodGet, PermitAction: "view", CodePattern: enterpriseDelegatedUID, AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "startDate", "endDate", "projectId", "cycleCode"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/users/" + in.Code + "/time-entries" },
		},
	},
}

var enterpriseProjectTimeEntrySpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-time-entries", ErrorCode: "enterprise_project_time_entries",
	Actions: map[string]enterpriseDelegatedAction{
		"create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/time-entries") },
		},
		"update": {
			Method: http.MethodPatch, PermitAction: "edit", NeedsProject: true, NeedsSub: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/time-entries/"+in.SubID)
			},
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsProject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/time-entries/"+in.SubID)
			},
		},
	},
}

var enterpriseTimesheetWeekSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "timesheet-weeks", ErrorCode: "enterprise_timesheet_weeks",
	Actions: map[string]enterpriseDelegatedAction{
		"submit": {
			Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseDelegatedPeriodKey, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/timesheet/weeks/" + in.Code + ":submit" },
		},
	},
}
