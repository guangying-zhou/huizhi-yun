package server

import "net/http"

// 第 2 批：交付物与项目版本。
//
// 这两组是项目工作项页（aims/app/pages/projects/[id]/work-items.vue 及其
// TargetEditModal / TargetInfoModal）剩余的依赖。
//
// 交付物列表没有"先判权限再查"的守卫，而是把可见性写进 SQL：
// listDeliverables 调用 projectVisibilityWhere(query, "p", uid)，按 current_user
// 与 current_user_* 范围键过滤。所以这里必须放行范围键（AllowScope），
// 且 current_user 只能由运行时用已验签 actor 写入——两者缺一，过滤就失效。
// 独立应用侧的等价动作是中间件的 needsProjectVisibilityContext /
// needsProjectScopedAdminListContext。

var enterpriseProjectDeliverableSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-deliverables", ErrorCode: "enterprise_project_deliverables",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", AllowScope: true,
			QueryKeys: []string{
				// 取自 Aims listDeliverables 的实际读取集合，驼峰与蛇形两种都认，
				// 调用方混用（plan.vue 发 project_id），只放行一种会整表 400。
				"entityId", "entity_id", "entityType", "entity_type",
				"projectId", "project_id", "status",
				"deliverableType", "deliverable_type", "deliverableId", "deliverable_id",
				"documentUuid", "document_uuid", "page", "pageSize",
			},
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/deliverables" },
		},
		"update": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/deliverables/" + in.ObjectID },
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/deliverables/" + in.ObjectID },
		},
		"batch-create": {
			Method: http.MethodPost, PermitAction: "edit", AllowScope: true, AllowPayload: true,
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/deliverables/batch" },
		},
	},
}

var enterpriseProjectReleaseSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-releases", ErrorCode: "enterprise_project_releases",
	Actions: map[string]enterpriseDelegatedAction{
		// 页面只读版本下拉；创建走产品线既有入口，这里不开写。
		"list": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{"page", "pageSize"},
			Target:    func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/releases") },
		},
	},
}
