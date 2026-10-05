package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"
)

type PlanningItemRecord struct {
	ID                 int64   `json:"id"`
	BizID              string  `json:"biz_id"`
	ProductCode        string  `json:"product_code"`
	Title              string  `json:"title"`
	ScopeSummary       string  `json:"scope_summary"`
	FeatureID          *int64  `json:"feature_id"`
	UrgencyLevel       string  `json:"urgency_level"`
	Deadline           *string `json:"deadline"`
	InvestmentCategory string  `json:"investment_category"`
	Lifecycle          string  `json:"lifecycle"`
	ScopeRevision      uint64  `json:"scope_revision"`
	EvidenceRevision   uint64  `json:"evidence_revision"`
	Revision           uint64  `json:"revision"`
}
type PlanningPageQuery struct {
	Page               int    `json:"page"`
	PageSize           int    `json:"page_size"`
	Keyword            string `json:"keyword"`
	Lifecycle          string `json:"lifecycle"`
	InvestmentCategory string `json:"investment_category"`
}
type PlanningPage struct {
	Items             []PlanningItemRecord `json:"items"`
	Total             int                  `json:"total"`
	Page              int                  `json:"page"`
	PageSize          int                  `json:"pageSize"`
	WorkspaceRevision uint64               `json:"workspace_revision"`
}

func ValidatePlanningPageQuery(q PlanningPageQuery) error {
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || !utf8.ValidString(q.Keyword) || utf8.RuneCountInString(q.Keyword) > 200 || strings.ContainsRune(q.Keyword, '\x00') {
		return invalid("product_planning_query_invalid", "规划分页或关键词无效")
	}
	switch q.Lifecycle {
	case "", "proposed", "in_delivery", "delivered", "cancelled", "merged":
	default:
		return invalid("product_planning_query_invalid", "规划状态无效")
	}
	switch q.InvestmentCategory {
	case "", "reliability", "usability", "growth":
	default:
		return invalid("product_planning_query_invalid", "投资类别无效")
	}
	return nil
}
func ListPlanningItems(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningPageQuery) (PlanningPage, error) {
	var out PlanningPage
	if err := ValidatePlanningPageQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	where := ` FROM product_planning_items WHERE product_code=? AND (?='' OR lifecycle=?) AND (?='' OR investment_category=?) AND (?='' OR LOCATE(?,title)>0 OR LOCATE(?,scope_summary)>0)`
	args := []any{code, q.Lifecycle, q.Lifecycle, q.InvestmentCategory, q.InvestmentCategory, q.Keyword, q.Keyword, q.Keyword}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,biz_id,product_code,title,scope_summary,feature_id,urgency_level,DATE_FORMAT(deadline,'%Y-%m-%d'),investment_category,lifecycle,scope_revision,evidence_revision,revision`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []PlanningItemRecord{}
	for rows.Next() {
		var item PlanningItemRecord
		if err := rows.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.Title, &item.ScopeSummary, &item.FeatureID, &item.UrgencyLevel, &item.Deadline, &item.InvestmentCategory, &item.Lifecycle, &item.ScopeRevision, &item.EvidenceRevision, &item.Revision); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Page, out.PageSize, out.WorkspaceRevision = q.Page, q.PageSize, permit.Facts.Revision
	return out, tx.Commit()
}
