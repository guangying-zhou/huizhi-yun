package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type PriorityModelRecord struct {
	BizID         string          `json:"biz_id"`
	ProductCode   string          `json:"product_code"`
	Version       string          `json:"version"`
	Title         string          `json:"title"`
	Method        string          `json:"method"`
	Configuration json.RawMessage `json:"configuration"`
	Reason        string          `json:"reason"`
	CreatedBy     string          `json:"created_by"`
	CreatedAt     string          `json:"created_at"`
}
type PriorityModelPage struct {
	Items             []PriorityModelRecord `json:"items"`
	Total             int                   `json:"total"`
	Page              int                   `json:"page"`
	PageSize          int                   `json:"pageSize"`
	ProductCode       string                `json:"product_code"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
	Builtin           map[string]any        `json:"builtin"`
}

// The built-in model is a separate default option, not a fabricated database row.
func ListPriorityModels(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, page, pageSize int) (PriorityModelPage, error) {
	out := PriorityModelPage{Items: []PriorityModelRecord{}, Page: page, PageSize: pageSize, ProductCode: code}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	out.Builtin = planningCycleModelSnapshot()
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_priority_model_versions WHERE BINARY product_code=BINARY ?`, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT biz_id,product_code,version,title,method,configuration,reason,created_by,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? ORDER BY id DESC LIMIT ? OFFSET ?`, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var row PriorityModelRecord
		if err = rows.Scan(&row.BizID, &row.ProductCode, &row.Version, &row.Title, &row.Method, &row.Configuration, &row.Reason, &row.CreatedBy, &row.CreatedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, row)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	return out, tx.Commit()
}
