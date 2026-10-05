package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type ProductObjectiveObservationRecord struct {
	CorrectionOfID    *int64                 `json:"correction_of_id"`
	CorrectionReason  string                 `json:"correction_reason"`
	SupersededByID    *int64                 `json:"superseded_by_id"`
	ID                int64                  `json:"id"`
	BizID             string                 `json:"biz_id"`
	ObjectiveID       int64                  `json:"objective_id"`
	ProductCode       string                 `json:"product_code"`
	ObjectiveRevision uint64                 `json:"objective_revision"`
	MetricSnapshot    ProductObjectiveMetric `json:"metric_snapshot"`
	ObservedOn        string                 `json:"observed_on"`
	MeasuredValue     string                 `json:"measured_value"`
	AttainmentPercent *string                `json:"attainment_percent"`
	Evidence          string                 `json:"evidence"`
	Note              string                 `json:"note"`
	CreatedBy         string                 `json:"created_by"`
	CreatedAt         string                 `json:"created_at"`
}

type ProductObjectiveObservationPage struct {
	Items             []ProductObjectiveObservationRecord `json:"items"`
	Total             int                                 `json:"total"`
	Page              int                                 `json:"page"`
	PageSize          int                                 `json:"pageSize"`
	ObjectiveID       int64                               `json:"objective_id"`
	WorkspaceRevision uint64                              `json:"workspace_revision"`
}

func ListProductObjectiveObservations(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, objectiveID int64, page, pageSize int) (ProductObjectiveObservationPage, error) {
	out := ProductObjectiveObservationPage{Items: []ProductObjectiveObservationRecord{}, ObjectiveID: objectiveID, Page: page, PageSize: pageSize}
	if objectiveID < 1 || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_objective_observation_list_invalid", "目标标识或分页无效")
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
	var found int64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM product_objectives WHERE id=? AND BINARY product_code=BINARY ?`, objectiveID, code).Scan(&found); err != nil {
		return out, err
	}
	where := ` FROM product_objective_observations o WHERE o.objective_id=? AND BINARY o.product_code=BINARY ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, objectiveID, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT o.id,o.biz_id,o.objective_id,o.product_code,o.objective_revision,o.metric_snapshot,DATE_FORMAT(o.observed_on,'%Y-%m-%d'),o.measured_value,o.evidence,COALESCE(o.note,''),o.created_by,DATE_FORMAT(o.created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),o.correction_of_id,COALESCE(o.correction_reason,''),(SELECT c.id FROM product_objective_observations c WHERE c.correction_of_id=o.id AND c.objective_id=o.objective_id AND BINARY c.product_code=BINARY o.product_code)`+where+` ORDER BY observed_on DESC,id DESC LIMIT ? OFFSET ?`, objectiveID, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductObjectiveObservationRecord
		var snapshot []byte
		if err = rows.Scan(&item.ID, &item.BizID, &item.ObjectiveID, &item.ProductCode, &item.ObjectiveRevision, &snapshot, &item.ObservedOn, &item.MeasuredValue, &item.Evidence, &item.Note, &item.CreatedBy, &item.CreatedAt, &item.CorrectionOfID, &item.CorrectionReason, &item.SupersededByID); err != nil {
			rows.Close()
			return out, err
		}
		if err = json.Unmarshal(snapshot, &item.MetricSnapshot); err != nil {
			rows.Close()
			return out, err
		}
		item.AttainmentPercent, err = ProductObjectiveAttainment(item.MetricSnapshot, &item.MeasuredValue)
		if err != nil {
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
	return out, tx.Commit()
}
