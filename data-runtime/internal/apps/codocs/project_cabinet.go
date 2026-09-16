package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const codocsTrustedProjectCabinetQueryKey = "codocs_trusted_project_cabinet_project_code"

func trustedProjectCabinetCode(query url.Values) (string, error) {
	projectCode := strings.TrimSpace(query.Get(codocsTrustedProjectCabinetQueryKey))
	if projectCode == "" {
		return "", httperror.New(http.StatusForbidden, "project_cabinet_scope_required", "trusted project cabinet scope is required")
	}
	return projectCode, nil
}

func validProjectCabinetOSSPath(projectCode, ossPath string) bool {
	return strings.HasPrefix(strings.TrimSpace(ossPath), "codocs/projects/"+projectCode+"/cabinet/")
}

// projectCabinetList is the project-scoped cabinet metadata list. Project
// authorization remains the caller BFF/service contract; this runtime method
// preserves the existing project_code and optional folder predicates.
func (a *Adapter) projectCabinetList(ctx context.Context, query url.Values) (map[string]any, error) {
	projectCode, err := trustedProjectCabinetCode(query)
	if err != nil {
		return nil, err
	}
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	where := []string{"deleted_at IS NULL", "status = 1", "project_code = ?"}
	args := []any{projectCode}
	folderID := strings.TrimSpace(query.Get("folder_id"))
	if folderID == "" || strings.EqualFold(folderID, "null") {
		where = append(where, "folder_id IS NULL")
	} else {
		where = append(where, "folder_id = ?")
		args = append(args, folderID)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cabinet_files WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT `+cabinetFileColumns+`
      FROM cabinet_files
      WHERE `+whereSQL+`
      ORDER BY created_at DESC
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

func (a *Adapter) projectCabinetFile(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid is required")
	}
	projectCode, err := trustedProjectCabinetCode(query)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT `+cabinetFileColumns+`
      FROM cabinet_files
		WHERE uuid = ? AND project_code = ? AND deleted_at IS NULL AND status = 1
      LIMIT 1`, uuid, projectCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Project cabinet file not found")
	}
	return items[0], nil
}

func (a *Adapter) createProjectCabinetFile(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	projectCode, err := trustedProjectCabinetCode(query)
	if err != nil {
		return nil, err
	}
	requestedProjectCode := firstNonEmpty(stringValue(body["projectCode"]), stringValue(body["project_code"]))
	if requestedProjectCode != "" && requestedProjectCode != projectCode {
		return nil, httperror.New(http.StatusForbidden, "project_cabinet_scope_mismatch", "project_code does not match trusted scope")
	}
	uuid := firstNonEmpty(stringValue(body["uuid"]), stringValue(body["documentUuid"]), stringValue(body["document_uuid"]))
	if uuid == "" {
		generated, err := randomUUID()
		if err != nil {
			return nil, err
		}
		uuid = generated
	}
	filename := firstNonEmpty(stringValue(body["filename"]), stringValue(body["name"]), stringValue(body["original_name"]))
	originalName := firstNonEmpty(stringValue(body["originalName"]), stringValue(body["original_name"]), filename)
	fileExt := firstNonEmpty(stringValue(body["fileExt"]), stringValue(body["file_ext"]))
	ossPath := firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"]))
	ownerUID := firstNonEmpty(stringValue(body["ownerUid"]), stringValue(body["owner_uid"]), stringValue(body["current_user"]))
	if filename == "" || originalName == "" || fileExt == "" || ossPath == "" || ownerUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "filename, original_name, file_ext, oss_path and owner_uid are required")
	}
	if !validProjectCabinetOSSPath(projectCode, ossPath) {
		return nil, httperror.New(http.StatusForbidden, "project_cabinet_oss_path_invalid", "oss_path is outside the trusted project cabinet prefix")
	}
	fileSize := int64Value(firstNonEmpty(stringValue(body["fileSize"]), stringValue(body["file_size"])))
	folderID := int64Value(firstNonEmpty(stringValue(body["folderId"]), stringValue(body["folder_id"])))
	deptCode := firstNonEmpty(stringValue(body["deptCode"]), stringValue(body["dept_code"]))

	_, err = a.db.ExecContext(ctx, `
      INSERT INTO cabinet_files
        (uuid, filename, original_name, file_ext, file_size, oss_path, owner_uid, dept_code, project_code, folder_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		uuid,
		filename,
		originalName,
		fileExt,
		fileSize,
		ossPath,
		ownerUID,
		nullableString(deptCode),
		projectCode,
		nullableInt64(folderID),
	)
	if err != nil {
		return nil, err
	}
	return a.projectCabinetFile(ctx, uuid, query)
}

func (a *Adapter) deleteProjectCabinetFile(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid is required")
	}
	projectCode, err := trustedProjectCabinetCode(query)
	if err != nil {
		return nil, err
	}
	expectedOSSPath := firstNonEmpty(stringValue(body["expectedOssPath"]), stringValue(body["expected_oss_path"]))
	if expectedOSSPath == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "expected_oss_path is required")
	}
	if !validProjectCabinetOSSPath(projectCode, expectedOSSPath) {
		return nil, httperror.New(http.StatusForbidden, "project_cabinet_oss_path_invalid", "expected_oss_path is outside the trusted project cabinet prefix")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var lockedOSSPath string
	err = tx.QueryRowContext(ctx, `SELECT oss_path FROM cabinet_files WHERE uuid = ? AND project_code = ? AND deleted_at IS NULL AND status = 1 FOR UPDATE`, uuid, projectCode).Scan(&lockedOSSPath)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Project cabinet file not found")
	}
	if err != nil {
		return nil, err
	}
	if lockedOSSPath != expectedOSSPath {
		return nil, httperror.New(http.StatusConflict, "project_cabinet_oss_path_mismatch", "expected_oss_path does not match the locked file")
	}
	result, err := tx.ExecContext(ctx, `UPDATE cabinet_files SET status = 0, deleted_at = NOW() WHERE uuid = ? AND project_code = ? AND deleted_at IS NULL AND status = 1`, uuid, projectCode)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "project_cabinet_delete_conflict", "Project cabinet file changed while deleting")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true, "uuid": uuid, "oss_path": lockedOSSPath, "project_code": projectCode}, nil
}
