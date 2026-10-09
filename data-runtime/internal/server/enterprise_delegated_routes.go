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
	enterpriseWeeklyReportingSettingsSpec,
	enterpriseWeeklyReportReviewSpec,
	enterpriseProjectWeeklyReportSpec,
	enterpriseProjectTemplateVersionSpec,
	enterpriseMilestoneRolloverSpec,
	enterpriseRequirementTargetSpec,
	enterpriseProjectGitlabSpec,
	enterpriseWorkItemCommitDiffSpec,
)

// enterpriseDelegatedCapabilities derives the Host transport scopes from the
// registered logical domains. Business permits remain resource/action exact.
func enterpriseDelegatedCapabilities() []string {
	seen := map[string]struct{}{}
	list := []string{}
	for _, route := range enterpriseDelegatedRoutes {
		capability := enterpriseHostDomainCapability(route.Spec.Domain)
		if capability == "" {
			panic("unsupported enterprise delegated domain: " + route.Spec.Domain)
		}
		if _, ok := seen[capability]; ok {
			continue
		}
		seen[capability] = struct{}{}
		list = append(list, capability)
	}
	return list
}
