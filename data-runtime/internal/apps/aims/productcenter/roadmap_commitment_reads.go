package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RoadmapCommitmentRecord struct {
	ID               int64           `json:"id"`
	BizID            string          `json:"biz_id"`
	CycleID          int64           `json:"cycle_id"`
	ItemRevision     uint64          `json:"item_revision"`
	ScopeRevision    uint64          `json:"scope_revision"`
	EvidenceRevision uint64          `json:"evidence_revision"`
	CycleRevision    uint64          `json:"cycle_revision"`
	QueueRevision    uint64          `json:"queue_revision"`
	StartsOn         string          `json:"starts_on"`
	EndsOn           string          `json:"ends_on"`
	ItemSnapshot     json.RawMessage `json:"item_snapshot"`
	DecisionSnapshot json.RawMessage `json:"decision_snapshot"`
	ModelSnapshot    json.RawMessage `json:"model_snapshot"`
	Reason           string          `json:"reason"`
	CreatedBy        string          `json:"created_by"`
	CreatedAt        string          `json:"created_at"`
	ReviewReasons    []string        `json:"review_reasons"`
	RequiresReview   bool            `json:"requires_review"`
}
type RoadmapCommitmentPage struct {
	Items             []RoadmapCommitmentRecord `json:"items"`
	Total             int                       `json:"total"`
	Page              int                       `json:"page"`
	PageSize          int                       `json:"pageSize"`
	ItemBizID         string                    `json:"item_biz_id"`
	LatestID          int64                     `json:"latest_id"`
	WorkspaceRevision uint64                    `json:"workspace_revision"`
	ItemRevision      uint64                    `json:"item_revision"`
}

func ListRoadmapCommitments(ctx context.Context, db *sql.DB, code, uid, bizID string, roadmapPermit, planningPermit AuthorizationPermit, page, pageSize int) (RoadmapCommitmentPage, error) {
	out := RoadmapCommitmentPage{Items: []RoadmapCommitmentRecord{}, Page: page, PageSize: pageSize, ItemBizID: bizID}
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID {
		return out, invalid("product_roadmap_commitment_invalid", "事项标识无效")
	}
	if err = ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	var itemID int64
	if err = tx.QueryRowContext(ctx, `SELECT id,revision FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ?`, bizID, code).Scan(&itemID, &out.ItemRevision); err != nil {
		return out, err
	}
	where := ` FROM product_roadmap_commitments WHERE planning_item_id=? AND BINARY product_code=BINARY ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MAX(id),0)`+where, itemID, code).Scan(&out.Total, &out.LatestID); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,biz_id,cycle_id,item_revision,scope_revision,evidence_revision,cycle_revision,queue_revision,DATE_FORMAT(starts_on,'%Y-%m-%d'),DATE_FORMAT(ends_on,'%Y-%m-%d'),item_snapshot,decision_snapshot,model_snapshot,reason,created_by,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ')`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, itemID, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var record RoadmapCommitmentRecord
		if err = rows.Scan(&record.ID, &record.BizID, &record.CycleID, &record.ItemRevision, &record.ScopeRevision, &record.EvidenceRevision, &record.CycleRevision, &record.QueueRevision, &record.StartsOn, &record.EndsOn, &record.ItemSnapshot, &record.DecisionSnapshot, &record.ModelSnapshot, &record.Reason, &record.CreatedBy, &record.CreatedAt); err != nil {
			return out, err
		}
		var saved PlanningItemDetail
		if err = json.Unmarshal(record.ItemSnapshot, &saved); err != nil {
			return out, err
		}
		if saved.ID != itemID || saved.BizID != bizID || saved.ProductCode != code || saved.Revision != record.ItemRevision || saved.ScopeRevision != record.ScopeRevision || saved.EvidenceRevision != record.EvidenceRevision {
			return out, invalid("product_roadmap_commitment_snapshot_invalid", "承诺快照身份或修订不一致")
		}
		out.Items = append(out.Items, record)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	for i := range out.Items {
		reasons, e := roadmapCommitmentReview(ctx, tx, code, itemID, out.Items[i])
		if e != nil {
			return out, e
		}
		out.Items[i].ReviewReasons = reasons
		out.Items[i].RequiresReview = len(reasons) > 0
	}
	return out, tx.Commit()
}
