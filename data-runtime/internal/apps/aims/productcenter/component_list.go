package productcenter

import (
	"context"
	"database/sql"
)

type ProductComponentRecord struct {
	ID          int64  `json:"id"`
	BizID       string `json:"biz_id"`
	ProductCode string `json:"product_code"`
	ParentID    *int64 `json:"parent_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int32  `json:"sort_order"`
	Revision    uint64 `json:"revision"`
	ChildCount  int    `json:"child_count"`
}

type ProductComponentPage struct {
	Items             []ProductComponentRecord `json:"items"`
	Total             int                      `json:"total"`
	Page              int                      `json:"page"`
	PageSize          int                      `json:"pageSize"`
	ParentID          *int64                   `json:"parent_id"`
	WorkspaceRevision uint64                   `json:"workspace_revision"`
}

// A nil parent selects only root components. Children are loaded separately,
// so expanding a tree never silently truncates a product-wide flat result.
func ListProductComponents(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, parentID *int64, page, pageSize int) (ProductComponentPage, error) {
	out := ProductComponentPage{Items: []ProductComponentRecord{}, ParentID: parentID, Page: page, PageSize: pageSize}
	if (parentID != nil && *parentID < 1) || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_component_list_invalid", "模块父节点或分页无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	out, err = ListProductComponentsInTransaction(ctx, tx, code, uid, permit, parentID, page, pageSize)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// ListProductComponentsInTransaction retains parent ownership and paging checks
// inside the caller-owned transaction. It never commits or writes domain data.
func ListProductComponentsInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, parentID *int64, page, pageSize int) (ProductComponentPage, error) {
	out := ProductComponentPage{Items: []ProductComponentRecord{}, ParentID: parentID, Page: page, PageSize: pageSize}
	if (parentID != nil && *parentID < 1) || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_component_list_invalid", "模块父节点或分页无效")
	}
	if tx == nil {
		return out, invalid("product_command_configuration", "缺少产品读取事务")
	}
	var err error
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_components", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	if parentID != nil {
		var found int64
		if err = tx.QueryRowContext(ctx, `SELECT id FROM product_components WHERE id=? AND BINARY product_code=BINARY ?`, *parentID, code).Scan(&found); err != nil {
			return out, err
		}
	}
	where := ` FROM product_components c WHERE BINARY c.product_code=BINARY ? AND c.parent_id <=> ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, code, parentID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT c.id,c.biz_id,c.product_code,c.parent_id,c.name,COALESCE(c.description,''),c.sort_order,c.revision,(SELECT COUNT(*) FROM product_components child WHERE child.parent_id=c.id AND BINARY child.product_code=BINARY c.product_code)`+where+` ORDER BY c.sort_order,c.id LIMIT ? OFFSET ?`, code, parentID, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductComponentRecord
		if err = rows.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.ParentID, &item.Name, &item.Description, &item.SortOrder, &item.Revision, &item.ChildCount); err != nil {
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
	return out, nil
}
