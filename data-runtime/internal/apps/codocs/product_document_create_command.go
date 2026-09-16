package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	uuidpkg "github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const aimsProductDocumentCreateCapability = "codocs:product-document:create"
const aimsProductDocumentCreateOperation = "aims.codocs.product-document.create.v1"
const aimsProductDocumentCreateSchema = "product-document-create.v1"

type productDocumentCreateCommand struct {
	ActorUID     string
	ProductCode  string
	DocumentUUID string
	TemplateUUID string
	Title        string
}

// Only parses the trusted command boundary. A caller must still prove current
// user create eligibility and template ACL before preparing any persistent work.
func parseProductDocumentCreateCommand(body map[string]any, query url.Values) (productDocumentCreateCommand, error) {
	invalid := func() (productDocumentCreateCommand, error) {
		return productDocumentCreateCommand{}, httperror.New(http.StatusForbidden, "product_document_create_command_invalid", "product document create command is invalid")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == aimsProductDocumentCreateCapability {
			allowed = true
		}
	}
	if !allowed {
		return productDocumentCreateCommand{}, httperror.New(http.StatusForbidden, "insufficient_scope", "product document create capability required")
	}
	envelope, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return invalid()
	}
	command, ok := envelope["command"].(map[string]any)
	if !ok || len(command) != 6 {
		return invalid()
	}
	limits := map[string]int{"actorUid": 64, "productCode": 64, "documentUuid": 36, "templateUuid": 36, "title": 200, "action": 16}
	for key, limit := range limits {
		value, ok := command[key].(string)
		if !ok || value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) {
			return invalid()
		}
	}
	for _, key := range []string{"documentUuid", "templateUuid"} {
		value := command[key].(string)
		parsed, err := uuidpkg.Parse(value)
		if err != nil || parsed == uuidpkg.Nil || parsed.String() != value {
			return invalid()
		}
	}
	if command["action"] != "create" || strings.Contains(command["productCode"].(string), "/") || command["documentUuid"] == command["templateUuid"] {
		return invalid()
	}
	target := command["documentUuid"].(string)
	actor, product, err := scopedDocumentServiceCommand(body, target, query, documentServiceContract{ContextField: "productCode", Capability: aimsProductDocumentCreateCapability, Operation: aimsProductDocumentCreateOperation, Schema: aimsProductDocumentCreateSchema, Action: "create"})
	if err != nil {
		return productDocumentCreateCommand{}, err
	}
	if _, _, err := integrationoperation.ReceiptCommandFromBody(body, "codocs", aimsProductDocumentCreateOperation, aimsProductDocumentCreateCapability); err != nil {
		return productDocumentCreateCommand{}, codocsServiceCommandReceiptError(err)
	}
	return productDocumentCreateCommand{ActorUID: actor, ProductCode: product, DocumentUUID: target, TemplateUUID: command["templateUuid"].(string), Title: command["title"].(string)}, nil
}

// Reads only the template grant. This does not authorize document creation;
// current user create eligibility and durable operation preparation remain
// separate gates before any mutation or upload.
func (a *Adapter) readProductCreationTemplate(ctx context.Context, body map[string]any, query url.Values) (productDocumentCreateCommand, map[string]any, error) {
	command, err := parseProductDocumentCreateCommand(body, query)
	if err != nil {
		return productDocumentCreateCommand{}, nil, err
	}
	// Product context and caller-supplied department hints are never ACL grants.
	document, err := a.documentAccess(ctx, command.TemplateUUID, url.Values{"current_user": {command.ActorUID}})
	if err != nil {
		return productDocumentCreateCommand{}, nil, err
	}
	if int64Value(document["status"]) != 1 {
		return productDocumentCreateCommand{}, nil, httperror.New(http.StatusForbidden, "product_document_template_inactive", "template document is not active")
	}
	path := strings.TrimSpace(firstTextValue(document, "oss_path"))
	if path == "" {
		return productDocumentCreateCommand{}, nil, httperror.New(http.StatusNotFound, "product_document_template_content_missing", "template content is unavailable")
	}
	return command, map[string]any{"uuid": command.TemplateUUID, "docType": strings.TrimSpace(firstTextValue(document, "doc_type")), "ossPath": path}, nil
}
