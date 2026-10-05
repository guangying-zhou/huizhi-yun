package productcenter

import (
	"context"
	"database/sql"
)

type ProductObjectiveRecord struct {
	ID          int64                  `json:"id"`
	BizID       string                 `json:"biz_id"`
	ProductCode string                 `json:"product_code"`
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	StartsOn    string                 `json:"starts_on"`
	EndsOn      string                 `json:"ends_on"`
	OwnerUID    string                 `json:"owner_uid"`
	Metric      ProductObjectiveMetric `json:"metric"`
	Status      string                 `json:"status"`
	Revision    uint64                 `json:"revision"`
}

type ProductObjectivePage struct {
	Items             []ProductObjectiveRecord `json:"items"`
	Total             int                      `json:"total"`
	Page              int                      `json:"page"`
	PageSize          int                      `json:"pageSize"`
	WorkspaceRevision uint64                   `json:"workspace_revision"`
}

type ProductObjectiveDetail struct {
	Objective         ProductObjectiveRecord `json:"objective"`
	WorkspaceRevision uint64                 `json:"workspace_revision"`
}

const objectiveColumns = `id,biz_id,product_code,title,COALESCE(description,''),DATE_FORMAT(starts_on,'%Y-%m-%d'),DATE_FORMAT(ends_on,'%Y-%m-%d'),owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,status,revision`

func scanProductObjective(row interface{ Scan(...any) error }) (ProductObjectiveRecord, error) {
	var item ProductObjectiveRecord
	err := row.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.Title, &item.Description, &item.StartsOn, &item.EndsOn, &item.OwnerUID, &item.Metric.Name, &item.Metric.Unit, &item.Metric.MeasurementDefinition, &item.Metric.Direction, &item.Metric.BaselineValue, &item.Metric.TargetValue, &item.Status, &item.Revision)
	return item, err
}

func ListProductObjectives(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, status string, page, pageSize int) (ProductObjectivePage, error) {
	out := ProductObjectivePage{Items: []ProductObjectiveRecord{}, Page: page, PageSize: pageSize}
	if page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_objective_list_invalid", "目标分页无效")
	}
	switch status {
	case "", "draft", "active", "closed", "archived":
	default:
		return out, invalid("product_objective_list_invalid", "目标状态无效")
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
	where := ` FROM product_objectives WHERE BINARY product_code=BINARY ?`
	args := []any{code}
	if status != "" {
		where += ` AND status=?`
		args = append(args, status)
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := tx.QueryContext(ctx, `SELECT `+objectiveColumns+where+` ORDER BY starts_on DESC,id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		item, e := scanProductObjective(rows)
		if e != nil {
			rows.Close()
			return out, e
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

func GetProductObjective(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, id int64) (ProductObjectiveDetail, error) {
	var out ProductObjectiveDetail
	if id < 1 {
		return out, invalid("product_objective_id_invalid", "目标标识无效")
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
	out.Objective, err = scanProductObjective(tx.QueryRowContext(ctx, `SELECT `+objectiveColumns+` FROM product_objectives WHERE BINARY product_code=BINARY ? AND id=?`, code, id))
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
