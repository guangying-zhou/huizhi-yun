package codocs

import (
	"context"
	uuidpkg "github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

const assetsProductDocumentReadOperation = "assets.codocs.product-document.read.v1"

const aimsProductDocumentReadCapability = "codocs:product-document:read"
const aimsProductDocumentReadOperation = "aims.codocs.product-document.read.v1"
const aimsProductDocumentReadSchema = "aims.codocs.product-document.read.v1"
const aimsProductDocumentContentOperation = "aims.codocs.product-document.content-read.v1"

// The runtime transport verifies the signed envelope; enforce its exact
// capability again before reading any document metadata.
func (a *Adapter) productDocumentServiceMetadata(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	document, err := a.authorizeProductDocumentService(ctx, uuid, query, body, aimsProductDocumentReadOperation, "metadata:read")
	if err != nil {
		return nil, err
	}
	return map[string]any{"uuid": strings.TrimSpace(firstTextValue(document, "uuid")), "title": strings.TrimSpace(firstTextValue(document, "title")), "doc_type": strings.TrimSpace(firstTextValue(document, "doc_type")), "updated_at": strings.TrimSpace(firstTextValue(document, "updated_at"))}, nil
}

// Content grants are internal to Codocs. The service BFF must consume ossPath
// and must never forward storage locations to the caller or browser.
func (a *Adapter) productDocumentServiceContent(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	document, err := a.authorizeProductDocumentService(ctx, uuid, query, body, aimsProductDocumentContentOperation, "content:read")
	if err != nil {
		return nil, err
	}
	path := strings.TrimSpace(firstTextValue(document, "oss_path"))
	if path == "" {
		return nil, httperror.New(http.StatusNotFound, "product_document_content_missing", "product document content is unavailable")
	}
	return map[string]any{"uuid": strings.TrimSpace(firstTextValue(document, "uuid")), "title": strings.TrimSpace(firstTextValue(document, "title")), "docType": strings.TrimSpace(firstTextValue(document, "doc_type")), "updatedAt": strings.TrimSpace(firstTextValue(document, "updated_at")), "contentSize": int64Value(document["content_size"]), "ossPath": path}, nil
}

func (a *Adapter) authorizeProductDocumentService(ctx context.Context, uuid string, query url.Values, body map[string]any, operation, action string) (map[string]any, error) {
	allowed := false
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == aimsProductDocumentReadCapability {
			allowed = true
		}
	}
	if !allowed {
		return nil, httperror.New(http.StatusForbidden, "insufficient_scope", "product document read capability required")
	}
	if err := validateProductDocumentPayload(body, uuid, action); err != nil {
		return nil, err
	}
	sourceApp := "aims"
	if operation == assetsProductDocumentReadOperation && action == "metadata:read" {
		sourceApp = "assets"
	}
	_, _, err := scopedDocumentServiceCommand(body, uuid, query, documentServiceContract{SourceApp: sourceApp, ContextField: "productCode", Capability: aimsProductDocumentReadCapability, Operation: operation, Schema: operation, Action: action})
	if err != nil {
		return nil, err
	}
	// Product context contributes no department or project grants.
	aclQuery := url.Values{"current_user": {query.Get("current_user")}}
	document, err := a.documentAccess(ctx, uuid, aclQuery)
	if err != nil {
		return nil, err
	}
	if int64Value(document["status"]) != 1 {
		return nil, httperror.New(http.StatusForbidden, "product_document_inactive", "document is not active")
	}
	return document, nil
}

// Strict product command payload; unknown fields cannot smuggle role/scope
// facts into the shared document authorization path.
func validateProductDocumentMetadataPayload(body map[string]any, documentUUID string) error {
	return validateProductDocumentPayload(body, documentUUID, "metadata:read")
}

func validateProductDocumentPayload(body map[string]any, documentUUID, action string) error {
	invalid := func() error {
		return httperror.New(http.StatusForbidden, "product_document_command_invalid", "product document command payload is invalid")
	}
	envelope, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return invalid()
	}
	command, ok := envelope["command"].(map[string]any)
	if !ok || len(command) != 4 {
		return invalid()
	}
	for _, key := range []string{"actorUid", "productCode", "documentUuid", "action"} {
		value, ok := command[key].(string)
		if !ok || value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || strings.ContainsFunc(value, unicode.IsControl) {
			return invalid()
		}
	}
	product := command["productCode"].(string)
	actor := command["actorUid"].(string)
	id := command["documentUuid"].(string)
	parsed, err := uuidpkg.Parse(id)
	if utf8.RuneCountInString(actor) > 64 || utf8.RuneCountInString(product) > 64 || strings.Contains(product, "/") || err != nil || parsed == uuidpkg.Nil || parsed.String() != id || id != documentUUID || command["action"] != action {
		return invalid()
	}
	return nil
}

// Assets uses a separate signed operation and source identity. It gains no ACL
// from product ownership; the same current-user Codocs document ACL is applied.
func (a *Adapter) assetsProductDocumentMetadata(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	document, err := a.authorizeProductDocumentService(ctx, uuid, query, body, assetsProductDocumentReadOperation, "metadata:read")
	if err != nil {
		return nil, err
	}
	return map[string]any{"uuid": strings.TrimSpace(firstTextValue(document, "uuid")), "title": strings.TrimSpace(firstTextValue(document, "title")), "doc_type": strings.TrimSpace(firstTextValue(document, "doc_type")), "updated_at": strings.TrimSpace(firstTextValue(document, "updated_at"))}, nil
}
