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
	if data, operation, handled, err := a.handleProductVersionRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectEnvironmentRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleServiceContractRuntime(ctx, method, path, query, body); handled {
		return map[string]any{"code": 0, "data": data}, operation, err
	}

	if data, operation, handled, err := a.handleProjectDocumentRuntime(ctx, method, path, query, body); handled {
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

		if path == "/v1/aims/my-work-items" {
			data, err := a.myWorkItems(ctx, query)
			return map[string]any{"code": 0, "data": data}, "aims.my_work_items.list", err
		}

		if _, ok := directPathParam(path, "/v1/aims/project-template-versions/"); ok && query.Get("optional") == "1" {
			data, op, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if isRecordNotFound(err) {
				return map[string]any{"code": 0, "data": nil}, "aims.project_template_versions.optional_get", nil
			}
			return data, op, err
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

		if milestoneID, ok := pathParam(path, "/v1/aims/milestones/", "/review-approve"); ok {
			data, err := a.approveMilestoneReview(ctx, milestoneID, query)
			return map[string]any{"code": 0, "data": data}, "aims.milestones.review_approve", err
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
		if workItemID, ok := pathParam(path, "/v1/aims/work-items/", "/breakdown"); ok {
			data, err := a.saveWorkItemBreakdown(ctx, workItemID, query, body)
			return map[string]any{"code": 0, "data": data}, "aims.work_items.breakdown.save", err
		}

		if workItemID, ok := directPathParam(path, "/v1/aims/work-items/"); ok && hasAnyBodyKey(body, "version_id", "versionId", "feature_id", "featureId") {
			if err := a.updateWorkItemVersionFields(ctx, workItemID, query, body); err != nil {
				return nil, "", err
			}
			data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
			if operation == "" {
				operation = "aims.work_items.update"
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
