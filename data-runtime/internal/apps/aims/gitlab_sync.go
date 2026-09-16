package aims

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// GitLab 提交同步的数据侧实现。
// GitLab API 拉取仍在 Aims Nuxt 侧（凭证经 Foundation/Console 集成解析），
// runtime 负责：同步上下文读取、commit 落库与工作项编号匹配、仓库游标更新。

// gitlabSyncContext GET /v1/aims/projects/{id}/gitlab-sync-context
// 返回项目与关联仓库（含增量同步游标）。
func (a *Adapter) gitlabSyncContext(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}

	var projectCode, name string
	err = a.DB().QueryRowContext(ctx,
		"SELECT project_code, name FROM aims_projects WHERE id = ?", projectID).
		Scan(&projectCode, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, repo_project_code, last_commit_sha,
		       DATE_FORMAT(last_synced_at, '%Y-%m-%dT%H:%i:%sZ')
		FROM aims_project_repos
		WHERE project_id = ?`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	repos := []map[string]any{}
	for rows.Next() {
		var id int64
		var repoProjectCode string
		var lastCommitSha, lastSyncedAt sql.NullString
		if err := rows.Scan(&id, &repoProjectCode, &lastCommitSha, &lastSyncedAt); err != nil {
			return nil, err
		}
		repo := map[string]any{
			"id":              id,
			"repoProjectCode": repoProjectCode,
		}
		if lastCommitSha.Valid {
			repo["lastCommitSha"] = lastCommitSha.String
		}
		if lastSyncedAt.Valid {
			repo["lastSyncedAt"] = lastSyncedAt.String
		}
		repos = append(repos, repo)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"project": map[string]any{"id": projectID, "projectCode": projectCode, "name": name},
		"repos":   repos,
	}, nil
}

// ingestGitlabCommits POST /v1/aims/projects/{id}/gitlab-commits/ingest
// Body: { repos: [{ repoId, repoProjectCode, commits: [{ sha, message, authorName,
//
//	authorEmail, committedDate, additions?, deletions? }] }] }
//
// 在 runtime 侧完成工作项编号匹配、UPSERT 与仓库游标更新。
func (a *Adapter) ingestGitlabCommits(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/gitlab-commits/ingest", query, body, rawProjectID); err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}

	var projectCode string
	err = a.DB().QueryRowContext(ctx,
		"SELECT project_code FROM aims_projects WHERE id = ?", projectID).Scan(&projectCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return nil, err
	}

	// 项目工作项编号映射，用于 commit message 自动匹配
	keyRows, err := a.DB().QueryContext(ctx,
		"SELECT id, item_key FROM work_items WHERE project_id = ?", projectID)
	if err != nil {
		return nil, err
	}
	keyToID := map[string]int64{}
	for keyRows.Next() {
		var id int64
		var itemKey string
		if err := keyRows.Scan(&id, &itemKey); err != nil {
			keyRows.Close()
			return nil, err
		}
		keyToID[strings.ToUpper(itemKey)] = id
	}
	keyRows.Close()
	if err := keyRows.Err(); err != nil {
		return nil, err
	}

	prefix := strings.ToUpper(projectCode)
	itemKeyPattern, err := regexp.Compile(`(?i)#?` + regexp.QuoteMeta(prefix) + `-(\d+)`)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var totalSynced int64
	rawRepos, _ := body["repos"].([]any)
	for _, rawRepo := range rawRepos {
		repoMap, _ := rawRepo.(map[string]any)
		if repoMap == nil {
			continue
		}
		repoID, err := bodyInt64(repoMap, "repoId", "repo_id")
		if err != nil || repoID <= 0 {
			continue
		}
		repoProjectCode := ""
		if value := normalizeDistributionText(repoMap["repoProjectCode"]); value != nil {
			repoProjectCode = *value
		}

		rawCommits, _ := repoMap["commits"].([]any)
		var latestSha string
		for _, rawCommit := range rawCommits {
			commitMap, _ := rawCommit.(map[string]any)
			if commitMap == nil {
				continue
			}
			sha := ""
			if value := normalizeDistributionText(commitMap["sha"]); value != nil {
				sha = *value
			}
			if sha == "" {
				continue
			}
			if latestSha == "" {
				latestSha = sha
			}

			message := ""
			if value, ok := commitMap["message"].(string); ok {
				message = value
			}
			if runes := []rune(message); len(runes) > 2000 {
				message = string(runes[:2000])
			}

			var matchedWorkItemID any
			var matchedItemKey any
			for _, match := range itemKeyPattern.FindAllString(message, -1) {
				fullKey := strings.ToUpper(strings.TrimPrefix(match, "#"))
				if id, ok := keyToID[fullKey]; ok {
					matchedWorkItemID = id
					matchedItemKey = fullKey
					break
				}
			}

			authorName := strings.TrimSpace(stringFromAny(commitMap["authorName"]))
			authorEmail := strings.TrimSpace(stringFromAny(commitMap["authorEmail"]))
			committedAt := parseGitlabCommitTime(stringFromAny(commitMap["committedDate"]))

			var additions, deletions any
			if value := bodyOptionalInt64(commitMap["additions"]); value != nil {
				additions = *value
			}
			if value := bodyOptionalInt64(commitMap["deletions"]); value != nil {
				deletions = *value
			}

			if _, err := tx.ExecContext(ctx, `
				INSERT INTO gitlab_commits
				  (project_id, work_item_id, item_key, repo_project_code,
				   commit_sha, message, author_name, author_email, committed_at,
				   additions, deletions, files_changed)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
				ON DUPLICATE KEY UPDATE
				  work_item_id = COALESCE(work_item_id, VALUES(work_item_id)),
				  item_key = COALESCE(item_key, VALUES(item_key)),
				  additions = COALESCE(VALUES(additions), additions),
				  deletions = COALESCE(VALUES(deletions), deletions),
				  files_changed = COALESCE(VALUES(files_changed), files_changed)`,
				projectID, matchedWorkItemID, matchedItemKey, repoProjectCode,
				sha, message, authorName, authorEmail, committedAt,
				additions, deletions); err != nil {
				// 与旧实现一致：单条失败不阻断整体同步
				log.Printf("[aims gitlab-sync] skip commit %s: %v", sha, err)
				continue
			}
			totalSynced++
		}

		if len(rawCommits) > 0 {
			if _, err := tx.ExecContext(ctx, `
				UPDATE aims_project_repos
				SET last_commit_sha = COALESCE(?, last_commit_sha), last_synced_at = NOW()
				WHERE id = ? AND project_id = ?`,
				nullIfEmptyString(latestSha), repoID, projectID); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"synced": totalSynced}, nil
}

func stringFromAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

// parseGitlabCommitTime 把 ISO 时间转为 MySQL DATETIME；解析失败时回退当前时间。
func parseGitlabCommitTime(value string) string {
	trimmed := strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05.000Z07:00", "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed.UTC().Format("2006-01-02 15:04:05")
		}
	}
	return time.Now().UTC().Format("2006-01-02 15:04:05")
}
