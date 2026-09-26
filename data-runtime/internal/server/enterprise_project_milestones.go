package server

import "net/http"

// 第 3 批（提前）：里程碑。
//
// useMilestoneStore 是项目工作项页的传递依赖——页面只读 milestones 数组，
// 但 store 自身的读写必须可用，否则任何调用都会 404。
//
// 列表与创建走 Aims 的项目范围通用路由（requireProjectReadAccess /
// requireProjectUpdateAccess），更新与删除走直取路径。

var enterpriseProjectMilestoneSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-milestones", ErrorCode: "enterprise_project_milestones",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "status"},
			Target:    func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/milestones") },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/milestones") },
		},
		"update": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/milestones/" + in.ObjectID },
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/milestones/" + in.ObjectID },
		},
	},
}
