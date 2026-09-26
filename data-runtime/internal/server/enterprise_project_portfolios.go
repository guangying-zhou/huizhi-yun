package server

import "net/http"

// 项目集与项目删除：项目列表页的剩余依赖。
//
// current_user_can_manage_portfolios 是一个权限派生标志，不是数据范围键，
// 所以不走 AllowScope 而是显式登记。运行时无法评估 portfolios:admin
// （那是 Console 策略，属宿主侧），因此这里沿用与范围键相同的信任边界：
// 只接受已验签的 enterprise 服务身份传入，且宿主必须在 requirePermission
// 通过后才注入、并先丢弃调用方自带的同名参数（与 Aims 中间件一致）。

var enterpriseProjectPortfolioSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-portfolios", ErrorCode: "enterprise_project_portfolios",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "search", "status", "defaultCategory"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/portfolios" },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "edit", AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/portfolios" },
		},
		"update": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID },
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, AllowScope: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID },
		},
	},
}

// 彻底删除项目：Aims 侧要求 current_user_is_project_admin=1（范围键，服务端算出），
// 独立应用还额外要求 admin:admin。宿主必须做同样的管理员判定后才可调用，
// 因此这里单独成一个 capability，不与项目读写混用。
var enterpriseProjectDeleteSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-deletion", ErrorCode: "enterprise_project_deletion",
	Actions: map[string]enterpriseDelegatedAction{
		"execute": {
			Method: http.MethodDelete, PermitAction: "execute", NeedsProject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/projects/" + in.ProjectID },
		},
	},
}
