package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const codocsTrustedDepartmentReadQueryKey = "codocs_trusted_department_read_dept_code"
const codocsTrustedDepartmentManageQueryKey = "codocs_trusted_department_manage_dept_code"

// Runtime authentication overwrites actor fields and sets
// hzy_runtime_actor_delegated only after validating the Foundation-signed actor
// delegation. The browser never supplies either trusted value directly.
func requireTrustedDocumentListActor(query url.Values) (string, string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	return actorUID, strings.TrimSpace(query.Get(codocsTrustedDepartmentReadQueryKey)), nil
}

// Keep the list/trash read predicate aligned with documentAccess' narrow facts:
// ownership, a direct document share, an active relation that grants read, and
// an exact department context already verified by the Codocs BFF. Project code
// is deliberately not an authorization input.
func documentReadVisibilityPredicate(actorUID string, trustedDepartmentReadDeptCode string) (string, []any) {
	predicate := `(
      d.owner_uid = ?
      OR EXISTS (
        SELECT 1
        FROM document_shares visible_share
        WHERE visible_share.document_id = d.id AND visible_share.shared_to_uid = ?
      )
      OR EXISTS (
        SELECT 1
        FROM document_relations visible_relation
        WHERE visible_relation.document_id = d.id
          AND visible_relation.related_uid = ?
          AND visible_relation.status = 1
          AND visible_relation.can_read = 1
          AND (visible_relation.source_type <> 'project_preview_access' OR visible_relation.updated_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR))
      )`
	args := []any{actorUID, actorUID, actorUID}
	if trustedDepartmentReadDeptCode != "" {
		predicate += `
      OR (d.doc_type = 'department' AND d.dept_code = ?)`
		args = append(args, trustedDepartmentReadDeptCode)
	}
	predicate += `
    )`
	return predicate, args
}

// Folder metadata is visible only through its owning namespace. Generic user
// reads do not infer project membership or publish visibility.
func folderReadVisibilityPredicate(actorUID string, trustedDepartmentReadDeptCode string) (string, []any) {
	predicate := "(folder_type = 'private' AND owner_uid = ?)"
	args := []any{actorUID}
	if trustedDepartmentReadDeptCode != "" {
		predicate += " OR (folder_type = 'department' AND dept_code = ?)"
		args = append(args, trustedDepartmentReadDeptCode)
	}
	return "(" + predicate + ")", args
}

func (a *Adapter) foldersList(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID, trustedDepartmentReadDeptCode, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	hasOpenColumn, err := a.columnExists(ctx, "folders", "is_open")
	if err != nil {
		return nil, err
	}
	openSelect := "0 AS is_open"
	if hasOpenColumn {
		openSelect = "is_open"
	}

	visibilityWhere, visibilityArgs := folderReadVisibilityPredicate(actorUID, trustedDepartmentReadDeptCode)
	where := []string{visibilityWhere}
	args := visibilityArgs
	addEquals := func(queryKey string, column string) {
		value := strings.TrimSpace(query.Get(queryKey))
		if value == "" {
			return
		}
		where = append(where, column+" = ?")
		args = append(args, value)
	}
	addEquals("folder_type", "folder_type")
	addEquals("owner_uid", "owner_uid")
	addEquals("dept_code", "dept_code")
	addEquals("project_code", "project_code")
	if _, ok := query["parent_id"]; ok {
		parentID := strings.TrimSpace(query.Get("parent_id"))
		if parentID == "" || parentID == "null" {
			where = append(where, "parent_id IS NULL")
		} else {
			where = append(where, "parent_id = ?")
			args = append(args, parentID)
		}
	}
	if _, ok := query["is_open"]; ok {
		openValue := boolValue(query.Get("is_open"))
		if hasOpenColumn {
			where = append(where, "is_open = ?")
			args = append(args, normalizeBoolInt(openValue))
		} else if openValue {
			where = append(where, "1 = 0")
		}
	}
	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM folders WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT id, name, folder_type, owner_uid, dept_code, project_code,
             parent_id, sort_order, `+openSelect+`, created_at, updated_at
      FROM folders
      WHERE `+whereSQL+`
      ORDER BY sort_order ASC, created_at DESC
      LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (a *Adapter) createFolder(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, _, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(stringValue(body["name"]))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Folder name is required")
	}
	if len([]rune(name)) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Folder name exceeds 100 characters")
	}

	folderType := strings.TrimSpace(stringValue(body["folder_type"]))
	var ownerUID, deptCode, projectCode string
	switch folderType {
	case "private":
		ownerUID = actorUID
	case "department":
		deptCode = strings.TrimSpace(query.Get(codocsTrustedDepartmentManageQueryKey))
		if deptCode == "" {
			return nil, httperror.New(http.StatusForbidden, "trusted_department_manager_required", "Trusted department manager context is required")
		}
		if requested := strings.TrimSpace(stringValue(body["dept_code"])); requested != deptCode {
			return nil, httperror.New(http.StatusForbidden, "folder_department_scope_mismatch", "Folder department does not match trusted manager scope")
		}
	default:
		return nil, httperror.New(http.StatusBadRequest, "unsupported_folder_type", "Folder type is not supported by the scoped create contract")
	}

	parentID := int64Value(body["parent_id"])
	if parentID > 0 {
		if err := a.validateFolderParent(ctx, parentID, folderType, ownerUID, deptCode, projectCode); err != nil {
			return nil, err
		}
	}

	result, err := a.db.ExecContext(ctx, `
      INSERT INTO folders
        (name, folder_type, owner_uid, dept_code, project_code, parent_id, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		name,
		folderType,
		nullableString(ownerUID),
		nullableString(deptCode),
		nullableString(projectCode),
		nullableInt64(parentID),
		0,
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{
		"id":           id,
		"name":         name,
		"folder_type":  folderType,
		"owner_uid":    nullableString(ownerUID),
		"dept_code":    nullableString(deptCode),
		"project_code": nullableString(projectCode),
		"parent_id":    nullableInt64(parentID),
		"sort_order":   0,
	}, nil
}

func (a *Adapter) validateFolderParent(
	ctx context.Context,
	parentID int64,
	folderType string,
	ownerUID string,
	deptCode string,
	projectCode string,
) error {
	var parentFolderType string
	var parentOwnerUID, parentDeptCode, parentProjectCode sql.NullString
	if err := a.db.QueryRowContext(ctx, `
      SELECT folder_type, owner_uid, dept_code, project_code
      FROM folders
      WHERE id = ?
      LIMIT 1`, parentID).Scan(&parentFolderType, &parentOwnerUID, &parentDeptCode, &parentProjectCode); err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(http.StatusBadRequest, "folder_parent_not_found", "Parent folder was not found")
		}
		return err
	}

	scopeMismatch := parentFolderType != folderType
	if !scopeMismatch {
		switch folderType {
		case "private":
			scopeMismatch = strings.TrimSpace(parentOwnerUID.String) != ownerUID ||
				strings.TrimSpace(parentDeptCode.String) != "" ||
				strings.TrimSpace(parentProjectCode.String) != ""
		case "department":
			// Department folders are owned by the department namespace. Older
			// rows may retain the user who originally created the folder, so
			// owner_uid must not split an otherwise identical department tree.
			scopeMismatch = strings.TrimSpace(parentDeptCode.String) != deptCode ||
				strings.TrimSpace(parentProjectCode.String) != ""
		default:
			scopeMismatch = strings.TrimSpace(parentOwnerUID.String) != ownerUID ||
				strings.TrimSpace(parentDeptCode.String) != deptCode ||
				strings.TrimSpace(parentProjectCode.String) != projectCode
		}
	}
	if scopeMismatch {
		return httperror.New(http.StatusForbidden, "folder_parent_scope_mismatch", "Parent folder does not belong to the same folder scope")
	}
	return nil
}

func (a *Adapter) updateFolderOpen(ctx context.Context, id string, query url.Values, body map[string]any) (map[string]any, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Folder id is required")
	}
	if _, _, err := requireTrustedDocumentListActor(query); err != nil {
		return nil, err
	}
	trustedDepartmentManageDeptCode := strings.TrimSpace(query.Get(codocsTrustedDepartmentManageQueryKey))
	if trustedDepartmentManageDeptCode == "" {
		return nil, httperror.New(http.StatusForbidden, "trusted_department_manager_required", "Trusted department manager context is required")
	}
	hasOpenColumn, err := a.columnExists(ctx, "folders", "is_open")
	if err != nil {
		return nil, err
	}
	if !hasOpenColumn {
		return nil, httperror.New(http.StatusInternalServerError, "schema_mismatch", "folders.is_open column is required")
	}

	openValue := false
	if value, ok := body["is_open"]; ok {
		openValue = boolValue(value)
	} else if value, ok := body["isOpen"]; ok {
		openValue = boolValue(value)
	} else {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "is_open is required")
	}

	var folderDeptCode string
	if err := a.db.QueryRowContext(ctx, `
      SELECT dept_code
      FROM folders
      WHERE id = ? AND folder_type = 'department'
      LIMIT 1`, id).Scan(&folderDeptCode); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "record_not_found", "Department folder not found")
		}
		return nil, err
	}
	if folderDeptCode != trustedDepartmentManageDeptCode {
		return nil, httperror.New(http.StatusForbidden, "folder_department_scope_mismatch", "Department manager context does not match folder")
	}

	result, err := a.db.ExecContext(ctx, `
      UPDATE folders
      SET is_open = ?, updated_at = NOW()
	      WHERE id = ? AND folder_type = 'department' AND dept_code = ?`, normalizeBoolInt(openValue), id, trustedDepartmentManageDeptCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Department folder not found")
	}
	return map[string]any{"id": int64Value(id), "is_open": normalizeBoolInt(openValue), "updated": true}, nil
}
