package productcenter

import (
	"context"
	"database/sql"
)

// Links are read under the same product root lock as the starting request.
// Historical edges stay intact even when their target is merged again.
type RequestMergeLink struct {
	BizID          string `json:"biz_id"`
	Title          string `json:"title"`
	DecisionStatus string `json:"decision_status"`
}

func readRequestMergeTrail(ctx context.Context, tx *sql.Tx, code string, source RequestRecord) ([]RequestMergeLink, bool, error) {
	trail := []RequestMergeLink{}
	seen := map[int64]bool{source.ID: true}
	next := source.MergedIntoID
	for next != nil {
		if seen[*next] {
			return nil, false, invalid("product_request_merge_cycle", "需求合并关系存在循环，请联系产品管理员核查")
		}
		if len(trail) == 64 {
			return trail, true, nil
		}
		seen[*next] = true
		var link RequestMergeLink
		var following *int64
		err := tx.QueryRowContext(ctx, `SELECT biz_id,title,decision_status,merged_into_id FROM product_requests WHERE product_code=? AND id=?`, code, *next).Scan(&link.BizID, &link.Title, &link.DecisionStatus, &following)
		if err != nil {
			return nil, false, err
		}
		trail = append(trail, link)
		next = following
	}
	return trail, false, nil
}
