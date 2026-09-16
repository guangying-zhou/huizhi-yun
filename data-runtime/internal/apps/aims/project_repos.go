package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectRepo struct {
	ID              int64   `json:"id"`
	ProjectID       int64   `json:"projectId"`
	RepoProjectCode string  `json:"repoProjectCode"`
	LastCommitSha   *string `json:"lastCommitSha"`
	LastSyncedAt    *string `json:"lastSyncedAt"`
	CreatedAt       string  `json:"createdAt"`
}

func (a *Adapter) handleProjectReposRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	projectID, ok := pathParam(path, "/v1/aims/projects/", "/repos")
	if !ok {
		return nil, "", false, nil
	}

	switch method {
	case http.MethodGet:
		data, err := a.listProjectRepos(ctx, projectID, query)
		return data, "aims.projects.repos.list", true, err
	case http.MethodPost:
		data, err := a.linkProjectRepo(ctx, projectID, query, body)
		return data, "aims.projects.repos.link", true, err
	case http.MethodDelete:
		data, err := a.unlinkProjectRepo(ctx, projectID, query, body)
		return data, "aims.projects.repos.unlink", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) listProjectRepos(ctx context.Context, rawProjectID string, query url.Values) ([]projectRepo, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id,
		       project_id,
		       repo_project_code,
		       last_commit_sha,
		       DATE_FORMAT(last_synced_at, '%Y-%m-%d %H:%i:%s') AS last_synced_at,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM aims_project_repos
		WHERE project_id = ?
		ORDER BY created_at ASC, id ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]projectRepo, 0)
	for rows.Next() {
		var item projectRepo
		var lastCommitSha sql.NullString
		var lastSyncedAt sql.NullString
		var createdAt sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.RepoProjectCode,
			&lastCommitSha,
			&lastSyncedAt,
			&createdAt,
		); err != nil {
			return nil, err
		}
		item.LastCommitSha = nullableString(lastCommitSha)
		item.LastSyncedAt = nullableString(lastSyncedAt)
		item.CreatedAt = nullStringOr(createdAt, "")
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) linkProjectRepo(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectExists(ctx, rawProjectID); err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+rawProjectID, query, body, rawProjectID); err != nil {
		return nil, err
	}

	repoProjectCode := firstBodyText(body, "repoProjectCode", "repo_project_code")
	if repoProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_repo_project_code", "仓库项目编码为必填项")
	}

	var duplicate int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM aims_project_repos
		WHERE project_id = ?
		  AND repo_project_code = ?
	`, projectID, repoProjectCode).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate > 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_repo_exists", "该仓库已关联到此项目")
	}

	if _, err := a.DB().ExecContext(ctx, `
		INSERT INTO aims_project_repos (project_id, repo_project_code)
		VALUES (?, ?)
	`, projectID, repoProjectCode); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) unlinkProjectRepo(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectExists(ctx, rawProjectID); err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+rawProjectID, query, body, rawProjectID); err != nil {
		return nil, err
	}

	repoProjectCode := firstQueryText(query, "repoProjectCode", "repo_project_code")
	if repoProjectCode == "" {
		repoProjectCode = firstBodyText(body, "repoProjectCode", "repo_project_code")
	}
	if repoProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_repo_project_code", "请指定要移除的仓库项目编码")
	}

	var repoID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM aims_project_repos
		WHERE project_id = ?
		  AND repo_project_code = ?
		LIMIT 1
	`, projectID, repoProjectCode).Scan(&repoID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "project_repo_not_found", "该仓库未关联到此项目")
	}
	if err != nil {
		return nil, err
	}

	if _, err := a.DB().ExecContext(ctx, `
		DELETE FROM aims_project_repos
		WHERE id = ?
	`, repoID); err != nil {
		return nil, err
	}
	return nil, nil
}
