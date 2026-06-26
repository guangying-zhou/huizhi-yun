package aims

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) updateProjectWithLeaderSync(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
	projectID string,
) (any, error) {
	if err := a.requireProjectUpdateAccess(ctx, path, query, body, projectID); err != nil {
		return nil, err
	}

	result, _, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
	if err != nil {
		return result, err
	}

	leaderUID := cleanBodyText(body, "leaderUid", "leader_uid")
	if leaderUID == "" {
		return result, nil
	}

	if err := a.ensureProjectLeaderMember(ctx, projectID, leaderUID); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) requireProjectUpdateAccess(ctx context.Context, path string, query url.Values, body map[string]any, projectID string) error {
	if _, err := parseID(projectID, "project_id"); err != nil {
		return err
	}
	if isAdminProjectObjectPath(path) {
		return requireProjectAdminAccess(query, body, projectID)
	}
	if currentUserFrom(query, body) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if hasProjectAdminFlag(query) {
		return nil
	}

	_, _, err := a.requireProjectManager(ctx, projectID, query, body)
	return err
}

func requireProjectAdminAccess(query url.Values, body map[string]any, projectID string) error {
	if _, err := parseID(projectID, "project_id"); err != nil {
		return err
	}
	if currentUserFrom(query, body) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !hasProjectAdminFlag(query) {
		return httperror.New(http.StatusForbidden, "project_admin_required", "仅系统管理员可以执行该操作")
	}
	return nil
}

func hasProjectAdminFlag(query url.Values) bool {
	return strings.TrimSpace(firstQueryText(query, "current_user_is_project_admin", "currentUserIsProjectAdmin")) == "1"
}

func isAdminProjectObjectPath(path string) bool {
	_, ok := directPathParam(path, "/v1/aims/admin/projects/")
	return ok
}

func (a *Adapter) ensureProjectLeaderMember(ctx context.Context, projectID string, leaderUID string) error {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE aims_project_members
		SET role = 'member'
		WHERE project_id = ?
		  AND uid <> ?
		  AND role = 'manager'
	`, projectID, leaderUID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO aims_project_members (project_id, uid, role, status)
		VALUES (?, ?, 'manager', 'active')
		ON DUPLICATE KEY UPDATE
			role = 'manager',
			status = 'active'
	`, projectID, leaderUID); err != nil {
		return err
	}

	return tx.Commit()
}

func cleanBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(body[key]))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func directPathParam(path string, prefix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	value := strings.TrimPrefix(path, prefix)
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}
