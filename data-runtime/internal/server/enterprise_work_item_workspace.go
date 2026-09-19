package server

import "net/http"

// 工作项细化与执行：项目详情里工作项子页面所需的读写端点。
//
// 全部委托给既有 Aims handler，企业侧只负责服务身份、精确 capability、permit
// 与 actor 绑定，以及把 current_user 覆盖成已验签 actor。目标路径由本文件构造，
// 调用方只能提供经正则校验的数字 ID。
//
// 运行时路径与前端路径不同名的两处保持运行时的写法：
// decompose-context -> /decompose-context-data，source-sections -> /source-sections-data。
//
// capability 按子资源拆分，而不是复用 aims:work-items:*：读评论与删工时是
// 不同后果的操作，grant 漂移时要能分别收敛。

func enterpriseWorkItemPath(in enterpriseDelegatedInput, suffix string) string {
	return "/v1/aims/work-items/" + in.ObjectID + suffix
}

var enterpriseWorkItemCommentSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-comments", ErrorCode: "enterprise_work_item_comments",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/comments") },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/comments") },
		},
	},
}

var enterpriseWorkItemCommitSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-commits", ErrorCode: "enterprise_work_item_commits",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/commits") },
		},
		"link": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/commits") },
		},
		"unlink": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/commits/"+in.SubID) },
		},
	},
}

var enterpriseWorkItemDocumentSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-documents", ErrorCode: "enterprise_work_item_documents",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/documents") },
		},
		"link": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/documents") },
		},
		"unlink": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/documents/"+in.SubID) },
		},
		// 集合级 DELETE 对应 Aims 的 unlinkWorkItemDocument(workItemID, "")，
		// 解除该工作项当前绑定的文档，与按 ID 解绑是同一动作的两种入口。
		"unlink-current": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/documents") },
		},
	},
}

var enterpriseWorkItemTimeEntrySpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-time-entries", ErrorCode: "enterprise_work_item_time_entries",
	Actions: map[string]enterpriseDelegatedAction{
		"view": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/time-entries") },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/time-entries") },
		},
		"update": {
			Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/time-entries/"+in.SubID) },
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/time-entries/"+in.SubID) },
		},
	},
}

var enterpriseWorkItemExecutionSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-execution", ErrorCode: "enterprise_work_item_execution",
	Actions: map[string]enterpriseDelegatedAction{
		"transitions": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/transitions") },
		},
		"context": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/execution-context") },
		},
		"source-sections": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/source-sections-data") },
		},
		"decompose-context": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/decompose-context-data") },
		},
		"children": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/children") },
		},
	},
}

var enterpriseWorkItemDecompositionSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-decomposition", ErrorCode: "enterprise_work_item_decomposition",
	Actions: map[string]enterpriseDelegatedAction{
		"submit": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/decompose-submit") },
		},
		"clone-from-template": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/clone-from-template") },
		},
	},
}

var enterpriseWorkItemDeliverableSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-deliverables", ErrorCode: "enterprise_work_item_deliverables",
	Actions: map[string]enterpriseDelegatedAction{
		"update": {
			Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return enterpriseWorkItemPath(in, "/deliverables/"+in.SubID) },
		},
	},
}

var enterpriseWorkItemBatchSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "work-item-batch", ErrorCode: "enterprise_work_item_batch",
	Actions: map[string]enterpriseDelegatedAction{
		"update": {
			Method: http.MethodPatch, PermitAction: "edit", AllowScope: true, AllowPayload: true,
			Target: func(enterpriseDelegatedInput) string { return "/v1/aims/work-items/batch" },
		},
	},
}
