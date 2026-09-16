package codocs

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// These internal steps are called by the authenticated Codocs creation BFF,
// after it checks the signed user's current documents:create eligibility.
// Snapshot/upload fields are Codocs-owned transport data, never browser input.
func (a *Adapter) productDocumentCreationRuntime(ctx context.Context, stage string, query url.Values, body map[string]any) (any, error) {
	// Capability and signed actor are checked before any storage access.
	if _, err := parseProductDocumentCreateCommand(body, query); err != nil {
		return nil, err
	}
	if stage == "template" {
		_, grant, err := a.readProductCreationTemplate(ctx, body, query)
		return grant, err
	}
	// Recheck template ACL on each persistent step, including receipt replay.
	if _, _, err := a.readProductCreationTemplate(ctx, body, query); err != nil {
		return nil, err
	}
	switch stage {
	case "prepare":
		content, ok := body["templateContent"].(string)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "product_template_content_required", "template content is required")
		}
		snapshot, err := a.prepareProductDocumentCreation(ctx, body, query, content)
		if err != nil {
			return nil, err
		}
		return map[string]any{"operationId": snapshot.OperationID, "documentUuid": snapshot.DocumentUUID, "content": snapshot.Content, "contentSha256": snapshot.ContentSHA256, "state": snapshot.State, "publishedPath": snapshot.PublishedPath}, nil
	case "complete":
		path, pathOK := body["uploadedPath"].(string)
		hash, hashOK := body["uploadedHash"].(string)
		if !pathOK || !hashOK {
			return nil, httperror.New(http.StatusBadRequest, "product_creation_upload_required", "verified upload evidence is required")
		}
		receipt, err := a.completeProductDocumentCreation(ctx, body, query, path, hash)
		if err != nil {
			return nil, err
		}
		input, _, err := integrationoperation.ReceiptCommandFromBody(body, "codocs", aimsProductDocumentCreateOperation, aimsProductDocumentCreateCapability)
		if err != nil {
			return nil, err
		}
		return map[string]any{"operationId": input.OperationID, "operationCode": input.OperationCode, "idempotencyKey": input.IdempotencyKey, "commandSchemaVersion": input.CommandSchemaVersion, "commandSha256": input.CommandSHA256, "receiptId": receipt.ReceiptID, "receiptStatus": "succeeded", "idempotent": receipt.Existing, "targetBizType": receipt.TargetBizType, "targetBizCode": receipt.TargetBizCode, "responseSummarySha256": receipt.ResponseSummarySHA256, "result": receipt.Value}, nil
	default:
		return nil, httperror.New(http.StatusNotFound, "not_found", "unknown creation stage")
	}
}
