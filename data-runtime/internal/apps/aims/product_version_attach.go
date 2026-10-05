package aims

import (
	"context"
	"database/sql"
	"sort"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) attachVersionItemsTransaction(ctx context.Context, projectID, versionID int64, feature any, itemIDs []int64) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Discover versions before acquiring locks, then recheck item membership
	// under a current locking read. Never move an item from an unlocked version.
	oldVersions := map[int64]sql.NullInt64{}
	versions := map[int64]bool{versionID: true}
	for _, id := range itemIDs {
		var old sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT version_id FROM work_items WHERE id=? AND project_id=? AND tier='target'`, id, projectID).Scan(&old); err != nil {
			return nil, err
		}
		oldVersions[id] = old
		if old.Valid {
			versions[old.Int64] = true
		}
	}
	ordered := make([]int64, 0, len(versions))
	for id := range versions {
		ordered = append(ordered, id)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	for _, id := range ordered {
		var status string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM product_versions WHERE id=? FOR UPDATE`, id).Scan(&status); err != nil {
			return nil, err
		}
		if status != "planning" && status != "developing" {
			return nil, httperror.New(409, "version_not_editable", "source or target version does not accept work item changes")
		}
	}
	if feature != nil {
		var id int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_version_features WHERE id=? AND version_id=? FOR UPDATE`, feature, versionID).Scan(&id); err != nil {
			return nil, err
		}
	}
	ids := make([]int64, 0, len(oldVersions))
	for id := range oldVersions {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		var current sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT version_id FROM work_items WHERE id=? AND project_id=? AND tier='target' FOR UPDATE`, id, projectID).Scan(&current); err != nil {
			return nil, err
		}
		if current != oldVersions[id] {
			return nil, httperror.New(409, "work_item_version_changed", "work item version changed; refresh and retry")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE work_items SET version_id=?,feature_id=? WHERE id=?`, versionID, feature, id); err != nil {
			return nil, err
		}
	}
	for _, id := range ordered {
		if _, err := tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1 WHERE id=?`, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"attached": len(ids), "version_id": versionID}, nil
}
