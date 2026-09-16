package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type productDocumentCreationSnapshot struct {
	OperationID   string
	DocumentUUID  string
	Content       string
	ContentSHA256 string
	State         string
	PublishedPath string
}

// Internal persistence step, called only after current user create eligibility
// and template ACL/content read. It never publishes a document or uploads data.
func (a *Adapter) prepareProductDocumentCreation(ctx context.Context, body map[string]any, query url.Values, content string) (productDocumentCreationSnapshot, error) {
	command, err := parseProductDocumentCreateCommand(body, query)
	if err != nil {
		return productDocumentCreationSnapshot{}, err
	}
	if !utf8.ValidString(content) || len(content) > 4*1024*1024 {
		return productDocumentCreationSnapshot{}, httperror.New(http.StatusBadRequest, "product_template_content_invalid", "template content exceeds supported size or encoding")
	}
	receipt, _, err := integrationoperation.ReceiptCommandFromBody(body, "codocs", aimsProductDocumentCreateOperation, aimsProductDocumentCreateCapability)
	if err != nil {
		return productDocumentCreationSnapshot{}, codocsServiceCommandReceiptError(err)
	}
	identity := sha256.Sum256([]byte(strings.Join([]string{receipt.TrustedContext.TenantCode, receipt.SourceDeploymentCode, receipt.TargetDeploymentCode, receipt.TrustedContext.SourceApp, receipt.TargetApp, receipt.OperationCode, receipt.IdempotencyKey}, "|")))
	digest := sha256.Sum256([]byte(content))
	hash := hex.EncodeToString(digest[:])
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return productDocumentCreationSnapshot{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO product_document_creation(operation_id,identity_sha256,command_sha256,actor_uid,product_code,document_uuid,template_uuid,title,template_content,content_sha256,content_size) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE operation_id=operation_id`, receipt.OperationID, identity[:], receipt.CommandSHA256, command.ActorUID, command.ProductCode, command.DocumentUUID, command.TemplateUUID, command.Title, content, hash, len(content))
	if err != nil {
		return productDocumentCreationSnapshot{}, err
	}
	var storedIdentity []byte
	var publishedPath sql.NullString
	var storedCommand, actor, product, target, template, title string
	result := productDocumentCreationSnapshot{OperationID: receipt.OperationID}
	err = tx.QueryRowContext(ctx, `SELECT identity_sha256,command_sha256,actor_uid,product_code,document_uuid,template_uuid,title,template_content,content_sha256,state,published_oss_path FROM product_document_creation WHERE operation_id=? FOR UPDATE`, receipt.OperationID).Scan(&storedIdentity, &storedCommand, &actor, &product, &target, &template, &title, &result.Content, &result.ContentSHA256, &result.State, &publishedPath)
	conflict := func() (productDocumentCreationSnapshot, error) {
		return productDocumentCreationSnapshot{}, httperror.New(http.StatusConflict, "product_document_creation_conflict", "creation identity or command conflicts with existing preparation")
	}
	if err == sql.ErrNoRows {
		return conflict()
	}
	if err != nil {
		return productDocumentCreationSnapshot{}, err
	}
	if string(storedIdentity) != string(identity[:]) || storedCommand != receipt.CommandSHA256 || actor != command.ActorUID || product != command.ProductCode || target != command.DocumentUUID || template != command.TemplateUUID || title != command.Title {
		return conflict()
	}
	frozenHash := sha256.Sum256([]byte(result.Content))
	if result.ContentSHA256 != hex.EncodeToString(frozenHash[:]) || (result.State != "prepared" && result.State != "completed") {
		return productDocumentCreationSnapshot{}, httperror.New(http.StatusConflict, "product_document_creation_corrupt", "creation snapshot is inconsistent")
	}
	if (result.State == "completed" && (!publishedPath.Valid || publishedPath.String == "")) || (result.State == "prepared" && publishedPath.Valid) {
		return productDocumentCreationSnapshot{}, httperror.New(http.StatusConflict, "product_document_creation_corrupt", "creation completion path is inconsistent")
	}
	result.PublishedPath = publishedPath.String
	result.DocumentUUID = target
	if err = tx.Commit(); err != nil {
		return productDocumentCreationSnapshot{}, err
	}
	return result, nil
}
