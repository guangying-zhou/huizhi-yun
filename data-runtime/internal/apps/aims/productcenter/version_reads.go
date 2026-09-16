package productcenter

import (
	"context"
	"database/sql"
)

type ProductVersionRecord struct {
	PlanningMode           string  `json:"planning_mode"`
	BusinessOwnerUID       *string `json:"business_owner_uid,omitempty"`
	ID                     int64   `json:"id"`
	ProductCode            string  `json:"product_code"`
	VersionCode            string  `json:"version_code"`
	Name                   *string `json:"name"`
	Description            *string `json:"description"`
	Status                 string  `json:"status"`
	PlannedReleaseDate     *string `json:"planned_release_date"`
	OwnerProjectID         *int64  `json:"owner_project_id"`
	Revision               uint64  `json:"revision"`
	ScopeRevision          uint64  `json:"scope_revision"`
	CurrentReleaseRecordID *int64  `json:"current_release_record_id"`
}
type ProductVersionPageQuery struct {
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Keyword  string `json:"keyword"`
	Status   string `json:"status"`
}
type ProductVersionPage struct {
	Items             []ProductVersionRecord `json:"items"`
	Total             int                    `json:"total"`
	Page              int                    `json:"page"`
	PageSize          int                    `json:"pageSize"`
	WorkspaceRevision uint64                 `json:"workspace_revision"`
}

func ValidateProductVersionPageQuery(q ProductVersionPageQuery) error {
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize, Keyword: q.Keyword}); err != nil {
		return err
	}
	switch q.Status {
	case "", "planning", "developing", "released", "archived":
		return nil
	}
	return invalid("product_version_status_invalid", "版本状态筛选无效")
}
func ListProductCenterVersions(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q ProductVersionPageQuery) (ProductVersionPage, error) {
	var out ProductVersionPage
	if err := ValidateProductVersionPageQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	where := ` FROM product_versions WHERE BINARY product_code=?`
	args := []any{code}
	if q.Status != "" {
		where += ` AND status=?`
		args = append(args, q.Status)
	}
	if q.Keyword != "" {
		where += ` AND (LOCATE(?,version_code)>0 OR LOCATE(?,COALESCE(name,''))>0)`
		args = append(args, q.Keyword, q.Keyword)
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,product_code,version_code,name,description,status,DATE_FORMAT(planned_release_date,'%Y-%m-%d'),owner_project_id,revision,scope_revision,current_release_record_id,business_owner_uid,planning_mode`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []ProductVersionRecord{}
	for rows.Next() {
		var item ProductVersionRecord
		if err = rows.Scan(&item.ID, &item.ProductCode, &item.VersionCode, &item.Name, &item.Description, &item.Status, &item.PlannedReleaseDate, &item.OwnerProjectID, &item.Revision, &item.ScopeRevision, &item.CurrentReleaseRecordID, &item.BusinessOwnerUID, &item.PlanningMode); err != nil {
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
