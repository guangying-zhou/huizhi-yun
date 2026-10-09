package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	uuidpkg "github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The Codocs BFF must verify current create eligibility, template ACL, and
// successful upload of the frozen snapshot before invoking this internal step.
// Upload attempts use distinct objects; a receipt replay performs no upload.
func (a *Adapter) completeProductDocumentCreation(ctx context.Context, body map[string]any, query url.Values, uploadedPath, uploadedHash string) (integrationoperation.ReceiptExecutionResult, error) {
	command, err := parseProductDocumentCreateCommand(body, query)
	if err != nil {
		return integrationoperation.ReceiptExecutionResult{}, err
	}
	input, _, err := integrationoperation.ReceiptCommandFromBody(body, "codocs", aimsProductDocumentCreateOperation, aimsProductDocumentCreateCapability)
	if err != nil {
		return integrationoperation.ReceiptExecutionResult{}, err
	}
	prefix := "product-creations/" + input.OperationID + "/"
	attempt := strings.TrimSuffix(strings.TrimPrefix(uploadedPath, prefix), ".md")
	parsed, parseErr := uuidpkg.Parse(attempt)
	if !strings.HasPrefix(uploadedPath, prefix) || !strings.HasSuffix(uploadedPath, ".md") || parseErr != nil || parsed == uuidpkg.Nil || parsed.String() != attempt {
		return integrationoperation.ReceiptExecutionResult{}, httperror.New(http.StatusBadRequest, "product_creation_upload_invalid", "upload identity does not match creation")
	}
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return integrationoperation.ReceiptExecutionResult{}, err
	}
	input.OriginalActorUID = command.ActorUID
	return repository.Execute(ctx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		return a.completeProductDocumentCreationTx(ctx, tx, input, command, uploadedPath, uploadedHash)
	})
}

func (a *Adapter) completeProductDocumentCreationTx(ctx context.Context, tx *sql.Tx, input integrationoperation.ReceiptCommandInput, command productDocumentCreateCommand, path, hash string) (integrationoperation.ReceiptBusinessResult, error) {
	var identity []byte
	var commandHash, actor, product, target, template, title, content, contentHash, state string
	err := tx.QueryRowContext(ctx, `SELECT identity_sha256,command_sha256,actor_uid,product_code,document_uuid,template_uuid,title,template_content,content_sha256,state FROM product_document_creation WHERE operation_id=? FOR UPDATE`, input.OperationID).Scan(&identity, &commandHash, &actor, &product, &target, &template, &title, &content, &contentHash, &state)
	if err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	expectedIdentity := sha256.Sum256([]byte(strings.Join([]string{input.TrustedContext.TenantCode, input.SourceDeploymentCode, input.TargetDeploymentCode, input.TrustedContext.SourceApp, input.TargetApp, input.OperationCode, input.IdempotencyKey}, "|")))
	digest := sha256.Sum256([]byte(content))
	if string(identity) != string(expectedIdentity[:]) || commandHash != input.CommandSHA256 || actor != command.ActorUID || product != command.ProductCode || target != command.DocumentUUID || template != command.TemplateUUID || title != command.Title || contentHash != hash || contentHash != hex.EncodeToString(digest[:]) || state != "prepared" {
		return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "product_creation_completion_conflict", "prepared snapshot does not match completion")
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,content_size,status) VALUES(?,?,'product',?,?,?,1)`, target, title, path, actor, len(content))
	if err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	if err = upsertDocumentRelationTx(ctx, tx, documentRelationInput{DocumentID: id, DocumentUUID: target, RelatedUID: actor, RelationType: "created_by_me", SourceType: "document", SourceID: strconv.FormatInt(id, 10), CanRead: true, CanEdit: true, Metadata: map[string]any{"docType": "product", "sourceApp": "aims", "productCode": product}}); err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE product_document_creation SET state='completed',published_oss_path=?,completed_at=UTC_TIMESTAMP(3) WHERE operation_id=? AND state='prepared'`, path, input.OperationID); err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_document", TargetBizCode: target, HTTPStatus: http.StatusOK, Value: map[string]any{"uuid": target, "title": title, "productCode": product}}, nil
}
