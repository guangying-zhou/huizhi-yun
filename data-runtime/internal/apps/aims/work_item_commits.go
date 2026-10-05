package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) linkWorkItemCommit(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	return enterpriseScopedWorkItemWrite(a, ctx, rawWorkItemID, query, "commit-link", func(ctx context.Context) (map[string]any, error) {
		return a.linkWorkItemCommitBody(ctx, rawWorkItemID, query, body)
	}, legacyWorkItemReceiptConfig[map[string]any]{Action: "commit-link", Capability: "aims:work-item-commits:edit", BizType: "work-item-commit", Command: map[string]any{"workItemId": rawWorkItemID, "payload": body}, BizCode: func(value map[string]any) string { return fmt.Sprint(value["commitId"]) }, Replay: func(_ context.Context, code string) (map[string]any, error) {
		id, err := strconv.ParseInt(code, 10, 64)
		if err != nil || id <= 0 {
			return nil, httperror.New(503, "work_item_receipt_corrupt", "Work item receipt is invalid")
		}
		workItemID, err := strconv.ParseInt(rawWorkItemID, 10, 64)
		if err != nil {
			return nil, err
		}
		return map[string]any{"workItemId": workItemID, "commitId": id}, nil
	}, Decorate: decorateLegacyWorkItemMap, BeforeReplay: func(ctx context.Context) error { return a.requireCurrentCommitLinkFacts(ctx, rawWorkItemID, body) }})
}

func (a *Adapter) requireCurrentCommitLinkFacts(ctx context.Context, rawWorkItemID string, body map[string]any) error {
	_, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return err
	}
	commitID, err := bodyInt64(body, "commitId", "commit_id")
	if err != nil || commitID <= 0 {
		return httperror.New(400, "invalid_commit_id", "commitId must be a positive integer")
	}
	var repoCode string
	if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, "SELECT repo_project_code FROM gitlab_commits WHERE id=? AND project_id=? FOR UPDATE", commitID, projectID).Scan(&repoCode); err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(404, "commit_not_found", "Commit is not in this project")
		}
		return err
	}
	var linked int
	if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_repos WHERE project_id=? AND repo_project_code=?", projectID, repoCode).Scan(&linked); err != nil {
		return err
	}
	if linked == 0 {
		return httperror.New(404, "commit_repo_not_linked", "Repository is not linked to this project")
	}
	return nil
}

func (a *Adapter) linkWorkItemCommitBody(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
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
	if _, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); enterprise {
		var repoCode string
		if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx,
			"SELECT repo_project_code FROM gitlab_commits WHERE id=? AND project_id=? FOR UPDATE", commitID, projectID).Scan(&repoCode); err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(404, "commit_not_found", "Commit is not in this project")
			}
			return nil, err
		}
		var linked int
		if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx,
			"SELECT COUNT(*) FROM aims_project_repos WHERE project_id=? AND repo_project_code=?", projectID, repoCode).Scan(&linked); err != nil {
			return nil, err
		}
		if linked == 0 {
			return nil, httperror.New(404, "commit_repo_not_linked", "Repository is not linked to this project")
		}
	}

	// MySQL reports changed rows, so linking an already-linked commit may
	// legitimately affect zero rows. Check and lock its project ownership first.
	var existingCommitID int64
	if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx,
		"SELECT id FROM gitlab_commits WHERE id=? AND project_id=? FOR UPDATE", commitID, projectID).Scan(&existingCommitID); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
		}
		return nil, err
	}
	_, err = a.enterpriseScopedWriteDB(ctx).ExecContext(
		ctx,
		"UPDATE gitlab_commits SET work_item_id = ? WHERE id = ? AND project_id = ?",
		workItemID,
		commitID,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("link work item commit: %w", err)
	}
	return map[string]any{
		"workItemId": workItemID,
		"commitId":   commitID,
	}, nil
}

func (a *Adapter) unlinkWorkItemCommit(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values) (map[string]any, error) {
	return enterpriseScopedWorkItemWrite(a, ctx, rawWorkItemID, query, "commit-unlink", func(ctx context.Context) (map[string]any, error) {
		return a.unlinkWorkItemCommitBody(ctx, rawWorkItemID, rawCommitID, query)
	}, legacyWorkItemReceiptConfig[map[string]any]{Action: "commit-unlink", Capability: "aims:work-item-commits:edit", BizType: "work-item-commit", Command: map[string]any{"workItemId": rawWorkItemID, "commitId": rawCommitID}, BizCode: func(map[string]any) string { return rawCommitID }, Replay: func(context.Context, string) (map[string]any, error) {
		workItemID, err := strconv.ParseInt(rawWorkItemID, 10, 64)
		if err != nil {
			return nil, err
		}
		commitID, err := strconv.ParseInt(rawCommitID, 10, 64)
		if err != nil {
			return nil, err
		}
		return map[string]any{"workItemId": workItemID, "commitId": commitID}, nil
	}, Decorate: decorateLegacyWorkItemMap})
}

func (a *Adapter) unlinkWorkItemCommitBody(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values) (map[string]any, error) {
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

	result, err := a.enterpriseScopedWriteDB(ctx).ExecContext(
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
		var currentWorkItem sql.NullInt64
		if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx,
			"SELECT work_item_id FROM gitlab_commits WHERE id=? AND project_id=? FOR UPDATE", commitID, projectID).Scan(&currentWorkItem); err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
			}
			return nil, err
		}
		return nil, httperror.New(http.StatusConflict, "relation_changed", "Commit relation changed; reload it")
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
	return enterpriseScopedWorkItemWrite(a, ctx, rawWorkItemID, query, "commit-files-changed", func(ctx context.Context) (map[string]any, error) {
		return a.updateWorkItemCommitFilesChangedBody(ctx, rawWorkItemID, rawCommitID, query, body)
	})
}

func (a *Adapter) updateWorkItemCommitFilesChangedBody(ctx context.Context, rawWorkItemID string, rawCommitID string, query url.Values, body map[string]any) (map[string]any, error) {
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

	var existingCommitID int64
	if err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx,
		"SELECT id FROM gitlab_commits WHERE id=? AND work_item_id=? AND project_id=? FOR UPDATE", commitID, workItemID, projectID).Scan(&existingCommitID); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "commit_not_found", "commit not found in work item project")
		}
		return nil, err
	}
	_, err = a.enterpriseScopedWriteDB(ctx).ExecContext(ctx, `
		UPDATE gitlab_commits
		SET files_changed = ?
		WHERE id = ? AND work_item_id = ? AND project_id = ?
	`, filesChanged, commitID, workItemID, projectID)
	if err != nil {
		return nil, fmt.Errorf("update work item commit files changed: %w", err)
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
	err = a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, "SELECT project_id FROM work_items WHERE id = ?", workItemID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return 0, 0, httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return 0, 0, err
	}
	return workItemID, projectID, nil
}
