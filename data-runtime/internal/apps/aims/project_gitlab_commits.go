package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type projectGitlabCommit struct {
	ID              int64   `json:"id"`
	WorkItemID      *int64  `json:"workItemId"`
	ItemKey         *string `json:"itemKey"`
	RepoProjectCode string  `json:"repoProjectCode"`
	CommitSHA       string  `json:"commitSha"`
	Message         string  `json:"message"`
	AuthorName      *string `json:"authorName"`
	AuthorEmail     *string `json:"authorEmail"`
	CommittedAt     string  `json:"committedAt"`
}

func (a *Adapter) handleProjectGitlabCommitsRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
) (any, string, bool, error) {
	if method != http.MethodGet {
		return nil, "", false, nil
	}
	projectID, ok := pathParam(path, "/v1/aims/projects/", "/gitlab-commits")
	if !ok {
		return nil, "", false, nil
	}

	data, err := a.listProjectGitlabCommits(ctx, projectID, query)
	return data, "aims.projects.gitlab_commits.list", true, err
}

func (a *Adapter) listProjectGitlabCommits(ctx context.Context, rawProjectID string, query url.Values) ([]projectGitlabCommit, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}

	where := []string{"project_id = ?"}
	args := []any{projectID}

	unlinked := strings.EqualFold(strings.TrimSpace(query.Get("unlinked")), "true")
	excludeWorkItemID := optionalPositiveQueryID(query, "exclude_work_item_id", "excludeWorkItemId")
	if unlinked && excludeWorkItemID > 0 {
		where = append(where, "(work_item_id IS NULL OR work_item_id != ?)")
		args = append(args, excludeWorkItemID)
	} else if unlinked {
		where = append(where, "work_item_id IS NULL")
	}

	if uidFilter := firstQueryText(query, "uid"); uidFilter != "" {
		where = append(where, "author_name = ?")
		args = append(args, uidFilter)
	}

	if keyword := firstQueryText(query, "keyword", "search", "q"); keyword != "" {
		like := "%" + keyword + "%"
		where = append(where, "(message LIKE ? OR commit_sha LIKE ? OR author_name LIKE ?)")
		args = append(args, like, like, like)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id,
		       work_item_id,
		       item_key,
		       repo_project_code,
		       commit_sha,
		       message,
		       author_name,
		       author_email,
		       DATE_FORMAT(committed_at, '%Y-%m-%d %H:%i:%s') AS committed_at
		FROM gitlab_commits
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY committed_at DESC, id DESC
		LIMIT 100
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]projectGitlabCommit, 0)
	for rows.Next() {
		var item projectGitlabCommit
		var workItemID sql.NullInt64
		var itemKey sql.NullString
		var authorName sql.NullString
		var authorEmail sql.NullString
		var committedAt sql.NullString
		if err := rows.Scan(
			&item.ID,
			&workItemID,
			&itemKey,
			&item.RepoProjectCode,
			&item.CommitSHA,
			&item.Message,
			&authorName,
			&authorEmail,
			&committedAt,
		); err != nil {
			return nil, err
		}
		item.WorkItemID = nullableInt64(workItemID)
		item.ItemKey = nullableString(itemKey)
		item.AuthorName = nullableString(authorName)
		item.AuthorEmail = nullableString(authorEmail)
		item.CommittedAt = nullStringOr(committedAt, "")
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func optionalPositiveQueryID(query url.Values, keys ...string) int64 {
	text := firstQueryText(query, keys...)
	if text == "" {
		return 0
	}
	id, err := strconv.ParseInt(text, 10, 64)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}
