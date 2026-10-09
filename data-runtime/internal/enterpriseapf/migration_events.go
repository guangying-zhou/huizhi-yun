package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
)

// No old_value/new_value/resolution_json: these may contain sensitive source
// material. Every event query first checks the object's current owning domain.
func migrationEvents(ctx context.Context, tx *sql.Tx, t map[string]string, domain string, i MigrationQueueInput) (any, error) {
	key := i.Options.EventsFor
	var exists int
	entity := "migration_exception"
	where := "entity_type=? AND entity_id=?"
	args := []any{entity, strings.TrimPrefix(key, "exception:")}
	if strings.HasPrefix(key, "identity:") {
		key = strings.TrimPrefix(key, "identity:")
		entity = "migration_identity"
		where = "entity_type=? AND BINARY entity_code=BINARY ?"
		args = []any{entity, key}
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["mig_identity_map"]+" WHERE source_system=? AND BINARY source_user_id=BINARY ?", migrationSourceSystem, key).Scan(&exists); err != nil {
			return nil, err
		}
	} else {
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["mig_exception"]+" WHERE owning_domain=? AND id=?", domain, args[1]).Scan(&exists); err != nil {
			return nil, err
		}
	}
	if exists != 1 {
		return nil, httperror.New(404, "migration_queue_item_not_found", "Item is not available")
	}
	var total int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["audit"]+" WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id,action,operator_uid,channel,CAST(created_at AS CHAR) AS created_at FROM "+t["audit"]+" WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", append(args, i.PageSize, (i.Page-1)*i.PageSize)...)
	if err != nil {
		return nil, err
	}
	items, err := readFinanceRows(rows, []string{"id", "action", "operator_uid", "channel", "created_at"})
	if err != nil {
		return nil, err
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize, "openCounts": map[string]int64{}}, nil
}
