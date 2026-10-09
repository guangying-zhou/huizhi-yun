package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// A trusted Host administrator selects source department documents for a
// publication plan. This returns metadata only; prepare locks and revalidates
// every selected row before writing the plan.
func (a *Adapter) EnterpriseCompanyQuickPublishSource(ctx context.Context, query url.Values) (map[string]any, error) {
	dept := strings.TrimSpace(query.Get("deptCode"))
	if len(dept) > 100 || strings.ContainsAny(dept, "/\\\x00\r\n") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_department", "Invalid department")
	}
	page, pageSize := 1, 50
	if raw := query.Get("page"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000000 || strconv.Itoa(value) != raw {
			return nil, httperror.New(400, "invalid_page", "Invalid page")
		}
		page = value
	}
	if raw := query.Get("pageSize"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 || strconv.Itoa(value) != raw {
			return nil, httperror.New(400, "invalid_page", "Invalid page size")
		}
		pageSize = value
	}
	if dept == "" {
		return map[string]any{"folders": []any{}, "documents": []any{}, "total": 0, "page": page, "pageSize": pageSize}, nil
	}
	var folderFilter string
	args := []any{dept}
	if raw := query.Get("folderId"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 1 || strconv.FormatInt(value, 10) != raw {
			return nil, httperror.New(400, "invalid_folder", "Invalid folder")
		}
		var exists int
		if err := a.db.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id=? AND folder_type='department' AND BINARY dept_code=BINARY ?`, value, dept).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, httperror.New(404, "folder_not_found", "Department folder not found")
			}
			return nil, err
		}
		folderFilter = " AND d.folder_id=?"
		args = append(args, value)
	}
	folderRows, err := a.db.QueryContext(ctx, `SELECT id,name,parent_id,dept_code FROM folders WHERE folder_type='department' AND BINARY dept_code=BINARY ? ORDER BY name,id`, dept)
	if err != nil {
		return nil, err
	}
	folders, err := rowsToMaps(folderRows)
	folderRows.Close()
	if err != nil {
		return nil, err
	}
	where := ` FROM documents d WHERE d.doc_type='department' AND d.status=1 AND BINARY d.dept_code=BINARY ?` + folderFilter
	var total int64
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT d.uuid,d.title,d.folder_id,d.dept_code,d.updated_at`+where+` ORDER BY d.updated_at DESC,d.id DESC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	documents, err := rowsToMaps(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	return map[string]any{"folders": folders, "documents": documents, "total": total, "page": page, "pageSize": pageSize}, nil
}
