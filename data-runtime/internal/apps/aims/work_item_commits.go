package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) linkWorkItemCommit(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}

	commitID, err := bodyInt64(body, "commitId", "commit_id")
	if err != nil || commitID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_commit_id", "commitId must be a positive integer")
	}

	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(
		ctx,
		"UPDATE gitlab_commits SET work_item_id = ? WHERE id = ? AND project_id = ?",
		workItemID,
		commitID,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("link work item commit: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
	}

	return map[string]any{
		"workItemId": workItemID,
		"commitId":   commitID,
	}, nil
}

func (a *Adapter) unlinkWorkItemCommit(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	commitID, err := parseID(rawCommitID, "commit_id")
	if err != nil {
		return nil, err
	}

	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(
		ctx,
		"UPDATE gitlab_commits SET work_item_id = NULL WHERE id = ? AND work_item_id = ? AND project_id = ?",
		commitID,
		workItemID,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("unlink work item commit: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "commit_link_not_found", "commit link not found")
	}

	return map[string]any{
		"workItemId": workItemID,
		"commitId":   commitID,
	}, nil
}

func (a *Adapter) workItemCommitDiffMetadata(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	commitID, err := parseID(rawCommitID, "commit_id")
	if err != nil {
		return nil, err
	}

	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	var commitSHA string
	var repoProjectCode string
	err = a.DB().QueryRowContext(ctx, `
		SELECT commit_sha, repo_project_code
		FROM gitlab_commits
		WHERE id = ? AND work_item_id = ? AND project_id = ?
	`, commitID, workItemID, projectID).Scan(&commitSHA, &repoProjectCode)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
	}
	if err != nil {
		return nil, fmt.Errorf("query work item commit diff metadata: %w", err)
	}

	return map[string]any{
		"id":              commitID,
		"workItemId":      workItemID,
		"repoProjectCode": repoProjectCode,
		"commitSha":       commitSHA,
	}, nil
}

func (a *Adapter) updateWorkItemCommitFilesChanged(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	commitID, err := parseID(rawCommitID, "commit_id")
	if err != nil {
		return nil, err
	}
	filesChanged, err := bodyInt64(body, "filesChanged", "files_changed")
	if err != nil || filesChanged < 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_files_changed", "filesChanged must be a non-negative integer")
	}

	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		UPDATE gitlab_commits
		SET files_changed = ?
		WHERE id = ? AND work_item_id = ? AND project_id = ?
	`, filesChanged, commitID, workItemID, projectID)
	if err != nil {
		return nil, fmt.Errorf("update work item commit files changed: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
	}

	return map[string]any{
		"workItemId":    workItemID,
		"commitId":      commitID,
		"filesChanged":  filesChanged,
		"files_changed": filesChanged,
	}, nil
}

func workItemCommitSubPath(path string, suffix string) (string, string, bool) {
	const prefix = "/v1/aims/work-items/"
	const separator = "/commits/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", "", false
	}
	rest := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	parts := strings.Split(rest, separator)
	if len(parts) != 2 {
		return "", "", false
	}
	workItemID := strings.TrimSpace(parts[0])
	commitID := strings.TrimSpace(parts[1])
	if workItemID == "" || commitID == "" || strings.Contains(workItemID, "/") || strings.Contains(commitID, "/") {
		return "", "", false
	}
	return workItemID, commitID, true
}

func (a *Adapter) commitTargetWorkItemProject(ctx context.Context, rawWorkItemID string) (int64, int64, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return 0, 0, err
	}

	var projectID int64
	err = a.DB().QueryRowContext(ctx, "SELECT project_id FROM work_items WHERE id = ?", workItemID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return 0, 0, httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return 0, 0, err
	}
	return workItemID, projectID, nil
}
