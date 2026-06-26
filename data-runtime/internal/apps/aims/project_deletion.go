package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 项目删除语义与旧 Nuxt 本地实现保持一致：
//   - 成员入口 DELETE /v1/aims/projects/{id}：仅草稿状态可物理删除（含全部关联数据），
//     仅项目经理或具备全局项目管理权限（current_user_is_project_admin=1）的用户可操作。
//   - 管理员入口 DELETE /v1/aims/admin/projects/{id}：任意状态彻底删除，
//     需 body.confirmText 与项目编码或项目名称一致。
//
// work_items 必须先于 milestones 删除（fk_item_project_milestone ON DELETE RESTRICT），
// 不能依赖 aims_projects 的级联。

type projectDeletionStep struct {
	key    string
	sql    string
	params int
}

var projectDeletionSteps = []projectDeletionStep{
	{key: "deliverables", sql: "DELETE FROM deliverables WHERE project_id = ?", params: 1},
	{key: "approvals", sql: "DELETE FROM approval_records WHERE project_id = ?", params: 1},
	{key: "gitlabCommits", sql: "DELETE FROM gitlab_commits WHERE project_id = ?", params: 1},
	{key: "timeEntries", sql: "DELETE FROM time_entries WHERE project_id = ? OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?) OR weekly_report_id IN (SELECT id FROM project_weekly_reports WHERE project_id = ?)", params: 3},
	{key: "weeklyReportWorkItems", sql: "DELETE FROM project_weekly_report_work_items WHERE project_id = ?", params: 1},
	{key: "weeklyReportEntries", sql: "DELETE FROM project_weekly_report_entries WHERE project_id = ?", params: 1},
	{key: "weeklyReports", sql: "DELETE FROM project_weekly_reports WHERE project_id = ?", params: 1},
	{key: "workItemAttachments", sql: "DELETE FROM work_item_attachments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 1},
	{key: "workItemChangelog", sql: "DELETE FROM work_item_changelog WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 1},
	{key: "workItemComments", sql: "DELETE FROM work_item_comments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 1},
	{key: "workItemRelations", sql: "DELETE FROM work_item_relations WHERE source_id IN (SELECT id FROM work_items WHERE project_id = ?) OR target_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 2},
	{key: "workItemSourceAnchors", sql: "DELETE FROM work_item_source_anchors WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 1},
	{key: "requirementVersions", sql: "DELETE FROM requirement_versions WHERE requirement_id IN (SELECT id FROM requirement_items WHERE project_id = ?)", params: 1},
	{key: "requirementItemContents", sql: "DELETE FROM requirement_item_contents WHERE requirement_id IN (SELECT id FROM requirement_items WHERE project_id = ?) OR content_id IN (SELECT id FROM requirement_contents WHERE project_id = ?)", params: 2},
	{key: "requirementContents", sql: "DELETE FROM requirement_contents WHERE project_id = ?", params: 1},
	{key: "requirementItems", sql: "DELETE FROM requirement_items WHERE project_id = ?", params: 1},
	{key: "requirementReviewBatches", sql: "DELETE FROM requirement_review_batches WHERE project_id = ?", params: 1},
	{key: "projectDocuments", sql: "DELETE FROM project_documents WHERE project_id = ? OR milestone_id IN (SELECT id FROM milestones WHERE project_id = ?) OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 3},
	{key: "workItems", sql: "DELETE FROM work_items WHERE project_id = ?", params: 1},
	{key: "milestones", sql: "DELETE FROM milestones WHERE project_id = ?", params: 1},
	{key: "workflowTransitions", sql: "DELETE FROM workflow_transitions WHERE project_id = ?", params: 1},
	{key: "notificationRules", sql: "DELETE FROM notification_rules WHERE project_id = ?", params: 1},
	{key: "repos", sql: "DELETE FROM aims_project_repos WHERE project_id = ?", params: 1},
	{key: "counters", sql: "DELETE FROM project_counters WHERE project_id = ?", params: 1},
	{key: "favorites", sql: "DELETE FROM user_favorite_projects WHERE project_id = ?", params: 1},
	{key: "members", sql: "DELETE FROM aims_project_members WHERE project_id = ?", params: 1},
	{key: "projects", sql: "DELETE FROM aims_projects WHERE id = ?", params: 1},
}

type projectDeletionImpactQuery struct {
	key    string
	sql    string
	params int
}

var projectDeletionImpactQueries = []projectDeletionImpactQuery{
	{key: "members", sql: "SELECT COUNT(*) FROM aims_project_members WHERE project_id = ?", params: 1},
	{key: "repos", sql: "SELECT COUNT(*) FROM aims_project_repos WHERE project_id = ?", params: 1},
	{key: "favorites", sql: "SELECT COUNT(*) FROM user_favorite_projects WHERE project_id = ?", params: 1},
	{key: "workflowTransitions", sql: "SELECT COUNT(*) FROM workflow_transitions WHERE project_id = ?", params: 1},
	{key: "notificationRules", sql: "SELECT COUNT(*) FROM notification_rules WHERE project_id = ?", params: 1},
	{key: "projectDocuments", sql: "SELECT COUNT(*) FROM project_documents WHERE project_id = ? OR milestone_id IN (SELECT id FROM milestones WHERE project_id = ?) OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 3},
	{key: "milestones", sql: "SELECT COUNT(*) FROM milestones WHERE project_id = ?", params: 1},
	{key: "workItems", sql: "SELECT COUNT(*) FROM work_items WHERE project_id = ?", params: 1},
	{key: "workItemRelations", sql: "SELECT COUNT(*) FROM work_item_relations WHERE source_id IN (SELECT id FROM work_items WHERE project_id = ?) OR target_id IN (SELECT id FROM work_items WHERE project_id = ?)", params: 2},
	{key: "timeEntries", sql: "SELECT COUNT(*) FROM time_entries WHERE project_id = ? OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?) OR weekly_report_id IN (SELECT id FROM project_weekly_reports WHERE project_id = ?)", params: 3},
	{key: "weeklyReports", sql: "SELECT COUNT(*) FROM project_weekly_reports WHERE project_id = ?", params: 1},
	{key: "requirements", sql: "SELECT COUNT(*) FROM requirement_items WHERE project_id = ?", params: 1},
	{key: "requirementContents", sql: "SELECT COUNT(*) FROM requirement_contents WHERE project_id = ?", params: 1},
	{key: "requirementReviewBatches", sql: "SELECT COUNT(*) FROM requirement_review_batches WHERE project_id = ?", params: 1},
	{key: "deliverables", sql: "SELECT COUNT(*) FROM deliverables WHERE project_id = ?", params: 1},
	{key: "approvals", sql: "SELECT COUNT(*) FROM approval_records WHERE project_id = ?", params: 1},
}

type projectDeletionTarget struct {
	id              int64
	projectCode     string
	name            string
	lifecycleStatus string
}

func parseProjectDeletionID(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_project_id", "无效的项目ID")
	}
	return id, nil
}

func repeatedProjectArg(projectID int64, count int) []any {
	args := make([]any, count)
	for index := range args {
		args[index] = projectID
	}
	return args
}

func (a *Adapter) loadProjectDeletionTarget(ctx context.Context, projectID int64) (projectDeletionTarget, error) {
	var target projectDeletionTarget
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_code, name, lifecycle_status
		FROM aims_projects
		WHERE id = ?
		LIMIT 1
	`, projectID).Scan(&target.id, &target.projectCode, &target.name, &target.lifecycleStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return target, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return target, err
	}
	return target, nil
}

func (a *Adapter) projectDeletionImpact(ctx context.Context, projectID int64) (map[string]any, error) {
	impact := map[string]any{}
	var total int64
	for _, item := range projectDeletionImpactQueries {
		var count int64
		if err := a.DB().QueryRowContext(ctx, item.sql, repeatedProjectArg(projectID, item.params)...).Scan(&count); err != nil {
			return nil, fmt.Errorf("project deletion impact %s: %w", item.key, err)
		}
		impact[item.key] = count
		total += count
	}
	impact["total"] = total
	return impact, nil
}

func (a *Adapter) hardDeleteProject(ctx context.Context, projectID int64) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	deleted := map[string]any{}
	for _, step := range projectDeletionSteps {
		result, err := tx.ExecContext(ctx, step.sql, repeatedProjectArg(projectID, step.params)...)
		if err != nil {
			return nil, fmt.Errorf("project deletion step %s: %w", step.key, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		deleted[step.key] = affected
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deleted, nil
}

func (a *Adapter) deleteProject(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}

	target, err := a.loadProjectDeletionTarget(ctx, projectID)
	if err != nil {
		return nil, err
	}

	// 仅允许草稿状态删除；非草稿一律不允许（含归档状态）
	if target.lifecycleStatus != "draft" {
		return nil, httperror.New(http.StatusConflict, "project_not_draft", "仅草稿状态的项目可以删除，非草稿项目不允许删除或归档")
	}

	if query.Get("current_user_is_project_admin") != "1" {
		var role string
		err := a.DB().QueryRowContext(ctx, `
			SELECT role
			FROM aims_project_members
			WHERE project_id = ?
			  AND uid = ?
			  AND status = 'active'
			LIMIT 1
		`, projectID, currentUser).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && role != "manager") {
			return nil, httperror.New(http.StatusForbidden, "project_manager_required", "仅项目经理可以删除项目")
		}
		if err != nil {
			return nil, err
		}
	}

	deleted, err := a.hardDeleteProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"deleted": deleted}, nil
}

func (a *Adapter) adminDeleteProject(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if query.Get("current_user_is_project_admin") != "1" {
		return nil, httperror.New(http.StatusForbidden, "project_admin_required", "仅系统管理员可以执行该操作")
	}

	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}

	target, err := a.loadProjectDeletionTarget(ctx, projectID)
	if err != nil {
		return nil, err
	}

	confirmText := ""
	if raw, ok := body["confirmText"].(string); ok {
		confirmText = strings.TrimSpace(raw)
	}
	if confirmText == "" || (confirmText != target.projectCode && confirmText != target.name) {
		return nil, httperror.New(http.StatusBadRequest, "confirm_text_mismatch", "请输入项目编码或项目名称确认删除")
	}

	impact, err := a.projectDeletionImpact(ctx, projectID)
	if err != nil {
		return nil, err
	}

	deleted, err := a.hardDeleteProject(ctx, projectID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"projectId":   projectID,
		"projectCode": target.projectCode,
		"impact":      impact,
		"deleted":     deleted,
	}, nil
}
