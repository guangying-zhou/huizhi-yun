package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type FeatureRequestPageQuery struct {
	FeatureBizID string `json:"feature_biz_id"`
	Page         int    `json:"page"`
	PageSize     int    `json:"page_size"`
}

func ListFeatureRequests(ctx context.Context, db *sql.DB, code, uid string, requestPermit, featurePermit AuthorizationPermit, q FeatureRequestPageQuery) (RequestPage, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return RequestPage{}, err
	}
	defer tx.Rollback()
	out, err := ListFeatureRequestsInTransaction(ctx, tx, code, uid, requestPermit, featurePermit, q)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ListFeatureRequestsInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, requestPermit, featurePermit AuthorizationPermit, q FeatureRequestPageQuery) (RequestPage, error) {
	var out RequestPage
	id, err := uuid.Parse(q.FeatureBizID)
	if err != nil || id.String() != q.FeatureBizID {
		return out, invalid("product_feature_request_id_invalid", "功能标识无效")
	}
	if err := ValidateRequestPageQuery(RequestPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "事务不可用")
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", requestPermit); err != nil {
		return out, err
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", featurePermit); err != nil {
		return out, err
	}
	var featureID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM product_features WHERE product_code=? AND biz_id=?`, code, q.FeatureBizID).Scan(&featureID); err != nil {
		return out, err
	}
	where := ` FROM product_requests WHERE product_code=? AND EXISTS (SELECT 1 FROM product_request_features link WHERE link.product_code=product_requests.product_code AND link.request_id=product_requests.id AND link.product_feature_id=?)`
	args := []any{code, featureID}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(decision_status<>'merged'),0)`+where, args...).Scan(&out.Total, &out.UnmergedTotal); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+requestColumns+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []RequestRecord{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Page, out.PageSize, out.WorkspaceRevision = q.Page, q.PageSize, requestPermit.Facts.Revision
	return out, nil
}
