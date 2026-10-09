package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"

	"github.com/google/uuid"
)

type RoadmapCrossSnapshot struct {
	DependencyBizID        string          `json:"dependency_biz_id"`
	DependencyRevision     uint64          `json:"dependency_revision"`
	PredecessorProductCode string          `json:"predecessor_product_code"`
	PredecessorBizID       string          `json:"predecessor_biz_id"`
	PredecessorRevision    uint64          `json:"predecessor_revision"`
	Snapshot               json.RawMessage `json:"snapshot"`
}
type RoadmapCrossSnapshotPage struct {
	Items             []RoadmapCrossSnapshot `json:"items"`
	Total             int                    `json:"total"`
	Page              int                    `json:"page"`
	PageSize          int                    `json:"pageSize"`
	CommitmentBizID   string                 `json:"commitment_biz_id"`
	ItemBizID         string                 `json:"item_biz_id"`
	ProductCode       string                 `json:"product_code"`
	WorkspaceRevision uint64                 `json:"workspace_revision"`
}

func ListRoadmapCrossSnapshots(ctx context.Context, db *sql.DB, source, uid, commitmentBizID string, roadmapPermit, planningPermit AuthorizationPermit, targets map[string]AuthorizationPermit, page, pageSize int) (RoadmapCrossSnapshotPage, error) {
	out := RoadmapCrossSnapshotPage{Items: []RoadmapCrossSnapshot{}, Page: page, PageSize: pageSize, CommitmentBizID: commitmentBizID, ProductCode: source}
	id, err := uuid.Parse(commitmentBizID)
	if err != nil || id.String() != commitmentBizID || len(targets) > 100 {
		return out, invalid("product_roadmap_commitment_invalid", "承诺或可见前置范围无效")
	}
	if err = ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	// Use the established multi-product lock order; immutable snapshot rows need
	// no edge lookup and remain readable after removal of the live dependency.
	if _, err = lockProductDependencyGraph(ctx, tx); err != nil {
		return out, err
	}
	codes := []string{source}
	for code := range targets {
		if code == "" || code == source {
			return out, invalid("product_roadmap_commitment_invalid", "前置范围无效")
		}
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		permit := targets[code]
		if code == source {
			if err = AuthorizeWorkspaceTransaction(ctx, tx, source, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
				return out, err
			}
			permit = planningPermit
		}
		if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
			return out, err
		}
	}
	var commitmentID int64
	if err = tx.QueryRowContext(ctx, `SELECT b.id,i.biz_id FROM product_roadmap_commitments b JOIN product_planning_items i ON i.id=b.planning_item_id AND i.product_code=b.product_code WHERE b.biz_id=? AND BINARY b.product_code=BINARY ?`, commitmentBizID, source).Scan(&commitmentID, &out.ItemBizID); err != nil {
		return out, err
	}
	out.WorkspaceRevision = roadmapPermit.Facts.Revision
	if len(targets) == 0 {
		return out, tx.Commit()
	}
	args := []any{commitmentID}
	marks := []string{}
	for _, code := range codes {
		if code != source {
			args = append(args, code)
			marks = append(marks, "?")
		}
	}
	where := ` FROM product_roadmap_cross_dependency_snapshots WHERE commitment_id=? AND predecessor_product_code IN (` + strings.Join(marks, ",") + `)`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT dependency_biz_id,dependency_revision,predecessor_product_code,predecessor_biz_id,predecessor_revision,snapshot`+where+` ORDER BY id LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var row RoadmapCrossSnapshot
		if err = rows.Scan(&row.DependencyBizID, &row.DependencyRevision, &row.PredecessorProductCode, &row.PredecessorBizID, &row.PredecessorRevision, &row.Snapshot); err != nil {
			return out, err
		}
		var frozen struct {
			ProductCode        string `json:"product_code"`
			BizID              string `json:"biz_id"`
			Revision           uint64 `json:"revision"`
			DependencyBizID    string `json:"dependency_biz_id"`
			DependencyRevision uint64 `json:"dependency_revision"`
		}
		if err = json.Unmarshal(row.Snapshot, &frozen); err != nil {
			return out, err
		}
		if frozen.ProductCode != row.PredecessorProductCode || frozen.BizID != row.PredecessorBizID || frozen.Revision != row.PredecessorRevision || frozen.DependencyBizID != row.DependencyBizID || frozen.DependencyRevision != row.DependencyRevision {
			return out, invalid("product_roadmap_commitment_invalid", "前置历史身份不一致")
		}
		out.Items = append(out.Items, row)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	return out, tx.Commit()
}
