package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const codocsTrustedDepartmentShareManagerQueryKey = "codocs_trusted_department_share_manager_dept_code"

// departmentCabinetFoldersList is intentionally the sole cabinet_folders read
// contract. The Codocs BFF verifies documents:view and department membership,
// then the Foundation-signed request binds the exact target department marker.
func (a *Adapter) departmentCabinetFoldersList(ctx context.Context, query url.Values) (map[string]any, error) {
	_, deptCode, err := requireTrustedCabinetReadContext(query, true)
	if err != nil {
		return nil, err
	}

	where := []string{"dept_code = ?"}
	args := []any{deptCode}
	if _, present := query["parent_id"]; present {
		parentID := strings.TrimSpace(query.Get("parent_id"))
		if parentID == "" || strings.EqualFold(parentID, "null") {
			where = append(where, "parent_id IS NULL")
		} else {
			where = append(where, "parent_id = ?")
			args = append(args, parentID)
		}
	}
	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cabinet_folders WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, name, parent_id, owner_uid, dept_code, sort_order, created_at, updated_at
		FROM cabinet_folders
		WHERE `+whereSQL+`
		ORDER BY sort_order ASC, id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": 1, "pageSize": len(items)}, nil
}

func requireTrustedDepartmentShareActor(query url.Values) (string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	return actorUID, nil
}

func requireTrustedDepartmentShareManagerScope(query url.Values) (string, string, error) {
	actorUID, err := requireTrustedDepartmentShareActor(query)
	if err != nil {
		return "", "", err
	}
	deptCode := strings.TrimSpace(query.Get(codocsTrustedDepartmentShareManagerQueryKey))
	if deptCode == "" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_department_manager_required", "Trusted department manager scope is required")
	}
	return actorUID, deptCode, nil
}

func (a *Adapter) departmentSharesList(ctx context.Context, query url.Values) (map[string]any, error) {
	_, deptCode, err := requireTrustedDepartmentShareManagerScope(query)
	if err != nil {
		return nil, err
	}
	where := []string{"ds.dept_code = ?"}
	args := []any{deptCode}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "ds.status = ?")
		args = append(args, status)
	}
	whereSQL := strings.Join(where, " AND ")
	rows, err := a.db.QueryContext(ctx, `
		SELECT ds.*, d.uuid AS document_uuid, d.title AS document_title, d.owner_uid AS from_uid
		FROM department_shares ds
		LEFT JOIN documents d ON d.id = ds.document_id
		WHERE `+whereSQL+`
		ORDER BY ds.created_at DESC, ds.id DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)}, nil
}

// The manager boundary belongs to the existing Codocs BFF orchestration: it
// discovers the target department, checks requireDepartmentManagerAccess, then
// invokes the update below with a request-target-bound marker. Runtime itself
// must not invent a department-manager delegation semantic.
func (a *Adapter) departmentShareDetail(ctx context.Context, id string, query url.Values) (map[string]any, error) {
	if _, err := requireTrustedDepartmentShareActor(query); err != nil {
		return nil, err
	}
	return a.departmentShareRow(ctx, id, "", false)
}

func (a *Adapter) updateDepartmentShare(ctx context.Context, id string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedDepartmentShareManagerScope(query)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(stringValue(body["status"]))
	if status != "accepted" && status != "rejected" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_department_share_status", "Department share status must be accepted or rejected")
	}
	share, err := a.departmentShareRow(ctx, id, deptCode, true)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(stringValue(share["status"])) != "pending" {
		return nil, httperror.New(http.StatusConflict, "department_share_already_handled", "Department share has already been handled")
	}
	result, err := a.db.ExecContext(ctx, `
		UPDATE department_shares
		SET status = ?, handled_by = ?, handled_at = NOW()
		WHERE id = ? AND dept_code = ? AND status = 'pending'`, status, actorUID, strings.TrimSpace(id), deptCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusConflict, "department_share_already_handled", "Department share has already been handled")
	}
	return map[string]any{"updated": true, "status": status, "handled_by": actorUID}, nil
}

func (a *Adapter) departmentShareRow(ctx context.Context, id string, deptCode string, requireDept bool) (map[string]any, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_department_share", "Department share id is required")
	}
	where := "ds.id = ?"
	args := []any{id}
	if requireDept {
		where += " AND ds.dept_code = ?"
		args = append(args, deptCode)
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT ds.*, d.uuid AS document_uuid, d.title AS document_title, d.owner_uid AS from_uid
		FROM department_shares ds
		LEFT JOIN documents d ON d.id = ds.document_id
		WHERE `+where+`
		LIMIT 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Department share not found")
	}
	return items[0], nil
}
