package server

import (
	"net/http"
	"regexp"
)

// 项目计划页：模板版本读取、里程碑周期开启、需求目标创建。
//
// 注意 rollover 的性质与其余委托端点不同：它落在 Aims 的 service 路径上，
// rolloverProjectMilestone 不接收 query，也不做逐用户判定——授权完全由调用方
// 负责。独立应用是在 BFF 里做 assertRolloverWriteAccess（项目经理或该项目范围
// 管理员），宿主必须做同样的判定后才可调用，因此这里单列 capability，
// 不与项目读写混用。

var enterpriseDelegatedProjectCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

var enterpriseProjectTemplateVersionSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-template-versions", ErrorCode: "enterprise_project_template_versions",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "status", "templateKey"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/project-template-versions" },
		},
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/project-template-versions/" + in.ObjectID
			},
		},
	},
}

var enterpriseMilestoneRolloverSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "milestone-rollover", ErrorCode: "enterprise_milestone_rollover",
	Actions: map[string]enterpriseDelegatedAction{
		"execute": {
			Method: http.MethodPost, PermitAction: "execute",
			CodePattern: enterpriseDelegatedProjectCode, NeedsSub: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/service/projects/" + in.Code + "/milestones/" + in.SubID + ":rollover"
			},
		},
	},
}

var enterpriseRequirementTargetSpec = enterpriseDelegatedSpec{
	// Aims 只提供 POST 创建，没有列表读取；不臆造 list。
	Domain: "aims", Resource: "requirement-targets", ErrorCode: "enterprise_requirement_targets",
	Actions: map[string]enterpriseDelegatedAction{
		"create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/requirement-targets")
			},
		},
	},
}
