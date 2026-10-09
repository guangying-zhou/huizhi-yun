package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"sort"
)

func updateWorkItemVersionTx(ctx context.Context, tx *sql.Tx, projectID, itemID int64, expected sql.NullInt64, targetID int64, feature any) error {
	versions := map[int64]bool{}
	if expected.Valid {
		versions[expected.Int64] = true
	}
	if targetID > 0 {
		versions[targetID] = true
	}
	ids := make([]int64, 0, len(versions))
	for id := range versions {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		var state string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM product_versions WHERE id=? FOR UPDATE`, id).Scan(&state); err != nil {
			return err
		}
		if state != "planning" && state != "developing" {
			return httperror.New(409, "version_not_editable", "source or target version does not accept work item changes")
		}
	}
	var current sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT version_id FROM work_items WHERE id=? AND project_id=? AND tier='target' FOR UPDATE`, itemID, projectID).Scan(&current); err != nil {
		return err
	}
	if current != expected {
		return httperror.New(409, "work_item_version_changed", "work item version changed; refresh and retry")
	}
	if feature != nil {
		var found int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_version_features WHERE id=? AND version_id=? FOR UPDATE`, feature, targetID).Scan(&found); err != nil {
			return err
		}
	}
	var target any
	if targetID > 0 {
		target = targetID
	}
	if _, err := tx.ExecContext(ctx, `UPDATE work_items SET version_id=?,feature_id=? WHERE id=?`, target, feature, itemID); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1 WHERE id=?`, id); err != nil {
			return err
		}
	}
	return nil
}
