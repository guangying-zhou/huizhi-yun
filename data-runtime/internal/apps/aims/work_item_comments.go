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

type workItemComment struct {
	ID         int64  `json:"id"`
	WorkItemID int64  `json:"workItemId"`
	AuthorUID  string `json:"authorUid"`
	Content    string `json:"content"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

func (a *Adapter) workItemComments(ctx context.Context, rawWorkItemID string, query url.Values) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	page, pageSize := workItemCommentPage(query)
	offset := (page - 1) * pageSize

	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM work_item_comments WHERE work_item_id = ?", workItemID).Scan(&total); err != nil {
		return nil, fmt.Errorf("count work item comments: %w", err)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, author_uid, content, created_at, updated_at
		FROM work_item_comments
		WHERE work_item_id = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, workItemID, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("query work item comments: %w", err)
	}
	defer rows.Close()

	items, err := scanWorkItemComments(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	}, nil
}

func (a *Adapter) createWorkItemComment(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (workItemComment, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return workItemComment{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	workItemID, projectID, err := a.commitTargetWorkItemProject(ctx, rawWorkItemID)
	if err != nil {
		return workItemComment{}, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return workItemComment{}, err
	}

	content := firstBodyText(body, "content")
	if content == "" {
		return workItemComment{}, httperror.New(http.StatusBadRequest, "missing_content", "评论内容不能为空")
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO work_item_comments (work_item_id, author_uid, content)
		VALUES (?, ?, ?)
	`, workItemID, uid, content)
	if err != nil {
		return workItemComment{}, fmt.Errorf("create work item comment: %w", err)
	}
	commentID, err := result.LastInsertId()
	if err != nil {
		return workItemComment{}, err
	}
	return a.workItemComment(ctx, commentID, workItemID)
}

func (a *Adapter) workItemComment(ctx context.Context, commentID int64, workItemID int64) (workItemComment, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, author_uid, content, created_at, updated_at
		FROM work_item_comments
		WHERE id = ? AND work_item_id = ?
		LIMIT 1
	`, commentID, workItemID)
	if err != nil {
		return workItemComment{}, err
	}
	defer rows.Close()

	items, err := scanWorkItemComments(rows)
	if err != nil {
		return workItemComment{}, err
	}
	if len(items) == 0 {
		return workItemComment{}, httperror.New(http.StatusNotFound, "comment_not_found", "comment not found")
	}
	return items[0], nil
}

func scanWorkItemComments(rows *sql.Rows) ([]workItemComment, error) {
	items := make([]workItemComment, 0)
	for rows.Next() {
		var item workItemComment
		if err := rows.Scan(&item.ID, &item.WorkItemID, &item.AuthorUID, &item.Content, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan work item comment: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func workItemCommentPage(query url.Values) (int, int) {
	page := positiveQueryInt(query, "page", 1)
	pageSize := positiveQueryInt(query, "pageSize", 20)
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func positiveQueryInt(query url.Values, key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(query.Get(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
