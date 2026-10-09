package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
)

// Opaque comparison evidence, not a disclosure of predecessor identities or
// content. Callers hold the source product lock, stabilizing its edge set.
func crossDependencyFingerprint(ctx context.Context, tx *sql.Tx, code string, itemID int64) (string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT d.biz_id,d.revision,p.biz_id,p.revision,p.lifecycle FROM product_cross_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code WHERE d.planning_item_id=? AND BINARY d.product_code=BINARY ? ORDER BY d.biz_id LIMIT 10001`, itemID, code)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	digest := sha256.New()
	encoder := json.NewEncoder(digest)
	count := 0
	for rows.Next() {
		var edge, pred, state string
		var edgeRevision, itemRevision uint64
		if err = rows.Scan(&edge, &edgeRevision, &pred, &itemRevision, &state); err != nil {
			return "", err
		}
		count++
		if count > 10000 {
			return "", invalid("planning_dependency_limit", "依赖记录超过支持上限")
		}
		if err = encoder.Encode([]any{edge, edgeRevision, pred, itemRevision, state}); err != nil {
			return "", err
		}
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	return "sha256-v1:" + hex.EncodeToString(digest.Sum(nil)), nil
}
