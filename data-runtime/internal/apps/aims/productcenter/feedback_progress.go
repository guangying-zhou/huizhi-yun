package productcenter

import (
	"context"
	"database/sql"
)

// A feedback snapshot is read inside the caller's workspace-locked transaction.
// It is not an authorization entry point and must not be exposed directly.
type FeedbackProgress struct {
	CanonicalRequestBizID   string                    `json:"canonicalRequestBizId"`
	CanonicalDecisionStatus string                    `json:"canonicalDecisionStatus"`
	Versions                []FeedbackVersionProgress `json:"versions"`
}

type FeedbackVersionProgress struct {
	VersionCode           string  `json:"versionCode"`
	Status                string  `json:"status"`
	PlannedReleaseDate    *string `json:"plannedReleaseDate"`
	ReleasedAt            *string `json:"releasedAt"`
	PublicFeatureCount    uint64  `json:"publicFeatureCount"`
	DeliveredFeatureCount uint64  `json:"deliveredFeatureCount"`
}

// Keep original feedback identities separate from the canonical request's current
// decision. Never infer customer deployment, ticket resolution, or commitments.
func readFeedbackProgressTx(ctx context.Context, tx *sql.Tx, product string, requestID int64) (FeedbackProgress, error) {
	canonicalID, out, err := resolveFeedbackCanonicalTx(ctx, tx, product, requestID)
	if err != nil {
		return out, err
	}
	// EXISTS avoids counting the same public version feature more than once when
	// several requests in a merged family refer to the same product feature.
	rows, err := tx.QueryContext(ctx, `WITH RECURSIVE request_family AS (
 SELECT id FROM product_requests WHERE BINARY product_code=BINARY ? AND id=?
 UNION DISTINCT SELECT r.id FROM product_requests r JOIN request_family f ON r.merged_into_id=f.id WHERE BINARY r.product_code=BINARY ?
 ) SELECT v.version_code,v.status,DATE_FORMAT(v.planned_release_date,'%Y-%m-%d'),DATE_FORMAT(v.released_at,'%Y-%m-%d %H:%i:%s'),COUNT(*),SUM(vf.status='delivered')
 FROM product_versions v JOIN product_version_features vf ON vf.version_id=v.id
 WHERE BINARY v.product_code=BINARY ? AND vf.is_public=1 AND EXISTS (
 SELECT 1 FROM product_request_features rf JOIN request_family f ON f.id=rf.request_id
 WHERE BINARY rf.product_code=BINARY ? AND rf.product_feature_id=vf.product_feature_id)
 GROUP BY v.id,v.version_code,v.status,v.planned_release_date,v.released_at
 ORDER BY v.version_code,v.id`, product, canonicalID, product, product, product)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item FeedbackVersionProgress
		if err := rows.Scan(&item.VersionCode, &item.Status, &item.PlannedReleaseDate, &item.ReleasedAt, &item.PublicFeatureCount, &item.DeliveredFeatureCount); err != nil {
			return out, err
		}
		out.Versions = append(out.Versions, item)
	}
	return out, rows.Err()
}

// Resolve identity without loading version aggregates. Caller holds the workspace lock.
func resolveFeedbackCanonicalTx(ctx context.Context, tx *sql.Tx, product string, requestID int64) (int64, FeedbackProgress, error) {
	return resolveFeedbackCanonicalCachedTx(ctx, tx, product, requestID, nil)
}

type feedbackMergeNode struct {
	bizID  string
	status string
	next   *int64
}

// Cache only raw graph nodes within one workspace-locked transaction. Keeping
// traversal validation per source preserves the 64-node limit and cycle checks.
func resolveFeedbackCanonicalCachedTx(ctx context.Context, tx *sql.Tx, product string, requestID int64, cache map[int64]feedbackMergeNode) (int64, FeedbackProgress, error) {
	out := FeedbackProgress{Versions: []FeedbackVersionProgress{}}
	seen := map[int64]bool{}
	canonicalID := requestID
	for {
		if seen[canonicalID] {
			return 0, out, invalid("product_request_merge_cycle", "需求合并关系存在循环")
		}
		if len(seen) >= 64 {
			return 0, out, invalid("product_request_merge_depth", "需求合并关系超过读取上限")
		}
		seen[canonicalID] = true
		node, cached := cache[canonicalID]
		if !cached {
			if err := tx.QueryRowContext(ctx, `SELECT biz_id,decision_status,merged_into_id FROM product_requests WHERE BINARY product_code=BINARY ? AND id=?`, product, canonicalID).Scan(&node.bizID, &node.status, &node.next); err != nil {
				return 0, out, err
			}
			if cache != nil {
				cache[canonicalID] = node
			}
		}
		out.CanonicalRequestBizID, out.CanonicalDecisionStatus = node.bizID, node.status
		next := node.next
		if (out.CanonicalDecisionStatus == "merged") != (next != nil) {
			return 0, out, invalid("product_request_merge_inconsistent", "需求合并状态与引用不一致")
		}
		if next == nil {
			break
		}
		canonicalID = *next
	}
	return canonicalID, out, nil
}
