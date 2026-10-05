package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Personal and department cabinet writes deliberately bypass compat CRUD. A
// generic table mutation cannot prove the owner or department-manager fact
// that the browser BFF established before calling tenant-runtime.
func requireTrustedCabinetMutationContext(query url.Values, department bool) (string, string, error) {
	actorUID, _, err := requireTrustedCabinetReadContext(query, false)
	if err != nil {
		return "", "", err
	}
	if !department {
		return actorUID, "", nil
	}
	deptCode := strings.TrimSpace(query.Get(codocsTrustedCabinetDepartmentManagerQueryKey))
	if deptCode == "" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_department_manager_required", "Trusted department manager scope is required")
	}
	return actorUID, deptCode, nil
}

func cabinetMutationFields(body map[string]any) (uuid, filename, originalName, fileExt, ossPath string, fileSize, folderID int64, err error) {
	uuid = strings.TrimSpace(firstNonEmpty(stringValue(body["uuid"]), stringValue(body["documentUuid"]), stringValue(body["document_uuid"])))
	filename = strings.TrimSpace(firstNonEmpty(stringValue(body["filename"]), stringValue(body["name"])))
	originalName = strings.TrimSpace(firstNonEmpty(stringValue(body["originalName"]), stringValue(body["original_name"]), filename))
	fileExt = strings.TrimSpace(firstNonEmpty(stringValue(body["fileExt"]), stringValue(body["file_ext"])))
	ossPath = strings.TrimSpace(firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"])))
	fileSize = int64Value(firstNonEmpty(stringValue(body["fileSize"]), stringValue(body["file_size"])))
	folderID = int64Value(firstNonEmpty(stringValue(body["folderId"]), stringValue(body["folder_id"])))
	if uuid == "" || filename == "" || originalName == "" || fileExt == "" || ossPath == "" {
		err = httperror.New(http.StatusBadRequest, "invalid_request", "uuid, filename, original_name, file_ext and oss_path are required")
	}
	return
}

func (a *Adapter) createCabinetFile(ctx context.Context, query url.Values, body map[string]any, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetMutationContext(query, department)
	if err != nil {
		return nil, err
	}
	uuid, filename, originalName, fileExt, ossPath, fileSize, folderID, err := cabinetMutationFields(body)
	if err != nil {
		return nil, err
	}

	if department {
		if !strings.HasPrefix(ossPath, "codocs/departments/"+deptCode+"/cabinet/") {
			return nil, httperror.New(http.StatusBadRequest, "invalid_cabinet_oss_path", "Department cabinet OSS path is invalid")
		}
	} else if !strings.HasPrefix(ossPath, "codocs/users/"+actorUID+"/cabinet/") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_cabinet_oss_path", "Personal cabinet OSS path is invalid")
	}

	var folder any
	if folderID > 0 {
		folder = folderID
	}
	var dept any
	if department {
		dept = deptCode
	}
	_, err = a.db.ExecContext(ctx, `
      INSERT INTO cabinet_files
        (uuid, filename, original_name, file_ext, file_size, oss_path, owner_uid, dept_code, project_code, folder_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
		uuid, filename, originalName, fileExt, fileSize, ossPath, actorUID, dept, folder)
	if err != nil {
		return nil, err
	}
	return a.cabinetMutationRow(ctx, uuid, actorUID, deptCode, department)
}

func (a *Adapter) updateCabinetFile(ctx context.Context, uuid string, query url.Values, body map[string]any, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetMutationContext(query, department)
	if err != nil {
		return nil, err
	}
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid is required")
	}

	for key := range body {
		if cabinetMutationRuntimeContextKey(key) {
			continue
		}
		switch key {
		case "filename", "folder_id", "folderId":
		default:
			return nil, httperror.New(http.StatusBadRequest, "unsupported_cabinet_mutation_field", "Cabinet file field is not mutable through this command")
		}
	}
	set := make([]string, 0, 3)
	args := make([]any, 0, 6)
	if value, ok := body["filename"]; ok {
		filename := strings.TrimSpace(stringValue(value))
		if filename == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_request", "filename cannot be empty")
		}
		set = append(set, "filename = ?")
		args = append(args, filename)
		if department {
			set = append(set, "original_name = ?")
			args = append(args, filename)
		}
	}
	folderValue, hasFolder := body["folder_id"]
	if !hasFolder {
		folderValue, hasFolder = body["folderId"]
	}
	if hasFolder {
		folderID := int64Value(stringValue(folderValue))
		if folderID > 0 {
			set = append(set, "folder_id = ?")
			args = append(args, folderID)
		} else {
			set = append(set, "folder_id = NULL")
		}
	}
	if len(set) == 0 {
		return a.cabinetMutationRow(ctx, uuid, actorUID, deptCode, department)
	}
	where, whereArgs := cabinetMutationWhere(uuid, actorUID, deptCode, department)
	args = append(args, whereArgs...)
	result, err := a.db.ExecContext(ctx, "UPDATE cabinet_files SET "+strings.Join(set, ", ")+" WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Cabinet file not found")
	}
	return a.cabinetMutationRow(ctx, uuid, actorUID, deptCode, department)
}

func cabinetMutationRuntimeContextKey(key string) bool {
	return strings.HasPrefix(key, "hzy_runtime_") || strings.HasPrefix(key, "current_user") ||
		strings.HasPrefix(key, "operator_") || strings.HasPrefix(key, "actor_") || key == "currentUser" || key == "operatorUid" || key == "actorUid"
}

func (a *Adapter) deleteCabinetFile(ctx context.Context, uuid string, query url.Values, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetMutationContext(query, department)
	if err != nil {
		return nil, err
	}
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid is required")
	}
	where, args := cabinetMutationWhere(uuid, actorUID, deptCode, department)
	result, err := a.db.ExecContext(ctx, "UPDATE cabinet_files SET status = 0, deleted_at = NOW() WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Cabinet file not found")
	}
	return map[string]any{"deleted": true, "uuid": uuid}, nil
}

// markCabinetFileConverted is intentionally separate from the ordinary file
// PATCH command. Only the owner/department-manager conversion handlers may
// write converted_doc_uuid after their OSS/document workflow completes.
func (a *Adapter) markCabinetFileConverted(ctx context.Context, uuid string, query url.Values, body map[string]any, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetMutationContext(query, department)
	if err != nil {
		return nil, err
	}
	uuid = strings.TrimSpace(uuid)
	convertedDocumentUUID := strings.TrimSpace(firstNonEmpty(stringValue(body["convertedDocumentUuid"]), stringValue(body["converted_doc_uuid"])))
	if uuid == "" || convertedDocumentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid and converted_doc_uuid are required")
	}
	where, args := cabinetMutationWhere(uuid, actorUID, deptCode, department)
	result, err := a.db.ExecContext(ctx, "UPDATE cabinet_files SET converted_doc_uuid = ? WHERE "+where, append([]any{convertedDocumentUUID}, args...)...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Cabinet file not found")
	}
	return a.cabinetMutationRow(ctx, uuid, actorUID, deptCode, department)
}

func cabinetMutationWhere(uuid, actorUID, deptCode string, department bool) (string, []any) {
	where := "uuid = ? AND deleted_at IS NULL AND status = 1 AND project_code IS NULL"
	args := []any{uuid}
	if department {
		return where + " AND dept_code = ?", append(args, deptCode)
	}
	return where + " AND owner_uid = ? AND dept_code IS NULL", append(args, actorUID)
}

func (a *Adapter) cabinetMutationRow(ctx context.Context, uuid, actorUID, deptCode string, department bool) (map[string]any, error) {
	where, args := cabinetMutationWhere(uuid, actorUID, deptCode, department)
	rows, err := a.db.QueryContext(ctx, `SELECT `+cabinetFileColumns+` FROM cabinet_files WHERE `+where+` LIMIT 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) != 1 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Cabinet file not found")
	}
	return items[0], nil
}
