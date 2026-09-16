package productcenter

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type RoadmapSavedViewRecord struct {
	BizID       string                     `json:"biz_id"`
	ProductCode string                     `json:"product_code"`
	OwnerUID    string                     `json:"owner_uid"`
	Definition  RoadmapSavedViewDefinition `json:"definition"`
	Revision    uint64                     `json:"revision"`
}

type RoadmapSavedViewPage struct {
	Items             []RoadmapSavedViewRecord `json:"items"`
	Total             int                      `json:"total"`
	Page              int                      `json:"page"`
	PageSize          int                      `json:"pageSize"`
	ProductCode       string                   `json:"product_code"`
	WorkspaceRevision uint64                   `json:"workspace_revision"`
}

func ListRoadmapSavedViews(ctx context.Context, db *sql.DB, code, uid string, planningPermit, roadmapPermit AuthorizationPermit, page, pageSize int) (RoadmapSavedViewPage, error) {
	var out RoadmapSavedViewPage
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	where := ` FROM product_roadmap_saved_views v JOIN product_planning_cycles c ON c.id=v.cycle_id AND c.product_code=v.product_code WHERE v.deleted_at IS NULL AND v.product_code=? AND (v.visibility='product' OR v.owner_uid=?)`
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+where, code, uid).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT v.biz_id,v.product_code,v.owner_uid,v.title,v.audience,v.visibility,c.biz_id,v.roadmap_year,v.roadmap_quarter,v.unscheduled,v.revision`+where+` ORDER BY v.id DESC LIMIT ? OFFSET ?`, code, uid, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	out.Items = []RoadmapSavedViewRecord{}
	for rows.Next() {
		var item RoadmapSavedViewRecord
		view := &item.Definition
		if err = rows.Scan(&item.BizID, &item.ProductCode, &item.OwnerUID, &view.Title, &view.Audience, &view.Visibility, &view.CycleBizID, &view.Year, &view.Quarter, &view.Unscheduled, &item.Revision); err != nil {
			rows.Close()
			return RoadmapSavedViewPage{}, err
		}
		if err = ValidateRoadmapSavedViewDefinition(*view); err != nil {
			rows.Close()
			return RoadmapSavedViewPage{}, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return RoadmapSavedViewPage{}, err
	}
	out.Page, out.PageSize, out.ProductCode, out.WorkspaceRevision = page, pageSize, code, root.Revision
	return out, tx.Commit()
}

type RoadmapSavedViewDetail struct {
	RoadmapSavedViewRecord
	WorkspaceRevision uint64 `json:"workspace_revision"`
}

func ReadRoadmapSavedView(ctx context.Context, db *sql.DB, code, uid, bizID string, planningPermit, roadmapPermit AuthorizationPermit) (RoadmapSavedViewDetail, error) {
	var out RoadmapSavedViewDetail
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID {
		return out, invalid("roadmap_saved_view_invalid", "视图标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	out.RoadmapSavedViewRecord, err = loadRoadmapSavedView(ctx, tx, code, uid, bizID)
	if err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	return out, tx.Commit()
}

// Caller holds current workspace authorization. Invisible and absent definitions
// use the same no-row result; creator permissions are never reused.
func loadRoadmapSavedView(ctx context.Context, tx *sql.Tx, code, uid, bizID string) (RoadmapSavedViewRecord, error) {
	var out RoadmapSavedViewRecord
	view := &out.Definition
	err := tx.QueryRowContext(ctx, `SELECT v.biz_id,v.product_code,v.owner_uid,v.title,v.audience,v.visibility,c.biz_id,v.roadmap_year,v.roadmap_quarter,v.unscheduled,v.revision FROM product_roadmap_saved_views v JOIN product_planning_cycles c ON c.id=v.cycle_id AND c.product_code=v.product_code WHERE v.deleted_at IS NULL AND v.product_code=? AND v.biz_id=? AND (v.visibility='product' OR v.owner_uid=?)`, code, bizID, uid).Scan(&out.BizID, &out.ProductCode, &out.OwnerUID, &view.Title, &view.Audience, &view.Visibility, &view.CycleBizID, &view.Year, &view.Quarter, &view.Unscheduled, &out.Revision)
	if err != nil {
		return out, err
	}
	return out, ValidateRoadmapSavedViewDefinition(*view)
}

type AppliedRoadmapSavedView struct {
	View    RoadmapSavedViewRecord `json:"view"`
	Roadmap QuarterRoadmapView     `json:"roadmap"`
}

func ApplyRoadmapSavedView(ctx context.Context, db *sql.DB, code, uid, bizID string, planningPermit, roadmapPermit AuthorizationPermit, page, pageSize int) (AppliedRoadmapSavedView, error) {
	var out AppliedRoadmapSavedView
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID {
		return out, invalid("roadmap_saved_view_invalid", "视图标识无效")
	}
	if err = ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	out.View, err = loadRoadmapSavedView(ctx, tx, code, uid, bizID)
	if err != nil {
		return out, err
	}
	out.Roadmap, err = loadQuarterRoadmap(ctx, tx, code, planningPermit.Facts.Revision, out.View.Definition.Query(page, pageSize))
	if err != nil {
		return AppliedRoadmapSavedView{}, err
	}
	return out, tx.Commit()
}
