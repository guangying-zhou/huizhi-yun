package productcenter

import (
	"context"
	"database/sql"
)

type ProductReleaseSummary struct {
	ID                 int64   `json:"id"`
	BizID              string  `json:"biz_id"`
	VersionID          int64   `json:"version_id"`
	ReleaseSeq         uint64  `json:"release_seq"`
	ScopeRevision      uint64  `json:"scope_revision"`
	ReleasedBy         *string `json:"released_by"`
	ReleasedAt         *string `json:"released_at"`
	EvidenceLevel      string  `json:"evidence_level"`
	SupersedesRecordID *int64  `json:"supersedes_record_id"`
	Current            bool    `json:"current"`
	Withdrawn          bool    `json:"withdrawn"`
	Superseded         bool    `json:"superseded"`
}
type ProductReleasePage struct {
	Items    []ProductReleaseSummary `json:"items"`
	Total    int                     `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
}

func ListProductVersionReleases(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID int64, q PlanningPageQuery) (ProductReleasePage, error) {
	out := ProductReleasePage{Items: []ProductReleaseSummary{}, Page: q.Page, PageSize: q.PageSize}
	if versionID <= 0 || q.Keyword != "" || q.Lifecycle != "" || q.InvestmentCategory != "" {
		return out, invalid("product_release_query_invalid", "发布记录查询参数无效")
	}
	if err := ValidatePlanningPageQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	version, err := loadProductVersion(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_release_records WHERE version_id=?`, versionID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT r.id,r.biz_id,r.version_id,r.release_seq,r.scope_revision,r.released_by,DATE_FORMAT(r.released_at,'%Y-%m-%dT%H:%i:%s.%fZ'),r.evidence_level,r.supersedes_record_id,EXISTS(SELECT 1 FROM product_release_events e WHERE e.release_record_id=r.id AND e.event_type='withdrawn'),EXISTS(SELECT 1 FROM product_release_events e WHERE e.release_record_id=r.id AND e.event_type='superseded') FROM product_release_records r WHERE r.version_id=? ORDER BY r.release_seq DESC,r.id DESC LIMIT ? OFFSET ?`, versionID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductReleaseSummary
		if err = rows.Scan(&item.ID, &item.BizID, &item.VersionID, &item.ReleaseSeq, &item.ScopeRevision, &item.ReleasedBy, &item.ReleasedAt, &item.EvidenceLevel, &item.SupersedesRecordID, &item.Withdrawn, &item.Superseded); err != nil {
			rows.Close()
			return out, err
		}
		item.Current = version.Status == "released" && version.CurrentReleaseRecordID != nil && *version.CurrentReleaseRecordID == item.ID && !item.Withdrawn && !item.Superseded
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
