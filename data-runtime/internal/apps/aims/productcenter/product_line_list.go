package productcenter

import (
	"context"
	"database/sql"
)

type ProductLineGroup struct {
	LineCode              string  `json:"line_code"`
	Label                 string  `json:"label"`
	Total                 int     `json:"total"`
	ManagementProductCode *string `json:"management_product_code"`
	Status                *string `json:"status"`
	CanUnify              bool    `json:"can_unify"`
}

func listProductLineGroups(ctx context.Context, tx *sql.Tx, out ProductListPage, from string, args []any, canOnboard bool, generation uint64, input ProductListQuery) (ProductListPage, error) {
	groupExpr := `COALESCE(bl.line_code,l.line_code,c.product_line,'')`
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(DISTINCT `+groupExpr+`)`+from, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+groupExpr+` AS line_key,COALESCE(MAX(lc.label),MAX(bl.line_label),MAX(l.line_label),MAX(c.product_line_label),MAX(c.product_line),'未分类'),SUM(l.product_code IS NULL),MAX(COALESCE(bl.product_code,l.product_code)),MAX(CASE WHEN l.product_code IS NOT NULL THEN w.status ELSE owner.status END)`+from+` GROUP BY line_key ORDER BY MIN(COALESCE(c.product_line_sort_order,2147483647)),line_key LIMIT ? OFFSET ?`, append(append([]any{}, args...), input.PageSize, (input.Page-1)*input.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Groups = []ProductLineGroup{}
	for rows.Next() {
		var g ProductLineGroup
		if err = rows.Scan(&g.LineCode, &g.Label, &g.Total, &g.ManagementProductCode, &g.Status); err != nil {
			rows.Close()
			return out, err
		}
		if g.Label == "" {
			g.Label = "未分类"
		}
		out.Groups = append(out.Groups, g)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	// Whole-line eligibility never derives from a filtered/authorized child page.
	// Only a verified tenant-global onboarding actor receives this hint.
	if canOnboard {
		for i := range out.Groups {
			g := &out.Groups[i]
			if g.LineCode == "" || g.ManagementProductCode != nil {
				continue
			}
			var total, blocked int
			err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.product_code=c.product_code) OR EXISTS(SELECT 1 FROM product_component_sources b WHERE b.source_product_code=c.product_code)),0) FROM product_catalog_projection c WHERE c.generation=? AND c.product_line=?`, generation, g.LineCode).Scan(&total, &blocked)
			if err != nil {
				return out, err
			}
			var existing int
			if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_line_workspaces WHERE line_code=?`, g.LineCode).Scan(&existing); err != nil {
				return out, err
			}
			// Already-managed products stay independent; the line can still unify
			// the remaining ones, so only a fully managed line is ineligible.
			g.CanUnify = total > 0 && total <= 1000 && blocked < total && existing == 0
		}
	}
	return out, tx.Commit()
}
