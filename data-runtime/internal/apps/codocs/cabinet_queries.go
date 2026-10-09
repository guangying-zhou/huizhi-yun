package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// codocsTrustedCabinetDepartmentReadQueryKey is placed in the BFF-to-runtime
// request target only after Codocs has checked the user's department access.
// The tenant-runtime actor signature covers that complete target, while the
// runtime overwrites the actor fields and sets hzy_runtime_actor_delegated.
// Browser-supplied actor or marker values therefore cannot establish scope.
const codocsTrustedCabinetDepartmentReadQueryKey = "codocs_trusted_cabinet_department_dept_code"

// codocsTrustedCabinetDepartmentManagerQueryKey is only added by the Codocs
// BFF after it has checked the delegated user against the target department.
// Foundation signs the full request target, so the runtime must use this value
// instead of any browser/body dept_code when mutating a department cabinet.
const codocsTrustedCabinetDepartmentManagerQueryKey = "codocs_trusted_cabinet_department_manager_dept_code"

const cabinetFileColumns = `id, uuid, filename, original_name, file_ext, file_size, oss_path,
  owner_uid, dept_code, project_code, folder_id, converted_doc_uuid, created_at, updated_at`

func requireTrustedCabinetReadContext(query url.Values, department bool) (string, string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	if !department {
		return actorUID, "", nil
	}
	deptCode := strings.TrimSpace(query.Get(codocsTrustedCabinetDepartmentReadQueryKey))
	if deptCode == "" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_department_required", "Trusted department read scope is required")
	}
	return actorUID, deptCode, nil
}

func (a *Adapter) cabinetList(ctx context.Context, query url.Values, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetReadContext(query, department)
	if err != nil {
		return nil, err
	}
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	where := []string{"deleted_at IS NULL", "status = 1"}
	args := []any{}
	if department {
		where = append(where, "dept_code = ?")
		args = append(args, deptCode)
	} else {
		// A personal cabinet is always the delegated actor's own non-shared
		// cabinet. owner_uid and scope columns supplied by the browser are
		// intentionally ignored.
		where = append(where, "owner_uid = ?", "dept_code IS NULL", "project_code IS NULL")
		args = append(args, actorUID)
	}

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
	rows, err := a.db.QueryContext(ctx, `SELECT `+cabinetFileColumns+`
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

// cabinetFile is the only browser-facing file metadata read path. It keeps
// personal and department scope predicates in the SQL query so the generic
// compat ResourceSpec cannot return a cross-owner or cross-department record.
func (a *Adapter) cabinetFile(ctx context.Context, uuid string, query url.Values, department bool) (map[string]any, error) {
	actorUID, deptCode, err := requireTrustedCabinetReadContext(query, department)
	if err != nil {
		return nil, err
	}
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuid is required")
	}
	where := []string{"uuid = ?", "deleted_at IS NULL", "status = 1"}
	args := []any{uuid}
	if department {
		where = append(where, "dept_code = ?")
		args = append(args, deptCode)
	} else {
		where = append(where, "owner_uid = ?", "dept_code IS NULL", "project_code IS NULL")
		args = append(args, actorUID)
	}
	rows, err := a.db.QueryContext(ctx, `SELECT `+cabinetFileColumns+`
      FROM cabinet_files
      WHERE `+strings.Join(where, " AND ")+`
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
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Cabinet file not found")
	}
	return items[0], nil
}
