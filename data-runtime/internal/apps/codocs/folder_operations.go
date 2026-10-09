package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type folderScopeRow struct {
	ID                         int64
	Name, Kind                 string
	Owner, Department, Project sql.NullString
	Parent                     sql.NullInt64
}

type folderQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readFolderScope(ctx context.Context, db folderQuerier, id int64, lock bool) (folderScopeRow, error) {
	row := folderScopeRow{}
	query := "SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = ?"
	if lock {
		query += " FOR UPDATE"
	}
	err := db.QueryRowContext(ctx, query, id).Scan(&row.ID, &row.Name, &row.Kind, &row.Owner, &row.Department, &row.Project, &row.Parent)
	if err == sql.ErrNoRows {
		err = httperror.New(404, "folder_not_found", "Folder was not found")
	}
	return row, err
}

func folderScopeAllowed(row folderScopeRow, actor string, query url.Values, write bool) bool {
	switch row.Kind {
	case "private", "slide":
		return row.Owner.String == actor && row.Department.String == "" && row.Project.String == ""
	case "department":
		key := codocsTrustedDepartmentReadQueryKey
		if write {
			key = codocsTrustedDepartmentManageQueryKey
		}
		return row.Department.String != "" && row.Department.String == query.Get(key) && row.Project.String == ""
	}
	return false
}

func (a *Adapter) scopedFolderOperation(ctx context.Context, method, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actor, _, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || id < 1 || strconv.FormatInt(id, 10) != rawID {
		return nil, httperror.New(400, "invalid_folder_id", "Invalid folder identifier")
	}
	if method == http.MethodGet {
		row, err := readFolderScope(ctx, a.db, id, false)
		if err != nil {
			return nil, err
		}
		if !folderScopeAllowed(row, actor, query, false) {
			return nil, httperror.New(403, "folder_scope_denied", "Folder is outside the actor scope")
		}
		return map[string]any{"id": row.ID, "name": row.Name, "folder_type": row.Kind, "owner_uid": nullableString(row.Owner.String), "dept_code": nullableString(row.Department.String), "project_code": nullableString(row.Project.String), "parent_id": nullableInt64(row.Parent.Int64)}, nil
	}
	// Serializable range reads prevent a concurrent child/document insertion
	// from racing an empty-folder deletion. Every mutation rechecks its scope
	// while holding the target row lock, rather than trusting BFF preflight.
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := readFolderScope(ctx, tx, id, true)
	if err != nil {
		return nil, err
	}
	if !folderScopeAllowed(row, actor, query, true) {
		return nil, httperror.New(403, "folder_scope_denied", "Folder is outside the actor scope")
	}
	if method == http.MethodDelete {
		for _, check := range []string{"SELECT id FROM folders WHERE parent_id = ? LIMIT 1 FOR UPDATE", "SELECT id FROM documents WHERE folder_id = ? LIMIT 1 FOR UPDATE"} {
			var child int64
			err = tx.QueryRowContext(ctx, check, id).Scan(&child)
			if err == nil {
				return nil, httperror.New(409, "folder_not_empty", "Folder contains child folders or documents, including recoverable documents")
			}
			if err != sql.ErrNoRows {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM folders WHERE id = ?", id); err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "deleted": true}, nil
	}
	if method != http.MethodPatch {
		return nil, httperror.New(405, "method_not_allowed", "Unsupported folder operation")
	}
	name, parent := row.Name, row.Parent.Int64
	changed := false
	for key, value := range body {
		if codocsRuntimeAuthKeys[key] {
			continue
		}
		switch key {
		case "name":
			text, ok := value.(string)
			if !ok || strings.TrimSpace(text) == "" || len([]rune(text)) > 100 {
				return nil, httperror.New(400, "invalid_folder_name", "Invalid folder name")
			}
			name, changed = strings.TrimSpace(text), true
		case "parent_id":
			parent = 0
			if value != nil {
				n, ok := value.(float64)
				if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
					return nil, httperror.New(400, "invalid_folder_parent", "Invalid parent identifier")
				}
				parent = int64(n)
			}
			changed = true
		default:
			return nil, httperror.New(400, "invalid_folder_field", "Unsupported folder field")
		}
	}
	if !changed {
		return nil, httperror.New(400, "empty_folder_update", "No folder fields supplied")
	}
	if parent != row.Parent.Int64 {
		seen := map[int64]bool{id: true}
		for ancestor := parent; ancestor > 0; {
			if seen[ancestor] || len(seen) > 256 {
				return nil, httperror.New(400, "folder_cycle", "Folder hierarchy would contain a cycle or exceed its depth limit")
			}
			seen[ancestor] = true
			candidate, err := readFolderScope(ctx, tx, ancestor, true)
			if err != nil {
				return nil, err
			}
			if candidate.Kind != row.Kind || !folderScopeAllowed(candidate, actor, query, true) || (row.Kind == "department" && candidate.Department.String != row.Department.String) {
				return nil, httperror.New(403, "folder_parent_scope_mismatch", "Parent folder belongs to another scope")
			}
			ancestor = candidate.Parent.Int64
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE folders SET name = ?, parent_id = ?, updated_at = NOW() WHERE id = ?", name, nullableInt64(parent), id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "updated": true}, nil
}
