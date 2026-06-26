package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func projectAuthorizationObjectPath(path string) (string, bool) {
	return pathParam(path, "/v1/aims/projects/", "/authorization-object")
}

func (a *Adapter) projectAuthorizationObject(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}

	var projectCode string
	var deptCode, leaderUID sql.NullString
	var createdBy string
	err = a.DB().QueryRowContext(ctx, `
		SELECT project_code, dept_code, leader_uid, created_by
		FROM aims_projects
		WHERE id = ?
		LIMIT 1
	`, projectID).Scan(&projectCode, &deptCode, &leaderUID, &createdBy)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT uid, role, status
		FROM aims_project_members
		WHERE project_id = ?
		ORDER BY id ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]map[string]any, 0)
	for rows.Next() {
		var uid, role, status string
		if err := rows.Scan(&uid, &role, &status); err != nil {
			return nil, err
		}
		members = append(members, map[string]any{
			"uid":    uid,
			"role":   role,
			"status": status,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	project := map[string]any{
		"id":           projectID,
		"projectCode":  projectCode,
		"project_code": projectCode,
		"deptCode":     nullableAuthorizationText(deptCode),
		"dept_code":    nullableAuthorizationText(deptCode),
		"leaderUid":    nullableAuthorizationText(leaderUID),
		"leader_uid":   nullableAuthorizationText(leaderUID),
		"createdBy":    strings.TrimSpace(createdBy),
		"created_by":   strings.TrimSpace(createdBy),
		"members":      members,
	}
	return project, nil
}

func nullableAuthorizationText(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	normalized := strings.TrimSpace(value.String)
	if normalized == "" {
		return nil
	}
	return normalized
}
