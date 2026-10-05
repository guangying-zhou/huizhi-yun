package server

import (
	"net/http"
	"regexp"
)

// 项目计划页：模板版本读取、里程碑周期开启、需求目标创建。
//
// 人工 rollover 仍使用独立 capability，且要求签名 projects:edit 范围许可。
// Runtime 在事务内复核当前项目经理/范围管理员及范围，再读取既有周期快照；
// 独立应用与固定 system 定时 rollover 保持原授权路径。

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
			CodePattern: enterpriseDelegatedProjectCode, NeedsSub: true, AllowPayload: true, AllowScope: true, ScopeResource: "projects",
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
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true, ScopeResource: "projects",
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/requirement-targets")
			},
		},
	},
}
