package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleGitlabIssueSyncRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/gitlab-issue-sync-context"); ok {
		if method != http.MethodGet {
			return nil, "aims.projects.gitlab_issues.sync_context", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
		data, err := a.gitlabIssueSyncContext(ctx, projectID, query)
		return data, "aims.projects.gitlab_issues.sync_context", true, err
	}
	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/gitlab-issue-links/ingest"); ok {
		if method != http.MethodPost {
			return nil, "aims.projects.gitlab_issues.ingest", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
		data, err := a.ingestGitlabIssueLinks(ctx, projectID, query, body)
		return data, "aims.projects.gitlab_issues.ingest", true, err
	}
	return nil, "", false, nil
}

// gitlabIssueSyncContext returns trusted Aims work-item facts for the Nuxt BFF.
// The BFF owns the GitLab integration call; runtime owns project/repo access and links.
func (a *Adapter) gitlabIssueSyncContext(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/gitlab-issue-sync-context", query, map[string]any{}, rawProjectID); err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}
	repoProjectCode := strings.TrimSpace(firstQueryText(query, "repoProjectCode", "repo_project_code"))
	if repoProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_repo_required", "repoProjectCode is required")
	}
	if err := a.requireLinkedProjectRepo(ctx, projectID, repoProjectCode); err != nil {
		return nil, err
	}

	var projectCode, projectName string
	if err := a.DB().QueryRowContext(ctx, "SELECT project_code, name FROM aims_projects WHERE id = ?", projectID).Scan(&projectCode, &projectName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return nil, err
	}

	where := []string{"wi.project_id = ?"}
	args := []any{projectID}
	workItemIDs, err := gitlabIssueWorkItemIDs(query)
	if err != nil {
		return nil, err
	}
	if len(workItemIDs) > 0 {
		placeholders := make([]string, 0, len(workItemIDs))
		for _, id := range workItemIDs {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		where = append(where, "wi.id IN ("+strings.Join(placeholders, ",")+")")
	}
	queryArgs := []any{repoProjectCode}
	queryArgs = append(queryArgs, args...)
	queryArgs = append(queryArgs, 101)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT wi.id, wi.item_key, wi.type, wi.tier, wi.title, wi.description,
		       wi.status, wi.priority, wi.severity, wi.assignee_uid, wi.reporter_uid,
		       DATE_FORMAT(wi.due_date, '%Y-%m-%d'),
		       DATE_FORMAT(wi.updated_at, '%Y-%m-%dT%H:%i:%sZ'),
		       link.issue_iid, link.issue_url, link.issue_state
		FROM work_items wi
		LEFT JOIN gitlab_issue_links link
		  ON link.work_item_id = wi.id AND link.repo_project_code = ?
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY wi.updated_at ASC, wi.id ASC
		LIMIT ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var (
			id, issueIID                                     sql.NullInt64
			itemKey, itemType, tier, title, status, priority string
			description, severity, assignee, reporter        sql.NullString
			dueDate, updatedAt, issueURL, issueState         sql.NullString
		)
		if err := rows.Scan(&id, &itemKey, &itemType, &tier, &title, &description, &status, &priority, &severity, &assignee, &reporter, &dueDate, &updatedAt, &issueIID, &issueURL, &issueState); err != nil {
			return nil, err
		}
		if len(items) == 100 {
			return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_sync_batch_too_large", "at most 100 work items can be synchronized at once")
		}
		items = append(items, map[string]any{
			"id": id.Int64, "itemKey": itemKey, "type": itemType, "tier": tier,
			"title": title, "description": nullableString(description), "status": status,
			"priority": priority, "severity": nullableString(severity),
			"assigneeUid": nullableString(assignee), "reporterUid": nullableString(reporter),
			"dueDate": nullableString(dueDate), "updatedAt": nullableString(updatedAt),
			"issueIid": nullableInt64(issueIID), "issueUrl": nullableString(issueURL),
			"issueState": nullableString(issueState),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{
		"project":         map[string]any{"id": projectID, "projectCode": projectCode, "name": projectName},
		"repoProjectCode": repoProjectCode, "requestedBy": uid, "items": items,
	}, nil
}

func (a *Adapter) ingestGitlabIssueLinks(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/gitlab-issue-links/ingest", query, body, rawProjectID); err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}
	repoProjectCode := strings.TrimSpace(firstBodyText(body, "repoProjectCode", "repo_project_code"))
	if repoProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_repo_required", "repoProjectCode is required")
	}
	if err := a.requireLinkedProjectRepo(ctx, projectID, repoProjectCode); err != nil {
		return nil, err
	}
	rawItems, ok := body["items"].([]any)
	if !ok || len(rawItems) == 0 || len(rawItems) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_links_invalid", "items must contain between 1 and 100 GitLab issue links")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		workItemID, itemErr := bodyInt64(item, "workItemId", "work_item_id")
		issueIID, iidErr := bodyInt64(item, "issueIid", "issue_iid")
		issueURL := strings.TrimSpace(firstBodyText(item, "issueUrl", "issue_url"))
		issueState := strings.TrimSpace(firstBodyText(item, "issueState", "issue_state"))
		if itemErr != nil || iidErr != nil || workItemID <= 0 || issueIID <= 0 || issueURL == "" || len(issueURL) > 1000 || (issueState != "opened" && issueState != "closed") {
			return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_link_invalid", "GitLab issue link is invalid")
		}
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_items WHERE id = ? AND project_id = ?", workItemID, projectID).Scan(&count); err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_work_item_invalid", "work item does not belong to the project")
		}
		var boundWorkItemID int64
		bindingErr := tx.QueryRowContext(ctx, "SELECT work_item_id FROM gitlab_issue_links WHERE repo_project_code = ? AND issue_iid = ?", repoProjectCode, issueIID).Scan(&boundWorkItemID)
		if bindingErr == nil && boundWorkItemID != workItemID {
			return nil, httperror.New(http.StatusConflict, "gitlab_issue_binding_conflict", "GitLab issue is already bound to another work item")
		}
		if bindingErr != nil && !errors.Is(bindingErr, sql.ErrNoRows) {
			return nil, bindingErr
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO gitlab_issue_links
			  (project_id, work_item_id, repo_project_code, issue_iid, issue_url, issue_state, last_synced_at)
			VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
			  issue_iid = VALUES(issue_iid), issue_url = VALUES(issue_url),
			  issue_state = VALUES(issue_state), last_synced_at = CURRENT_TIMESTAMP`,
			projectID, workItemID, repoProjectCode, issueIID, issueURL, issueState); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"synced": len(rawItems)}, nil
}

func (a *Adapter) requireLinkedProjectRepo(ctx context.Context, projectID int64, repoProjectCode string) error {
	var count int
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_repos WHERE project_id = ? AND repo_project_code = ?", projectID, repoProjectCode).Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return httperror.New(http.StatusForbidden, "gitlab_issue_repo_not_linked", "repository is not linked to this Aims project")
	}
	return nil
}

func gitlabIssueWorkItemIDs(query url.Values) ([]int64, error) {
	raw := strings.TrimSpace(firstQueryText(query, "workItemIds", "work_item_ids"))
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_sync_batch_too_large", "at most 100 work item IDs are allowed")
	}
	result := make([]int64, 0, len(parts))
	seen := map[int64]struct{}{}
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "gitlab_issue_work_item_ids_invalid", "workItemIds must contain positive integers")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}
