package server

import "net/http"

// 第 0 批：项目线共享依赖。
//
// 这三组不属于某一个页面，而是 useProjectStore 与 ProjectNavbar 的前提——
// 18 个项目页共用它们，缺任意一个，页面就整体切不过来。
//
// 收藏按 current_user 取当前用户自己的记录，Aims 侧没有额外访问检查；
// 这是安全的，前提是 current_user 只能由运行时用已验签 actor 写入
// （见 enterpriseDelegatedQuery）。调用方自带该键会被直接拒绝。
// 仓库与项目工作项的对象级授权仍由 Aims 的
// requireProjectReadAccess / requireProjectUpdateAccess 执行。

func enterpriseProjectScopedPath(in enterpriseDelegatedInput, suffix string) string {
	return "/v1/aims/projects/" + in.ProjectID + suffix
}

var enterpriseProjectFavoriteSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-favorites", ErrorCode: "enterprise_project_favorites",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view",
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/favorites" },
		},
		"add": {
			Method: http.MethodPost, PermitAction: "edit", AllowPayload: true,
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/favorites" },
		},
		"remove": {
			Method: http.MethodDelete, PermitAction: "edit", AllowPayload: true,
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/favorites" },
		},
	},
}

var enterpriseProjectRepoSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-repos", ErrorCode: "enterprise_project_repos",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/repos") },
		},
		"link": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/repos") },
		},
		// Aims 从 query 的 repoProjectCode 解析解绑目标，不是路径段。
		"unlink": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{"repoProjectCode"},
			Target:    func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/repos") },
		},
	},
}

var enterpriseProjectWorkItemListSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-work-items", ErrorCode: "enterprise_project_work_items",
	Actions: map[string]enterpriseDelegatedAction{
		// 筛选键取 projectWorkItemsWhere 实际读取的集合；宿主已有的
		// POST /projects/:id/work-items 是创建，这里补的是缺失的列表读取。
		"list": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{
				// Aims 的 projectWorkItemsWhere 用 firstNonEmptyProjectParam，两种写法都认；
				// 调用方混用驼峰与蛇形（plan.vue 发 milestone_id），两种都放行才不会整表 400。
				"page", "pageSize", "page_size", "view", "type", "tier", "status", "priority", "search",
				"milestoneId", "milestone_id", "assigneeUid", "assignee_uid",
				"customerCode", "customer_code", "environmentCode", "environment_code",
				"slaStatusSnapshot", "sla_status_snapshot", "slaStatus",
			},
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/work-items") },
		},
	},
}

// 例行项目的季度评审：项目看板页读取。Aims 侧由 requireProjectReadAccess
// 判定项目可见性，并对非例行项目返回 400。
var enterpriseProjectRoutineReviewSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-routine-review", ErrorCode: "enterprise_project_routine_review",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/routine-review") },
		},
	},
}
