package server

// 委托型企业端点的唯一注册表。新增资源组只在这里加一行，server.go 的分发保持一条。
//
// 入站一律是 POST + JSON 信封（租户、部署、ID、query、payload、permit）；
// 信封里的 Method 不由调用方提供，而是各 action 在 spec 中固定声明。
var enterpriseDelegatedRoutes = buildEnterpriseDelegatedRoutes(
	enterpriseWorkItemCommentSpec,
	enterpriseWorkItemCommitSpec,
	enterpriseWorkItemDocumentSpec,
	enterpriseWorkItemTimeEntrySpec,
	enterpriseWorkItemExecutionSpec,
	enterpriseWorkItemDecompositionSpec,
	enterpriseWorkItemDeliverableSpec,
	enterpriseWorkItemBatchSpec,
	enterpriseProjectFavoriteSpec,
	enterpriseProjectRepoSpec,
	enterpriseProjectWorkItemListSpec,
	enterpriseProjectDeliverableSpec,
	enterpriseProjectReleaseSpec,
	enterpriseProjectMilestoneSpec,
	enterpriseProjectRoutineReviewSpec,
	enterpriseProjectPortfolioSpec,
	enterpriseProjectDeleteSpec,
	enterpriseMyWorkItemSpec,
	enterpriseTimeEntryReviewSpec,
	enterpriseUserTimeEntrySpec,
	enterpriseProjectTimeEntrySpec,
	enterpriseTimesheetWeekSpec,
	enterpriseCompanyWeeklySummarySpec,
	enterpriseWeeklyReportingPeriodSpec,
	enterpriseWeeklyReportReviewSpec,
	enterpriseProjectWeeklyReportSpec,
	enterpriseProjectTemplateVersionSpec,
	enterpriseMilestoneRolloverSpec,
	enterpriseRequirementTargetSpec,
	enterpriseProjectGitlabSpec,
	enterpriseWorkItemCommitDiffSpec,
)

// enterpriseDelegatedCapabilities 列出注册表当前要求的全部精确 capability，
// 供 Console grant 播种与契约测试比对，避免 grant 与代码各维护一份清单。
func enterpriseDelegatedCapabilities() []string {
	seen := map[string]struct{}{}
	list := []string{}
	for _, route := range enterpriseDelegatedRoutes {
		capability := route.Spec.Domain + ":" + route.Spec.Resource + ":" + route.Spec.Actions[route.Action].PermitAction
		if _, ok := seen[capability]; ok {
			continue
		}
		seen[capability] = struct{}{}
		list = append(list, capability)
	}
	return list
}
