package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type favoriteProject struct {
	ProjectID       int64  `json:"projectId"`
	ProjectCode     string `json:"projectCode"`
	Name            string `json:"name"`
	LifecycleStatus string `json:"lifecycleStatus"`
	CreatedAt       string `json:"createdAt"`
}

func (a *Adapter) handleFavoritesRuntime(ctx context.Context, method string, query url.Values, body map[string]any) (any, string, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	switch method {
	case http.MethodGet:
		data, err := a.listFavorites(ctx, uid)
		return data, "aims.favorites.list", err
	case http.MethodPost:
		projectID, err := favoriteProjectID(query, body)
		if err != nil {
			return nil, "", err
		}
		return nil, "aims.favorites.create", a.addFavorite(ctx, uid, projectID)
	case http.MethodDelete:
		projectID, err := favoriteProjectID(query, body)
		if err != nil {
			return nil, "", err
		}
		return nil, "aims.favorites.delete", a.deleteFavorite(ctx, uid, projectID)
	default:
		return nil, "", httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "favorites runtime method is not supported")
	}
}

func (a *Adapter) listFavorites(ctx context.Context, uid string) ([]favoriteProject, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT f.project_id, p.project_code, p.name, p.lifecycle_status, f.created_at
		FROM user_favorite_projects f
		INNER JOIN aims_projects p ON p.id = f.project_id
		WHERE f.uid = ?
		ORDER BY f.created_at DESC
	`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]favoriteProject, 0)
	for rows.Next() {
		var item favoriteProject
		var projectCode, name, lifecycleStatus, createdAt sql.NullString
		if err := rows.Scan(&item.ProjectID, &projectCode, &name, &lifecycleStatus, &createdAt); err != nil {
			return nil, err
		}
		item.ProjectCode = nullStringOr(projectCode, "")
		item.Name = nullStringOr(name, "")
		item.LifecycleStatus = nullStringOr(lifecycleStatus, "")
		item.CreatedAt = nullStringOr(createdAt, "")
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) addFavorite(ctx context.Context, uid string, projectID int64) error {
	var existing int64
	if err := a.DB().QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id = ?", projectID).Scan(&existing); err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return err
	}

	_, err := a.DB().ExecContext(ctx, "INSERT IGNORE INTO user_favorite_projects (uid, project_id) VALUES (?, ?)", uid, projectID)
	return err
}

func (a *Adapter) deleteFavorite(ctx context.Context, uid string, projectID int64) error {
	_, err := a.DB().ExecContext(ctx, "DELETE FROM user_favorite_projects WHERE uid = ? AND project_id = ?", uid, projectID)
	return err
}

func favoriteProjectID(query url.Values, body map[string]any) (int64, error) {
	rawProjectID := firstQueryText(query, "projectId", "project_id")
	if rawProjectID == "" {
		rawProjectID = firstBodyText(body, "projectId", "project_id")
	}
	return parseID(rawProjectID, "project_id")
}
