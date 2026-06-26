package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) addProjectMember(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
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

	targetUID := firstBodyText(body, "uid", "user_uid", "userUid")
	if targetUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_uid", "用户UID为必填项")
	}
	role := normalizeAimsProjectRole(firstBodyText(body, "role"))

	var duplicate int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM aims_project_members
		WHERE project_id = ?
		  AND uid = ?
	`, projectID, targetUID).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate > 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_member_exists", "该用户已是项目成员")
	}

	if _, err := a.DB().ExecContext(ctx, `
		INSERT INTO aims_project_members (project_id, uid, role, status)
		VALUES (?, ?, ?, 'active')
	`, projectID, targetUID, role); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": nil}, nil
}

func (a *Adapter) listProjectMembers(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (any, error) {
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}

	data, _, err := a.Adapter.HandleRuntime(ctx, http.MethodGet, "/v1/aims/projects/"+rawProjectID+"/members", query, body)
	return data, err
}

func (a *Adapter) deleteProjectMember(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
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

	targetUID := strings.TrimSpace(query.Get("uid"))
	if targetUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_uid", "请指定要操作的用户UID")
	}

	currentUID := currentUserFrom(query, body)
	if targetUID == currentUID {
		return nil, httperror.New(http.StatusBadRequest, "cannot_remove_self", "不能移除自己，请先转让项目经理角色")
	}

	var memberID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM aims_project_members
		WHERE project_id = ?
		  AND uid = ?
		LIMIT 1
	`, projectID, targetUID).Scan(&memberID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "project_member_not_found", "该用户不是项目成员")
	}
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(query.Get("action")) == "suspend" {
		if _, err := a.DB().ExecContext(ctx, `
			UPDATE aims_project_members
			SET status = 'suspended'
			WHERE id = ?
		`, memberID); err != nil {
			return nil, err
		}
		return map[string]any{"code": 0, "data": map[string]any{"action": "suspended"}}, nil
	}

	var workItemCount int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM work_items
		WHERE project_id = ?
		  AND assignee_uid = ?
	`, projectID, targetUID).Scan(&workItemCount); err != nil {
		return nil, err
	}
	if workItemCount > 0 {
		return map[string]any{
			"code":    1,
			"message": "该成员名下有工作项，不可直接移除，只能暂停",
			"data": map[string]any{
				"workItemCount": workItemCount,
			},
		}, nil
	}

	if _, err := a.DB().ExecContext(ctx, `
		DELETE FROM aims_project_members
		WHERE id = ?
	`, memberID); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": map[string]any{"action": "removed"}}, nil
}

func normalizeAimsProjectRole(role string) string {
	switch strings.TrimSpace(role) {
	case "manager", "viewer":
		return strings.TrimSpace(role)
	default:
		return "member"
	}
}

func (a *Adapter) requireProjectReadAccess(ctx context.Context, rawProjectID string, query url.Values) error {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return err
	}
	if err := a.requireProjectExists(ctx, rawProjectID); err != nil {
		return err
	}

	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if currentUserIsProjectAdmin(query) {
		return nil
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	args := append([]any{projectID}, visibilityArgs...)
	var id int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT p.id
		FROM aims_projects p
		WHERE p.id = ?
		  AND `+visibilityWhere+`
		LIMIT 1
	`, args...).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusForbidden, "project_access_denied", "project access required")
	}
	return err
}
