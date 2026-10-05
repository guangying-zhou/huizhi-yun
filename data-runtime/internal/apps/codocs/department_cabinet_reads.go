package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) DepartmentCabinetFolders(ctx context.Context, query url.Values) (map[string]any, error) {
	_, department, err := requireTrustedCabinetReadContext(query, true)
	if err != nil {
		return nil, err
	}
	page, _ := strconv.Atoi(query.Get("page"))
	size, _ := strconv.Atoi(query.Get("pageSize"))
	if page < 1 || page > 1000000 || size < 1 || size > 200 {
		return nil, httperror.New(400, "department_cabinet_pagination_invalid", "Invalid folder pagination")
	}
	where, args := "dept_code=?", []any{department}
	if parent := query.Get("parent_id"); parent == "" || parent == "null" {
		where += " AND parent_id IS NULL"
	} else {
		where += " AND parent_id=?"
		args = append(args, parent)
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cabinet_folders WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id,name,parent_id,owner_uid,dept_code,sort_order,created_at,updated_at FROM cabinet_folders WHERE `+where+` ORDER BY sort_order ASC,id ASC LIMIT ? OFFSET ?`, append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, nil
}

func (a *Adapter) DepartmentCabinetList(ctx context.Context, query url.Values) (map[string]any, error) {
	return a.cabinetList(ctx, query, true)
}

func (a *Adapter) DepartmentCabinetFile(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	return a.cabinetFile(ctx, uuid, query, true)
}

// A department relationship permits reading the cabinet file, but a later
// converted document still uses its own current document ACL.
func (a *Adapter) DepartmentCabinetConvertedInfo(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	file, err := a.cabinetFile(ctx, uuid, query, true)
	if err != nil {
		return nil, err
	}
	converted := stringValue(file["converted_doc_uuid"])
	if converted == "" {
		return nil, nil
	}
	doc, err := a.documentAccess(ctx, converted, query)
	if err != nil {
		var e httperror.Error
		if errors.As(err, &e) && e.Status == 404 {
			return nil, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return map[string]any{"doc_uuid": doc["uuid"], "doc_title": doc["title"], "doc_path": "部门文档/" + stringValue(doc["title"]) + ".md"}, nil
}
