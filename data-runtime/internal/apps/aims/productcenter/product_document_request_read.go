package productcenter

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type ProductDocumentRequestDetail struct {
	ProductCode       string `json:"product_code"`
	WorkspaceRevision uint64 `json:"workspace_revision"`
	BizID             string `json:"biz_id"`
	DocumentUUID      string `json:"document_uuid"`
	Purpose           string `json:"purpose"`
	OperationKey      string `json:"operation_key"`
	Status            string `json:"status"`
	RelationBizID     string `json:"relation_biz_id"`
}

// Internal only: the BFF must check Codocs ACL before exposing document identity.
// Requires edit because the result drives creation recovery and linking.
func ReadProductDocumentRequest(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (ProductDocumentRequestDetail, error) {
	out := ProductDocumentRequestDetail{ProductCode: code}
	parsed, err := uuid.Parse(bizID)
	if err != nil || parsed == uuid.Nil || parsed.String() != bizID {
		return out, invalid("product_document_request_invalid", "文档创建请求身份无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_documents", "edit", permit); err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	err = tx.QueryRowContext(ctx, `SELECT r.biz_id,r.document_uuid,r.purpose,o.operation_key,o.status,COALESCE(r.relation_biz_id,'') FROM product_document_creation_requests r JOIN integration_operation o ON o.operation_id=r.operation_id AND o.source_app='aims' AND o.target_app='codocs' AND o.operation_code='aims.codocs.product-document.create.v1' AND o.source_biz_type='product_document_request' AND o.source_biz_code=r.biz_id WHERE r.product_code=? AND r.biz_id=?`, code, bizID).Scan(&out.BizID, &out.DocumentUUID, &out.Purpose, &out.OperationKey, &out.Status, &out.RelationBizID)
	if err == sql.ErrNoRows {
		return out, invalid("product_document_not_found", "文档创建请求不存在")
	}
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
