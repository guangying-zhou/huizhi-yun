package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
)

// Parent names/paths carry only visible customer facts. Hidden ancestors stop
// the path (no ID/name leak); hidden children are represented only by a boolean.
func w3CustomerRelations(ctx context.Context, tx *sql.Tx, table, actor string, scope altoc.BasicReadScope, q altoc.BasicReadQuery, items []map[string]any) error {
	where, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return e
	}
	for _, item := range items {
		var all, visible int64
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM("+where+"),0) FROM "+table+" WHERE parent_customer_id=? AND deleted_at IS NULL", append(append([]any{}, args...), item["id"])...).Scan(&all, &visible); e != nil {
			return e
		}
		item["childCount"], item["hasHiddenChildren"] = visible, all > visible
		parent := item["parent_customer_id"]
		ancestors := []map[string]any{}
		seen := map[string]bool{fmt.Sprint(item["id"]): true}
		for depth := 0; parent != nil && depth < 10; depth++ {
			key := fmt.Sprint(parent)
			if seen[key] {
				break
			}
			seen[key] = true
			rows, e := tx.QueryContext(ctx, "SELECT id,name,parent_customer_id FROM "+table+" WHERE id=? AND deleted_at IS NULL AND ("+where+")", append([]any{parent}, args...)...)
			if e != nil {
				return e
			}
			values, e := readFinanceRows(rows, []string{"id", "name", "parent_customer_id"})
			if e != nil {
				return e
			}
			if len(values) != 1 {
				item["parentHidden"] = true
				if len(ancestors) == 0 {
					delete(item, "parent_customer_id")
				}
				break
			}
			node := values[0]
			ancestors = append([]map[string]any{{"id": node["id"], "name": node["name"]}}, ancestors...)
			parent = node["parent_customer_id"]
		}
		item["ancestors"] = ancestors
		if len(ancestors) > 0 {
			item["parent"] = ancestors[len(ancestors)-1]
		}
	}
	return nil
}
