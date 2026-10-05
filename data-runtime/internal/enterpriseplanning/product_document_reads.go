package enterpriseplanning

import (
	"context"
	"database/sql"
	"net/http"

	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Product document relations are read from the Aims domain. The caller must
// separately apply Codocs ACL before exposing a document UUID or body.
func (s *PlanningService) ListProductDocuments(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, q pc.ProductDocumentQuery) (pc.ProductDocumentPage, error) {
	out := pc.ProductDocumentPage{ProductCode: code, Items: []pc.ProductDocumentRecord{}, Page: q.Page, PageSize: q.PageSize}
	if q.Page < 1 || q.Page > 100000 || q.PageSize < 1 || q.PageSize > 100 {
		return out, httperror.New(http.StatusBadRequest, "product_document_page_invalid", "Invalid product document page")
	}
	value, err := s.read(ctx, func(tx *sql.Tx) (any, error) {
		if err := pc.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "view", permit); err != nil {
			return nil, err
		}
		out.WorkspaceRevision = permit.Facts.Revision
		where := ` FROM product_documents WHERE product_code=? AND (removed_at IS NOT NULL)=?`
		args := []any{code, q.Removed}
		if q.Purpose != "" {
			where += ` AND purpose=?`
			args = append(args, q.Purpose)
		}
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
			return nil, err
		}
		rows, err := tx.QueryContext(ctx, `SELECT biz_id,product_code,document_uuid,purpose,revision,removed_at IS NOT NULL`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var item pc.ProductDocumentRecord
			if err := rows.Scan(&item.BizID, &item.ProductCode, &item.DocumentUUID, &item.Purpose, &item.Revision, &item.Removed); err != nil {
				return nil, err
			}
			out.Items = append(out.Items, item)
		}
		return out, rows.Err()
	})
	if err != nil {
		return out, err
	}
	return value.(pc.ProductDocumentPage), nil
}

func (s *PlanningService) ReadProductDocument(ctx context.Context, code, uid, bizID string, permit pc.AuthorizationPermit) (pc.ProductDocumentDetail, error) {
	out := pc.ProductDocumentDetail{ProductCode: code}
	value, err := s.read(ctx, func(tx *sql.Tx) (any, error) {
		if err := pc.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "view", permit); err != nil {
			return nil, err
		}
		out.WorkspaceRevision = permit.Facts.Revision
		row := &out.Item
		err := tx.QueryRowContext(ctx, `SELECT biz_id,product_code,document_uuid,purpose,revision,removed_at IS NOT NULL FROM product_documents WHERE product_code=? AND biz_id=?`, code, bizID).Scan(&row.BizID, &row.ProductCode, &row.DocumentUUID, &row.Purpose, &row.Revision, &row.Removed)
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "product_document_not_found", "Product document relation not found")
		}
		return out, err
	})
	if err != nil {
		return out, err
	}
	return value.(pc.ProductDocumentDetail), nil
}

// Creation request status contains no document UUID or title. MVP viewers can
// inspect it, while request creation and resume remain on the edit contract.
func (s *PlanningService) ListProductDocumentRequests(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, page, pageSize int) (pc.ProductDocumentRequestPage, error) {
	out := pc.ProductDocumentRequestPage{ProductCode: code, Items: []pc.ProductDocumentRequestSummary{}, Page: page, PageSize: pageSize}
	if page < 1 || page > 100000 || pageSize < 1 || pageSize > 100 {
		return out, httperror.New(http.StatusBadRequest, "product_document_page_invalid", "Invalid product document page")
	}
	value, err := s.read(ctx, func(tx *sql.Tx) (any, error) {
		if err := pc.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "view", permit); err != nil {
			return nil, err
		}
		out.WorkspaceRevision = permit.Facts.Revision
		from := s.feedbackSource.Context(s.writer, "").SQL(` FROM product_document_creation_requests r JOIN integration_operation o ON o.operation_id=r.operation_id AND o.source_app='aims' AND o.target_app='codocs' AND o.operation_code='aims.codocs.product-document.create.v1' AND o.source_biz_type='product_document_request' AND o.source_biz_code=r.biz_id WHERE r.product_code=?`)
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+from, code).Scan(&out.Total); err != nil {
			return nil, err
		}
		rows, err := tx.QueryContext(ctx, `SELECT r.biz_id,r.purpose,o.status,r.relation_biz_id IS NOT NULL`+from+` ORDER BY r.id DESC LIMIT ? OFFSET ?`, code, pageSize, (page-1)*pageSize)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var item pc.ProductDocumentRequestSummary
			if err := rows.Scan(&item.BizID, &item.Purpose, &item.Status, &item.Linked); err != nil {
				return nil, err
			}
			out.Items = append(out.Items, item)
		}
		return out, rows.Err()
	})
	if err != nil {
		return out, err
	}
	return value.(pc.ProductDocumentRequestPage), nil
}
