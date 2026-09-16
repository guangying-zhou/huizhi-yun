package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workspaceTask struct {
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"projectId"`
	ItemKey     string  `json:"itemKey"`
	Tier        string  `json:"tier"`
	Type        string  `json:"type"`
	TemplateKey *string `json:"templateKey"`
	Title       string  `json:"title"`
	Status      string  `json:"status"`
	Priority    string  `json:"priority"`
	DueDate     *string `json:"dueDate"`
	ProjectName string  `json:"projectName"`
}

type workspaceActivity struct {
	ID          int64   `json:"id"`
	WorkItemID  int64   `json:"workItemId"`
	FieldName   string  `json:"fieldName"`
	OldValue    *string `json:"oldValue"`
	NewValue    *string `json:"newValue"`
	ChangedBy   string  `json:"changedBy"`
	ChangedAt   string  `json:"changedAt"`
	ItemKey     string  `json:"itemKey"`
	ItemTitle   string  `json:"itemTitle"`
	ProjectName string  `json:"projectName"`
}

type workspaceStats struct {
	Todo         int64 `json:"todo"`
	InProgress   int64 `json:"inProgress"`
	DoneThisWeek int64 `json:"doneThisWeek"`
	DueToday     int64 `json:"dueToday"`
}

type workspaceProjectStats struct {
	Managed       int64 `json:"managed"`
	Participating int64 `json:"participating"`
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	if data, operation, handled, err := a.handleProductPlanningDependenciesReadRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningDependenciesEditRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProductPlanningSelectionRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProductPlanningSelectionPreviewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProductPlanningCapacityRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningMatrixRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningQueuePreviewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningQueueMoveRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningAssessmentListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningRICEAssessmentCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningAssessmentCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCandidateAddRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCandidateListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCommentsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningObservationViewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningConsumptionViewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningConsumptionConfirmRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningWithdrawalRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningWithdrawalPreviewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningBudgetChangeRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningBudgetPreviewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningReviewListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningObservationListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningObservationCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleReviewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleCloseRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleOpenRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleEditRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCycleViewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningEditRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningViewRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductListRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleCatalogRefreshRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestMergeRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestSourceDeleteRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestSourceCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestSourcesRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCrossDependenciesRuntime(ctx, method, path, query, body); handled {
		if err != nil {
			return nil, operation, err
		}
		return map[string]any{"code": 0, "data": data}, operation, nil
	}
	if data, operation, handled, err := a.handleProductReachRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductModelsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductSavedViewsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCenterRoadmapsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCenterObjectivesRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCenterComponentsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCenterVersionsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductHandoffRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureLifecycleRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureUnscheduledRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureRoadmapRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductPlanningFeatureRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureRequestsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureDeleteRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureComponentRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureEditRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentPurposeRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentRestoreRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeedbackRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductCostFreezeRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentRequestRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentRemoveRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductDocumentReadRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureReadRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductFeatureCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestReadRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestDecisionRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestEditRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductRequestCreateRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductOnboardRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductMembersRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductWorkspaceRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductAuthorizationRuntime(ctx, method, path, query); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if err := a.enforceMilestoneCompletionLockForMutation(ctx, method, path); err != nil {
		return nil, "aims.milestone_completion.lock_guard", err
	}
	if data, operation, handled, err := a.handleProjectGovernanceResponsibilityRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProjectWeeklyReportGovernanceRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleTimeEntryGovernanceRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleCompanyWeeklySummaryGovernanceRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProjectManagementFactsRuntime(ctx, method, path, query); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleExternalTasksRuntime(ctx, method, path, query); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleMilestoneCompletionGovernanceRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleNotificationDetailAuthorizationRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleDueNotificationRuntime(ctx, method, path, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleIntegrationOperationRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleProductVersionRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handleRoutineProjectBatchRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectTemplateVersionRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectEnvironmentRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectCostSummaryRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}
	if data, operation, handled, err := a.handlePIVRViewsRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleServiceContractRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if path == "/v1/aims/favorites" {
		data, operation, err := a.handleFavoritesRuntime(ctx, method, query, body)
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handlePortfoliosRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleDeliverablesRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectDocumentRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectReposRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectMilestonesRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleDirectMilestonesRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectGitlabCommitsRuntime(ctx, method, path, query); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleGitlabIssueSyncRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if method == http.MethodGet && path == "/v1/aims/workspace" {
		uid := strings.TrimSpace(query.Get("current_user"))
		if uid == "" {
			return nil, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
		}
		data, err := a.workspace(ctx, uid)
		return map[string]any{"code": 0, "data": data}, "aims.workspace.read", err
	}

	if method == http.MethodGet {
		if path == "/v1/aims/admin/projects" {
			data, err := a.adminProjects(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.admin.projects.list", err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/admin/projects/"); ok {
			if err := requireProjectAdminAccess(query, body, projectID); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims.admin.projects.get"
			}
			return data, operation, err
		}

		if path == "/v1/aims/weekly-reports" || path == "/v1/aims/weekly-reports/export-data" {
			data, err := a.projectWeeklyReportSummary(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.weekly_reports.summary", err
		}

		if path == "/v1/aims/approvals" {
			data, err := a.approvalList(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.approvals.list", err
		}

		if path == "/v1/aims/requirements" || path == "/v1/aims/requirement-contents" || path == "/v1/aims/requirement-reviews" {
			data, err := a.directRequirementCollectionList(ctx, path, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.direct_collection.list", err
		}

		if path == "/v1/aims/authorization/instance-conflict-facts" {
			data, err := a.aimsInstanceConflictFacts(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.authorization.instance_conflict_facts", err
		}

		if path == "/v1/aims/projects/check-duplicate" {
			data, err := a.projectDuplicateCheck(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.duplicate_check", err
		}

		if projectID, ok := projectAuthorizationObjectPath(path); ok {
			data, err := a.projectAuthorizationObject(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.authorization_object.read", err
		}

		if path == "/v1/aims/projects" {
			data, err := a.memberProjects(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.list", err
		}

		if path == "/v1/aims/work-items" {
			data, err := a.directWorkItems(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.list", err
		}

		if path == "/v1/aims/my-work-items" {
			data, err := a.myWorkItems(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.my_work_items.list", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/breakdown-context"); ok {
			data, err := a.workItemBreakdownContext(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.breakdown_context.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/decompose-context-data"); ok {
			data, err := a.workItemDecomposeContextData(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.decompose_context_data.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/execution-context"); ok {
			data, err := a.workItemExecutionContext(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.execution_context.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/source-sections-data"); ok {
			data, err := a.workItemSourceSectionAnchors(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.source_sections.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/children"); ok {
			data, err := a.workItemChildren(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.children.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/transitions"); ok {
			data, err := a.workItemTransitions(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.transitions.read", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/commits"); ok {
			data, err := a.workItemCommits(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.commits.read", err
		}

		if workItemID, commitID, ok := workItemCommitSubPath(path, "/diff-metadata"); ok {
			data, err := a.workItemCommitDiffMetadata(ctx, workItemID, commitID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.commits.diff_metadata", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/comments"); ok {
			data, err := a.workItemComments(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.comments.list", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/documents"); ok {
			data, err := a.workItemDocuments(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.documents.list", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/time-entries"); ok {
			data, err := a.workItemTimeEntries(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.time_entries.list", err
		}

		if workItemID, ok := directPathParam(path, "/v1/aims/work-items/"); ok {
			data, err := a.workItemDetail(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.detail", err
		}

		if milestoneID, ok := pathParam(path, "/v1/aims/milestones/", "/detail"); ok {
			data, err := a.milestoneDetail(ctx, milestoneID, query)
			return map[string]any{"code": 0, "data": data}, "aims.milestones.detail.read", err
		}

		if uid, ok := pathParam(path, "/v1/aims/users/", "/time-entries"); ok {
			data, err := a.userTimeEntries(ctx, uid, query)
			return map[string]any{"code": 0, "data": data}, "aims.users.time_entries.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/time-entries"); ok {
			data, err := a.projectTimeEntries(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.time_entries.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/work-items"); ok {
			data, err := a.projectWorkItems(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.work_items.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/members"); ok {
			data, err := a.listProjectMembers(ctx, projectID, query, body)
			return data, "aims.projects.members.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/weekly-reports"); ok {
			data, err := a.projectWeeklyReports(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.weekly_reports.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirements/codocs-candidates-data"); ok {
			data, err := a.projectCodocsCandidateCodes(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirements.codocs_candidates.read", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirements/export-data"); ok {
			data, err := a.projectRequirementsExportData(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirements.export.read", err
		}

		if contentID, ok := pathParam(path, "/v1/aims/requirement-contents/", "/relations"); ok {
			data, err := a.requirementContentRelations(ctx, contentID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_contents.relations.list", err
		}

		if requirementID, ok := pathParam(path, "/v1/aims/requirements/", "/versions"); ok {
			data, err := a.requirementVersions(ctx, requirementID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.versions.list", err
		}

		if requirementID, ok := pathParam(path, "/v1/aims/requirements/", "/change-diff"); ok {
			data, err := a.requirementChangeDiff(ctx, requirementID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.change_diff.read", err
		}

		if requirementID, ok := pathParam(path, "/v1/aims/requirements/", "/change-impact"); ok {
			data, err := a.requirementChangeImpact(ctx, requirementID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.change_impact.read", err
		}

		if requirementID, ok := directPathParam(path, "/v1/aims/requirements/"); ok {
			data, err := a.requirementDetail(ctx, requirementID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.detail", err
		}

		if batchID, ok := directPathParam(path, "/v1/aims/requirement-reviews/"); ok {
			data, err := a.requirementReviewBatchDetail(ctx, batchID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.detail", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirement-reviews"); ok {
			data, err := a.projectRequirementReviews(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirement_reviews.list", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/gitlab-sync-context"); ok {
			data, err := a.gitlabSyncContext(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.gitlab_sync_context.read", err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/projects/"); ok {
			data, err := a.projectDetail(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.detail", err
		}

		if data, operation, handled, err := a.handleProjectScopedGenericRuntime(ctx, method, path, query, body); handled {
			return data, operation, err
		}
	}

	if method == http.MethodPost {
		if path == "/v1/aims/projects" {
			data, err := a.createProjectWithProductBinding(ctx, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.create", err
		}

		if path == "/v1/aims/approvals" {
			data, err := a.createApprovalRecord(ctx, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.approvals.create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/members"); ok {
			data, err := a.addProjectMember(ctx, projectID, query, body)
			return data, "aims.projects.members.create", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/approve"); ok {
			data, err := a.approveRequirementReviewBatch(ctx, batchID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.approve", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/reject"); ok {
			data, err := a.rejectRequirementReviewBatch(ctx, batchID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.reject", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/withdraw"); ok {
			data, err := a.withdrawRequirementReviewBatch(ctx, batchID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.withdraw", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/sync-workflow"); ok {
			data, err := a.syncRequirementReviewWorkflow(ctx, batchID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.sync_workflow", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/create-tasks"); ok {
			data, err := a.createTasksForReviewBatch(ctx, batchID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.create_tasks", err
		}

		if batchID, ok := pathParam(path, "/v1/aims/requirement-reviews/", "/append-requirements"); ok {
			data, err := a.appendRequirementsToReviewBatch(ctx, batchID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_reviews.append_requirements", err
		}

		if reqID, ok := pathParam(path, "/v1/aims/requirements/", "/create-task"); ok {
			data, err := a.createRequirementTask(ctx, reqID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.create_task", err
		}

		if reqID, ok := pathParam(path, "/v1/aims/requirements/", "/changes"); ok {
			data, err := a.createRequirementChangeDraft(ctx, reqID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.changes.create", err
		}

		if contentID, ok := pathParam(path, "/v1/aims/requirement-contents/", "/restore"); ok {
			data, err := a.restoreRequirementContent(ctx, contentID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_contents.restore", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/gitlab-commits/ingest"); ok {
			data, err := a.ingestGitlabCommits(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.gitlab_commits.ingest", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/work-items"); ok {
			data, err := a.createProjectWorkItem(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.work_items.create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirement-reviews"); ok {
			data, err := a.createRequirementReviewBatch(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirement_reviews.create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirements"); ok {
			data, err := a.createProjectRequirement(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirements.create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirement-contents"); ok {
			data, err := a.createProjectRequirementContent(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirement_contents.create", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/commits"); ok {
			data, err := a.linkWorkItemCommit(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.commits.link", err
		}

		if workItemID, commitID, ok := workItemCommitSubPath(path, "/files-changed"); ok {
			data, err := a.updateWorkItemCommitFilesChanged(ctx, workItemID, commitID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.commits.files_changed", err
		}

		if milestoneID, ok := pathParam(path, "/v1/aims/milestones/", "/review-approve"); ok {
			_ = milestoneID
			return nil, "aims.milestones.review_approve.retired", httperror.New(
				http.StatusGone,
				"milestone_completion_workflow_required",
				"里程碑最终完成必须通过完成申请与 Workflow 审批",
			)
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirement-targets"); ok {
			data, err := a.createRequirementChangeTarget(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirement_targets.create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/requirements/import"); ok {
			data, err := a.importProjectRequirements(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.requirements.import", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/clone-from-template"); ok {
			data, err := a.cloneWorkItemFromTemplate(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.clone_from_template", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/comments"); ok {
			data, err := a.createWorkItemComment(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.comments.create", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/documents"); ok {
			data, err := a.linkWorkItemDocument(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.documents.link", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/append-tasks"); ok {
			data, err := a.appendWorkItemTasks(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.append_tasks", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/confirm-append"); ok {
			data, err := a.confirmAppendWorkItems(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.confirm_append", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/reject-append"); ok {
			data, err := a.rejectAppendWorkItems(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.reject_append", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/confirm-distribute"); ok {
			data, err := a.confirmDistributeWorkItems(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.confirm_distribute", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/revoke-distribute"); ok {
			data, err := a.revokeDistributeWorkItems(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.revoke_distribute", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/decompose-submit"); ok {
			data, err := a.workItemDecomposeSubmit(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.decompose_submit", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/submit"); ok {
			data, err := a.submitWorkItemBreakdown(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.submit", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/withdraw"); ok {
			data, err := a.withdrawWorkItemBreakdown(ctx, workItemID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.withdraw", err
		}

		if path == "/v1/aims/deliverables/batch" {
			data, err := a.createDeliverablesBatch(ctx, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.deliverables.batch_create", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/weekly-reports"); ok {
			data, err := a.saveProjectWeeklyReport(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.weekly_reports.save", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/time-entries"); ok {
			data, err := a.createProjectTimeEntry(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.time_entries.create", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/time-entries"); ok {
			data, err := a.createWorkItemTimeEntry(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.time_entries.create", err
		}

		if data, operation, handled, err := a.handleProjectScopedGenericRuntime(ctx, method, path, query, body); handled {
			return data, operation, err
		}
	}

	if method == http.MethodPatch || method == http.MethodPut {
		if method == http.MethodPatch && path == "/v1/aims/work-items/batch" {
			data, err := a.batchUpdateWorkItems(ctx, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.batch_update", err
		}

		if workItemID, deliverableID, ok := nestedPathParam(path, "/v1/aims/work-items/", "/deliverables/"); ok {
			data, err := a.updateWorkItemDeliverable(ctx, workItemID, deliverableID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.deliverables.update", err
		}

		if workItemID, entryID, ok := nestedPathParam(path, "/v1/aims/work-items/", "/time-entries/"); ok {
			data, err := a.updateWorkItemTimeEntry(ctx, workItemID, entryID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.time_entries.update", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/breakdown"); ok {
			data, err := a.saveWorkItemBreakdown(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.breakdown.save", err
		}

		if workItemID, ok := directPathParam(path, "/v1/aims/work-items/"); ok {
			if err := a.requireWorkItemProjectMemberOrScopedAdmin(ctx, workItemID, query); err != nil {
				return nil, "", err
			}
			parsedWorkItemID, parseErr := parseID(workItemID, "work_item_id")
			if parseErr != nil {
				return nil, "", parseErr
			}
			if err := a.requireWorkItemMilestoneCompletionUnlocked(ctx, parsedWorkItemID); err != nil {
				return nil, "", err
			}
			if newMilestoneID, parseErr := bodyInt64(body, "milestoneId", "milestone_id"); parseErr == nil && newMilestoneID > 0 {
				if err := a.requireMilestoneCompletionUnlocked(ctx, newMilestoneID); err != nil {
					return nil, "", err
				}
			}
			var versionFieldsUpdate workItemVersionFieldsUpdate
			if hasAnyBodyKey(body, "version_id", "versionId", "feature_id", "featureId") {
				var err error
				versionFieldsUpdate, err = a.prepareWorkItemVersionFieldsUpdate(ctx, workItemID, query, body)
				if err != nil {
					return nil, "", err
				}
			}
			data, operation, err := a.Adapter.HandleRuntimeUpdateWithTxHook(ctx, method, path, query, body, func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
				if err := validateRoutineWorkItemTx(ctx, tx, identifier); err != nil {
					return nil, err
				}
				if versionFieldsUpdate != nil {
					if err := versionFieldsUpdate(ctx, tx); err != nil {
						return nil, err
					}
				}
				return a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, identifier, body)
			})
			if operation == "" {
				operation = "aims.work_items.update"
			}
			return data, operation, err
		}

		if documentID, ok := directPathParam(path, "/v1/aims/documents/"); ok {
			if err := a.requireDirectProjectDocumentMemberOrScopedAdmin(ctx, documentID, query); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims.documents.update"
			}
			return data, operation, err
		}

		if approvalID, ok := directPathParam(path, "/v1/aims/approvals/"); ok {
			data, err := a.processDirectApprovalDecision(ctx, approvalID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.approvals.decision", err
		}

		if requirementID, ok := directPathParam(path, "/v1/aims/requirements/"); ok {
			data, err := a.updateRequirementMetadata(ctx, requirementID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.update", err
		}

		if contentID, ok := directPathParam(path, "/v1/aims/requirement-contents/"); ok {
			data, err := a.updateRequirementContent(ctx, contentID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_contents.update", err
		}

		if resource, objectID, ok := directProjectManagedObjectPath(path); ok {
			if err := a.requireDirectProjectManagedObjectManagerOrScopedAdmin(ctx, resource, objectID, query); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims." + strings.ReplaceAll(resource, "-", "_") + ".update"
			}
			return data, operation, err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/admin/projects/"); ok {
			data, err := a.updateProjectWithLeaderSync(ctx, method, path, query, body, projectID)
			return data, "aims.admin.projects.update", err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/projects/"); ok {
			data, err := a.updateProjectWithLeaderSync(ctx, method, path, query, body, projectID)
			return data, "aims.projects.update", err
		}

		if projectID, entryID, ok := nestedPathParam(path, "/v1/aims/projects/", "/time-entries/"); ok {
			data, err := a.updateProjectTimeEntry(ctx, projectID, entryID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.projects.time_entries.update", err
		}
	}

	if method == http.MethodDelete {
		if workItemID, entryID, ok := nestedPathParam(path, "/v1/aims/work-items/", "/time-entries/"); ok {
			data, err := a.deleteWorkItemTimeEntry(ctx, workItemID, entryID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.time_entries.delete", err
		}

		if workItemID, commitID, ok := nestedPathParam(path, "/v1/aims/work-items/", "/commits/"); ok {
			data, err := a.unlinkWorkItemCommit(ctx, workItemID, commitID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.commits.unlink", err
		}

		if workItemID, documentID, ok := nestedPathParam(path, "/v1/aims/work-items/", "/documents/"); ok {
			data, err := a.unlinkWorkItemDocument(ctx, workItemID, documentID, query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.documents.unlink", err
		}

		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/documents"); ok {
			data, err := a.unlinkWorkItemDocument(ctx, workItemID, "", query)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.documents.unlink", err
		}

		if workItemID, ok := directPathParam(path, "/v1/aims/work-items/"); ok {
			if err := a.requireWorkItemProjectMemberOrScopedAdmin(ctx, workItemID, query); err != nil {
				return nil, "", err
			}
			parsedWorkItemID, parseErr := parseID(workItemID, "work_item_id")
			if parseErr != nil {
				return nil, "", parseErr
			}
			if err := a.requireWorkItemMilestoneCompletionUnlocked(ctx, parsedWorkItemID); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims.work_items.delete"
			}
			return data, operation, err
		}

		if documentID, ok := directPathParam(path, "/v1/aims/documents/"); ok {
			if err := a.requireDirectProjectDocumentDeleteAccess(ctx, documentID, query); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims.documents.delete"
			}
			return data, operation, err
		}

		if _, ok := directPathParam(path, "/v1/aims/approvals/"); ok {
			return nil, "", httperror.New(http.StatusMethodNotAllowed, "approval_delete_not_supported", "approval records cannot be deleted directly")
		}

		if requirementID, ok := directPathParam(path, "/v1/aims/requirements/"); ok {
			data, err := a.deleteRequirement(ctx, requirementID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirements.delete", err
		}

		if contentID, ok := directPathParam(path, "/v1/aims/requirement-contents/"); ok {
			data, err := a.deleteRequirementContent(ctx, contentID, query)
			return map[string]any{"code": 0, "data": data}, "aims.requirement_contents.delete", err
		}

		if resource, objectID, ok := directProjectManagedObjectPath(path); ok {
			if err := a.requireDirectProjectManagedObjectManagerOrScopedAdmin(ctx, resource, objectID, query); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims." + strings.ReplaceAll(resource, "-", "_") + ".delete"
			}
			return data, operation, err
		}

		if projectID, entryID, ok := nestedPathParam(path, "/v1/aims/projects/", "/time-entries/"); ok {
			data, err := a.deleteProjectTimeEntry(ctx, projectID, entryID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.time_entries.delete", err
		}

		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/members"); ok {
			data, err := a.deleteProjectMember(ctx, projectID, query, body)
			return data, "aims.projects.members.delete", err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/admin/projects/"); ok {
			data, err := a.adminDeleteProject(ctx, projectID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.admin.projects.delete", err
		}

		if projectID, ok := directPathParam(path, "/v1/aims/projects/"); ok {
			data, err := a.deleteProject(ctx, projectID, query)
			return map[string]any{"code": 0, "data": data}, "aims.projects.delete", err
		}
	}

	return a.Adapter.HandleRuntime(ctx, method, path, query, body)
}

func isRecordNotFound(err error) bool {
	if err == nil {
		return false
	}
	httpErr, ok := err.(httperror.Error)
	return ok && httpErr.Status == http.StatusNotFound && httpErr.Code == "record_not_found"
}

func (a *Adapter) workspace(ctx context.Context, uid string) (map[string]any, error) {
	tasks, err := a.workspaceTasks(ctx, uid)
	if err != nil {
		return nil, err
	}

	activity, err := a.workspaceActivity(ctx, uid)
	if err != nil {
		return nil, err
	}

	stats, err := a.workspaceStats(ctx, uid)
	if err != nil {
		return nil, err
	}

	projectStats, err := a.workspaceProjectStats(ctx, uid)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"myTasks":        tasks,
		"recentActivity": activity,
		"stats":          stats,
		"projectStats":   projectStats,
	}, nil
}

func (a *Adapter) workspaceTasks(ctx context.Context, uid string) ([]workspaceTask, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			w.id,
			w.project_id,
			w.item_key,
			w.tier,
			w.type,
			w.template_key,
			w.title,
			w.status,
			w.priority,
			DATE_FORMAT(w.due_date, '%Y-%m-%d') AS due_date,
			p.name AS project_name
		FROM work_items w
		JOIN aims_projects p ON p.id = w.project_id
		WHERE w.assignee_uid = ?
		  AND w.status != 'completed'
		ORDER BY FIELD(w.priority, 'P0', 'P1', 'P2', 'P3'), w.due_date ASC, w.id DESC
		LIMIT 20
	`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]workspaceTask, 0)
	for rows.Next() {
		var item workspaceTask
		var templateKey sql.NullString
		var dueDate sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.ItemKey,
			&item.Tier,
			&item.Type,
			&templateKey,
			&item.Title,
			&item.Status,
			&item.Priority,
			&dueDate,
			&item.ProjectName,
		); err != nil {
			return nil, err
		}
		item.TemplateKey = nullableString(templateKey)
		item.DueDate = nullableString(dueDate)
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) workspaceActivity(ctx context.Context, uid string) ([]workspaceActivity, error) {
	items, err := a.workspaceActivityRows(ctx, `
		SELECT
			c.id,
			c.work_item_id,
			c.field_name,
			c.old_value,
			c.new_value,
			c.changed_by,
			DATE_FORMAT(c.changed_at, '%Y-%m-%d %H:%i:%s') AS changed_at,
			w.item_key,
			w.title,
			p.name AS project_name
		FROM work_item_changelog c
		JOIN work_items w ON w.id = c.work_item_id
		JOIN aims_projects p ON p.id = w.project_id
		WHERE w.project_id IN (
			SELECT project_id FROM aims_project_members WHERE uid = ?
		)
		  AND c.changed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
		ORDER BY c.changed_at DESC
		LIMIT 20
	`, uid)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		return items, nil
	}

	return a.workspaceActivityRows(ctx, `
		SELECT
			w.id,
			w.id AS work_item_id,
			'work_item_updated' AS field_name,
			NULL AS old_value,
			w.status AS new_value,
			COALESCE(NULLIF(w.assignee_uid, ''), NULLIF(w.reporter_uid, ''), '') AS changed_by,
			DATE_FORMAT(w.updated_at, '%Y-%m-%d %H:%i:%s') AS changed_at,
			w.item_key,
			w.title,
			p.name AS project_name
		FROM work_items w
		JOIN aims_projects p ON p.id = w.project_id
		WHERE w.project_id IN (
			SELECT project_id FROM aims_project_members WHERE uid = ?
		)
		ORDER BY w.updated_at DESC, w.id DESC
		LIMIT 20
	`, uid)
}

func (a *Adapter) workspaceActivityRows(ctx context.Context, query string, uid string) ([]workspaceActivity, error) {
	rows, err := a.DB().QueryContext(ctx, query, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]workspaceActivity, 0)
	for rows.Next() {
		var item workspaceActivity
		var oldValue sql.NullString
		var newValue sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.WorkItemID,
			&item.FieldName,
			&oldValue,
			&newValue,
			&item.ChangedBy,
			&item.ChangedAt,
			&item.ItemKey,
			&item.ItemTitle,
			&item.ProjectName,
		); err != nil {
			return nil, err
		}
		item.OldValue = nullableString(oldValue)
		item.NewValue = nullableString(newValue)
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) workspaceStats(ctx context.Context, uid string) (workspaceStats, error) {
	todo, err := a.workspaceCount(ctx, "assignee_uid = ? AND status = 'todo'", uid)
	if err != nil {
		return workspaceStats{}, err
	}
	inProgress, err := a.workspaceCount(ctx, "assignee_uid = ? AND status = 'in_progress'", uid)
	if err != nil {
		return workspaceStats{}, err
	}
	doneThisWeek, err := a.workspaceCount(ctx, "assignee_uid = ? AND status = 'completed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)", uid)
	if err != nil {
		return workspaceStats{}, err
	}
	dueToday, err := a.workspaceCount(ctx, "assignee_uid = ? AND status != 'completed' AND DATE(due_date) = CURDATE()", uid)
	if err != nil {
		return workspaceStats{}, err
	}

	return workspaceStats{
		Todo:         todo,
		InProgress:   inProgress,
		DoneThisWeek: doneThisWeek,
		DueToday:     dueToday,
	}, nil
}

func (a *Adapter) workspaceCount(ctx context.Context, where string, uid string) (int64, error) {
	var count int64
	err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM work_items WHERE "+where, uid).Scan(&count)
	return count, err
}

func (a *Adapter) workspaceProjectStats(ctx context.Context, uid string) (workspaceProjectStats, error) {
	var stats workspaceProjectStats
	err := a.DB().QueryRowContext(ctx, `
		SELECT
			COUNT(DISTINCT CASE
				WHEN p.leader_uid = ? OR COALESCE(m.role, '') = 'manager' THEN p.id
			END) AS managed,
			COUNT(DISTINCT CASE
				WHEN m.uid IS NOT NULL
				 AND COALESCE(p.leader_uid, '') <> ?
				 AND COALESCE(m.role, '') <> 'manager'
				THEN p.id
			END) AS participating
		FROM aims_projects p
		LEFT JOIN aims_project_members m
		  ON m.project_id = p.id
		 AND m.uid = ?
		 AND m.status = 'active'
		WHERE p.lifecycle_status != 'archived'
		  AND (p.leader_uid = ? OR m.uid IS NOT NULL)
	`, uid, uid, uid, uid).Scan(&stats.Managed, &stats.Participating)
	return stats, err
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
