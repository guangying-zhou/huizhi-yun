package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type ProductDocumentRecord struct {
	BizID        string `json:"biz_id"`
	ProductCode  string `json:"product_code"`
	DocumentUUID string `json:"document_uuid"`
	Purpose      string `json:"purpose"`
	Revision     uint64 `json:"revision"`
	Removed      bool   `json:"removed"`
}
type ProductDocumentQuery struct {
	Purpose  string `json:"purpose"`
	Removed  bool   `json:"removed"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}
type ProductDocumentPage struct {
	ProductCode       string                  `json:"product_code"`
	WorkspaceRevision uint64                  `json:"workspace_revision"`
	Items             []ProductDocumentRecord `json:"items"`
	Total             int                     `json:"total"`
	Page              int                     `json:"page"`
	PageSize          int                     `json:"pageSize"`
}

// Internal candidate pagination, not Codocs-visible browser pagination. The
// caller must check current Codocs ACL before exposing UUID or metadata.
func ListProductDocuments(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q ProductDocumentQuery) (ProductDocumentPage, error) {
	out := ProductDocumentPage{ProductCode: code, Items: []ProductDocumentRecord{}, Page: q.Page, PageSize: q.PageSize}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	if q.Purpose != "" {
		if err := validateProductDocumentPurpose(q.Purpose); err != nil {
			return out, err
		}
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "view", permit); err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	where := ` FROM product_documents WHERE product_code=? AND (removed_at IS NOT NULL)=?`
	args := []any{code, q.Removed}
	if q.Purpose != "" {
		where += ` AND purpose=?`
		args = append(args, q.Purpose)
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows, err := tx.QueryContext(ctx, `SELECT biz_id,product_code,document_uuid,purpose,revision,removed_at IS NOT NULL`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductDocumentRecord
		if err = rows.Scan(&item.BizID, &item.ProductCode, &item.DocumentUUID, &item.Purpose, &item.Revision, &item.Removed); err != nil {
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

type ProductDocumentDetail struct {
	ProductCode       string                `json:"product_code"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
	Item              ProductDocumentRecord `json:"item"`
}

// Internal relation detail, including removed relations. Codocs ACL is checked
// separately before browser exposure or restoring a relation.
func ReadProductDocument(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (ProductDocumentDetail, error) {
	out := ProductDocumentDetail{ProductCode: code}
	parsed, err := uuid.Parse(bizID)
	if err != nil || parsed == uuid.Nil || parsed.String() != bizID {
		return out, invalid("product_document_input_invalid", "文档关系身份无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "view", permit); err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	row := &out.Item
	err = tx.QueryRowContext(ctx, `SELECT biz_id,product_code,document_uuid,purpose,revision,removed_at IS NOT NULL FROM product_documents WHERE product_code=? AND biz_id=?`, code, bizID).Scan(&row.BizID, &row.ProductCode, &row.DocumentUUID, &row.Purpose, &row.Revision, &row.Removed)
	if err == sql.ErrNoRows {
		return out, invalid("product_document_not_found", "文档关系不存在")
	}
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
