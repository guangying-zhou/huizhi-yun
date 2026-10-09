package codocs

import (
	"context"
	"database/sql"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// A private folder page contains only direct children. Ancestors and complete
// direct child counts come from the same read-only snapshot as COUNT and items.
func (a *Adapter) privateFoldersPage(ctx context.Context, query url.Values, actor string, page, size int) (map[string]any, error) {
	if owner := query.Get("owner_uid"); owner != "" && owner != actor {
		return nil, httperror.New(403, "folder_owner_mismatch", "Folder owner mismatch")
	}
	parentID := int64(0)
	if values, present := query["parent_id"]; present {
		if len(values) != 1 || values[0] == "" {
			return nil, httperror.New(400, "folder_parent_invalid", "Invalid parent folder")
		}
		if values[0] != "null" {
			parsed, err := strconv.ParseInt(values[0], 10, 64)
			if err != nil || parsed < 1 || strconv.FormatInt(parsed, 10) != values[0] {
				return nil, httperror.New(400, "folder_parent_invalid", "Invalid parent folder")
			}
			parentID = parsed
		}
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	chain := []map[string]any{}
	seen := map[int64]bool{}
	for current := parentID; current != 0; {
		if seen[current] || len(chain) >= 64 {
			return nil, httperror.New(503, "folder_ancestry_invalid", "Folder ancestry unavailable")
		}
		seen[current] = true
		var name string
		var ancestor sql.NullInt64
		err = tx.QueryRowContext(ctx, "SELECT name,parent_id FROM folders WHERE id=? AND folder_type='private' AND owner_uid=?", current, actor).Scan(&name, &ancestor)
		if err == sql.ErrNoRows {
			return nil, httperror.New(404, "folder_not_found", "Folder not found")
		}
		if err != nil {
			return nil, err
		}
		chain = append([]map[string]any{{"id": current, "name": name, "parent_id": nullableInt64(ancestor.Int64)}}, chain...)
		current = ancestor.Int64
	}
	parentWhere := "parent_id IS NULL"
	args := []any{actor}
	if parentID != 0 {
		parentWhere = "parent_id=?"
		args = append(args, parentID)
	}
	where := "folder_type='private' AND owner_uid=? AND " + parentWhere
	var total int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM folders WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rowArgs := append([]any{actor, actor}, args...)
	rowArgs = append(rowArgs, size, (page-1)*size)
	rows, err := tx.QueryContext(ctx, `SELECT id,name,parent_id,sort_order,created_at,updated_at,
 (SELECT COUNT(*) FROM folders child WHERE child.parent_id=folders.id AND child.folder_type='private' AND child.owner_uid=?),
 (SELECT COUNT(*) FROM documents d WHERE d.folder_id=folders.id AND d.doc_type='private' AND d.owner_uid=? AND d.status=1 AND d.oss_path NOT LIKE 'codocs/worklogs/%')
 FROM folders WHERE `+where+` ORDER BY sort_order ASC,created_at DESC,id DESC LIMIT ? OFFSET ?`, rowArgs...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var name string
		var parent sql.NullInt64
		var sortOrder int64
		var created, updated any
		var folderCount, documentCount int64
		if err = rows.Scan(&id, &name, &parent, &sortOrder, &created, &updated, &folderCount, &documentCount); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "parent_id": nullableInt64(parent.Int64), "folder_type": "private", "owner_uid": actor, "sort_order": sortOrder, "created_at": created, "updated_at": updated, "folderCount": folderCount, "documentCount": documentCount})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "parentChain": chain}, nil
}
