package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

type ProductObjectiveCycleRecord struct {
	ID                int64                  `json:"id"`
	BizID             string                 `json:"biz_id"`
	ProductCode       string                 `json:"product_code"`
	ObjectiveID       int64                  `json:"objective_id"`
	CycleID           int64                  `json:"cycle_id"`
	ObjectiveRevision uint64                 `json:"objective_revision"`
	CycleRevision     uint64                 `json:"cycle_revision"`
	ObjectiveSnapshot ProductObjectiveRecord `json:"objective_snapshot"`
	CycleSnapshot     PlanningCycleRecord    `json:"cycle_snapshot"`
	MappingNote       string                 `json:"mapping_note"`
	CreatedBy         string                 `json:"created_by"`
	CreatedAt         string                 `json:"created_at"`
	RevokedBy         *string                `json:"revoked_by"`
	RevokedAt         *string                `json:"revoked_at"`
	RevocationReason  *string                `json:"revocation_reason"`
}

type ProductObjectiveCyclePage struct {
	Items             []ProductObjectiveCycleRecord `json:"items"`
	Total             int                           `json:"total"`
	Page              int                           `json:"page"`
	PageSize          int                           `json:"pageSize"`
	ObjectiveID       int64                         `json:"objective_id"`
	ObjectiveRevision uint64                        `json:"objective_revision"`
	WorkspaceRevision uint64                        `json:"workspace_revision"`
}

func ListProductObjectiveCycles(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, objectiveID int64, page, pageSize int) (ProductObjectiveCyclePage, error) {
	out := ProductObjectiveCyclePage{Items: []ProductObjectiveCycleRecord{}, ObjectiveID: objectiveID, Page: page, PageSize: pageSize}
	if objectiveID < 1 || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_objective_cycle_list_invalid", "目标标识或分页无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_objectives", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	if err = tx.QueryRowContext(ctx, `SELECT revision FROM product_objectives WHERE id=? AND BINARY product_code=BINARY ?`, objectiveID, code).Scan(&out.ObjectiveRevision); err != nil {
		return out, err
	}
	where := ` FROM product_objective_cycles o WHERE o.objective_id=? AND BINARY o.product_code=BINARY ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, objectiveID, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT o.id,o.biz_id,o.product_code,o.objective_id,o.cycle_id,o.objective_revision,o.cycle_revision,o.objective_snapshot,o.cycle_snapshot,o.mapping_note,o.created_by,DATE_FORMAT(o.created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),o.revoked_by,DATE_FORMAT(o.revoked_at,'%Y-%m-%dT%H:%i:%s.%fZ'),o.revocation_reason`+where+` ORDER BY o.id DESC LIMIT ? OFFSET ?`, objectiveID, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductObjectiveCycleRecord
		var objectiveSnapshot, cycleSnapshot []byte
		if err = rows.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.ObjectiveID, &item.CycleID, &item.ObjectiveRevision, &item.CycleRevision, &objectiveSnapshot, &cycleSnapshot, &item.MappingNote, &item.CreatedBy, &item.CreatedAt, &item.RevokedBy, &item.RevokedAt, &item.RevocationReason); err != nil {
			rows.Close()
			return out, err
		}
		if err = json.Unmarshal(objectiveSnapshot, &item.ObjectiveSnapshot); err != nil {
			rows.Close()
			return out, err
		}
		if err = json.Unmarshal(cycleSnapshot, &item.CycleSnapshot); err != nil {
			rows.Close()
			return out, err
		}
		if item.ObjectiveSnapshot.ID != item.ObjectiveID || item.CycleSnapshot.ID != item.CycleID || item.ObjectiveSnapshot.ProductCode != code || item.CycleSnapshot.ProductCode != code || item.ObjectiveSnapshot.Revision != item.ObjectiveRevision || item.CycleSnapshot.Revision != item.CycleRevision {
			rows.Close()
			return out, fmt.Errorf("objective cycle mapping %d has inconsistent snapshots", item.ID)
		}

		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
