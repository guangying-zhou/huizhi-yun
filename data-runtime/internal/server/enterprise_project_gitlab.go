package server

import "net/http"

// 工作项执行页（board/:workItemId/execution）的 GitLab 依赖。
//
// 其中两条是混合型：宿主 BFF 自己调 GitLab（Foundation gitIntegration），
// 只把元数据与写回交给 Runtime。这里提供的正是那两半中属于 Runtime 的部分：
//   - commit-diff-metadata：取提交所属仓库与 sha，供宿主去 GitLab 拉 diff
//   - commit-files-changed：把 GitLab 返回的文件数写回
//   - gitlab-sync-context / gitlab-commit-ingest：同步任务的上下文与入库
// 提交列表本身是纯读取，走 Aims 的项目范围通用路由。

var enterpriseProjectGitlabSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-gitlab", ErrorCode: "enterprise_project_gitlab",
	Actions: map[string]enterpriseDelegatedAction{
		"commits": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "page_size", "workItemId", "work_item_id", "repoProjectCode", "unlinked"},
			Target:    func(in enterpriseDelegatedInput) string { return enterpriseProjectScopedPath(in, "/gitlab-commits") },
		},
		"sync-context": {
			Method: http.MethodGet, PermitAction: "view", NeedsProject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/gitlab-sync-context")
			},
		},
		"commit-ingest": {
			Method: http.MethodPost, PermitAction: "edit", NeedsProject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return enterpriseProjectScopedPath(in, "/gitlab-commits/ingest")
			},
		},
	},
}

var enterpriseWorkItemCommitDiffSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-commit-diff", ErrorCode: "enterprise_work_item_commit_diff",
	Actions: map[string]enterpriseDelegatedAction{
		"metadata": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/work-items/" + in.ObjectID + "/commits/" + in.SubID + "/diff-metadata"
			},
		},
		"files-changed": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/work-items/" + in.ObjectID + "/commits/" + in.SubID + "/files-changed"
			},
		},
	},
}
