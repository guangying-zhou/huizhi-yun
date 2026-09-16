package productcenter

import (
	"context"
	"database/sql"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Refresh every feedback family once after a product version mutation. Selecting
// from bindings, rather than current version links, also clears removed evidence.
func enqueueProductFeedbackProgressTx(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, actor, product string, revision uint64) error {
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT request_id FROM product_feedback_bindings WHERE BINARY product_code=BINARY ? AND source_app='altoc' AND source_type='service_ticket' ORDER BY request_id`, product)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	roots := map[int64]bool{}
	mergeNodes := map[int64]feedbackMergeNode{}
	for _, id := range ids {
		rootID, _, err := resolveFeedbackCanonicalCachedTx(ctx, tx, product, id, mergeNodes)
		if err != nil {
			return err
		}
		if roots[rootID] {
			continue
		}
		roots[rootID] = true
		if err := enqueueFeedbackProgressTx(ctx, tx, trusted, actor, product, rootID, revision); err != nil {
			return err
		}
	}
	return nil
}
