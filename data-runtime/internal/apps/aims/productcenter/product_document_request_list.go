package productcenter

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ProductDocumentRequestSummary struct {
	BizID   string `json:"biz_id"`
	Purpose string `json:"purpose"`
	Status  string `json:"status"`
	Linked  bool   `json:"linked"`
}
type ProductDocumentRequestPage struct {
	ProductCode       string                          `json:"product_code"`
	WorkspaceRevision uint64                          `json:"workspace_revision"`
	Items             []ProductDocumentRequestSummary `json:"items"`
	Total             int                             `json:"total"`
	Page              int                             `json:"page"`
	PageSize          int                             `json:"pageSize"`
}

// Lists Aims request facts only; document metadata, UUIDs and operation details
// are intentionally absent. Opening or linking still requires current Codocs ACL.
func ListProductDocumentRequests(ctx context.Context, db *sql.DB, outbox integrationoperation.TrustedContext, code, uid string, permit AuthorizationPermit, q PlanningPageQuery) (ProductDocumentRequestPage, error) {
	out := ProductDocumentRequestPage{ProductCode: code, Items: []ProductDocumentRequestSummary{}, Page: q.Page, PageSize: q.PageSize}
	if err := ValidatePlanningPageQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "edit", permit); err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	from := outbox.SQL(` FROM product_document_creation_requests r JOIN integration_operation o ON o.operation_id=r.operation_id AND o.source_app='aims' AND o.target_app='codocs' AND o.operation_code='aims.codocs.product-document.create.v1' AND o.source_biz_type='product_document_request' AND o.source_biz_code=r.biz_id WHERE r.product_code=?`)
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+from, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT r.biz_id,r.purpose,o.status,r.relation_biz_id IS NOT NULL`+from+` ORDER BY r.id DESC LIMIT ? OFFSET ?`, code, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductDocumentRequestSummary
		if err = rows.Scan(&item.BizID, &item.Purpose, &item.Status, &item.Linked); err != nil {
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
