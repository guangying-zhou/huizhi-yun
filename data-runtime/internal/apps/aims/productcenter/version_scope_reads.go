package productcenter

import (
	"context"
	"database/sql"
	"strings"
)

type ProductVersionScopeSuccessor struct {
	ScopeID     int64  `json:"scope_id"`
	VersionID   int64  `json:"version_id"`
	VersionCode string `json:"version_code"`
}
type ProductVersionScopeRecord struct {
	IsPublic                bool                           `json:"is_public"`
	Successors              []ProductVersionScopeSuccessor `json:"successors"`
	DeferredFromScopeID     *int64                         `json:"deferred_from_scope_id"`
	DeferredFromVersionID   *int64                         `json:"deferred_from_version_id"`
	DeferredFromVersionCode *string                        `json:"deferred_from_version_code"`
	ID                      int64                          `json:"id"`
	VersionID               int64                          `json:"version_id"`
	Title                   string                         `json:"title"`
	Description             *string                        `json:"description"`
	Status                  string                         `json:"status"`
	ChangeType              *string                        `json:"change_type"`
	AcceptanceCriteria      *string                        `json:"acceptance_criteria"`
	PlanningItemBizID       *string                        `json:"planning_item_biz_id"`
	ProductFeatureBizID     *string                        `json:"product_feature_biz_id"`
	LegacyUnscored          bool                           `json:"legacy_unscored"`
}
type ProductVersionScopePage struct {
	Items             []ProductVersionScopeRecord `json:"items"`
	Total             int                         `json:"total"`
	Page              int                         `json:"page"`
	PageSize          int                         `json:"pageSize"`
	VersionRevision   uint64                      `json:"version_revision"`
	ScopeRevision     uint64                      `json:"scope_revision"`
	WorkspaceRevision uint64                      `json:"workspace_revision"`
}

func ListProductVersionScope(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID int64, q PlanningPageQuery) (ProductVersionScopePage, error) {
	var out ProductVersionScopePage
	if versionID <= 0 {
		return out, invalid("product_version_id_invalid", "版本标识无效")
	}
	if q.Lifecycle != "" || q.InvestmentCategory != "" {
		return out, invalid("product_version_scope_query_invalid", "版本范围筛选条件无效")
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
	where := ` WHERE vf.version_id=?`
	args := []any{versionID}
	if q.Keyword != "" {
		where += ` AND (LOCATE(?,vf.title)>0 OR LOCATE(?,COALESCE(vf.description,''))>0)`
		args = append(args, q.Keyword, q.Keyword)
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_features vf`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	// Joins use the product boundary even for migrated rows whose old foreign
	// keys did not bind the product; IDs from other products are never exposed.
	from := ` FROM product_version_features vf LEFT JOIN product_planning_items i ON i.id=vf.planning_item_id AND i.product_code=? LEFT JOIN product_features f ON f.id=vf.product_feature_id AND f.product_code=? LEFT JOIN product_version_features original ON original.id=vf.deferred_from_feature_id LEFT JOIN product_versions original_version ON original_version.id=original.version_id AND BINARY original_version.product_code=BINARY ?`
	rows, err := tx.QueryContext(ctx, `SELECT vf.is_public,vf.id,vf.version_id,vf.title,vf.description,vf.status,vf.change_type,vf.acceptance_criteria,i.biz_id,f.biz_id,vf.planning_item_id IS NULL,CASE WHEN original_version.id IS NOT NULL THEN original.id END,original_version.id,original_version.version_code`+from+where+` ORDER BY vf.sort_order,vf.id LIMIT ? OFFSET ?`, append(append([]any{code, code, code}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []ProductVersionScopeRecord{}
	for rows.Next() {
		var v ProductVersionScopeRecord
		if err = rows.Scan(&v.IsPublic, &v.ID, &v.VersionID, &v.Title, &v.Description, &v.Status, &v.ChangeType, &v.AcceptanceCriteria, &v.PlanningItemBizID, &v.ProductFeatureBizID, &v.LegacyUnscored, &v.DeferredFromScopeID, &v.DeferredFromVersionID, &v.DeferredFromVersionCode); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(out.Items) > 0 {
		placeholders := make([]string, len(out.Items))
		parameters := []any{code}
		indexes := map[int64]int{}
		for i := range out.Items {
			out.Items[i].Successors = []ProductVersionScopeSuccessor{}
			placeholders[i] = "?"
			parameters = append(parameters, out.Items[i].ID)
			indexes[out.Items[i].ID] = i
		}
		links, err := tx.QueryContext(ctx, `SELECT f.deferred_from_feature_id,f.id,v.id,v.version_code FROM product_version_features f JOIN product_versions v ON v.id=f.version_id AND BINARY v.product_code=BINARY ? WHERE f.deferred_from_feature_id IN (`+strings.Join(placeholders, ",")+`) ORDER BY f.deferred_from_feature_id,f.id LIMIT 1001`, parameters...)
		if err != nil {
			return out, err
		}
		count := 0
		for links.Next() {
			var sourceID int64
			var link ProductVersionScopeSuccessor
			if err = links.Scan(&sourceID, &link.ScopeID, &link.VersionID, &link.VersionCode); err != nil {
				links.Close()
				return out, err
			}
			count++
			if count > 1000 {
				links.Close()
				return out, invalid("product_version_scope_links_limit", "延期关系过多，请缩小分页范围")
			}
			index := indexes[sourceID]
			out.Items[index].Successors = append(out.Items[index].Successors, link)
		}
		err = links.Err()
		links.Close()
		if err != nil {
			return out, err
		}
	}
	out.Page, out.PageSize, out.VersionRevision, out.ScopeRevision, out.WorkspaceRevision = q.Page, q.PageSize, version.Revision, version.ScopeRevision, permit.Facts.Revision
	return out, tx.Commit()
}
