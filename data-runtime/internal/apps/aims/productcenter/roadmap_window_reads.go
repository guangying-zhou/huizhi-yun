package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningRoadmapWindowView struct {
	BizID             string  `json:"biz_id"`
	ProductCode       string  `json:"product_code"`
	Title             string  `json:"title"`
	Lifecycle         string  `json:"lifecycle"`
	StartsOn          *string `json:"starts_on"`
	EndsOn            *string `json:"ends_on"`
	Revision          uint64  `json:"revision"`
	WorkspaceRevision uint64  `json:"workspace_revision"`
}

func ReadPlanningRoadmapWindow(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (PlanningRoadmapWindowView, error) {
	var out PlanningRoadmapWindowView
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID {
		return out, invalid("product_roadmap_window_invalid", "事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	if err = tx.QueryRowContext(ctx, `SELECT biz_id,product_code,title,lifecycle,DATE_FORMAT(roadmap_starts_on,'%Y-%m-%d'),DATE_FORMAT(roadmap_ends_on,'%Y-%m-%d'),revision FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ?`, bizID, code).Scan(&out.BizID, &out.ProductCode, &out.Title, &out.Lifecycle, &out.StartsOn, &out.EndsOn, &out.Revision); err != nil {
		return out, err
	}
	return out, tx.Commit()
}
