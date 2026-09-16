package codocs

import (
	"context"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	altocEntityDocumentContentCapability = "codocs:altoc-entity-document:content:read"
	altocEntityDocumentContentOperation  = "altoc.codocs.entity-document.content-read.v1"
	altocEntityDocumentContentSchema     = "altoc.codocs.entity-document.content.v1"
	altocEntityDocumentAttachCapability  = "codocs:altoc-entity-document:attach"
	altocEntityDocumentAttachOperation   = "altoc.codocs.entity-document.attach-authorize.v1"
	altocEntityDocumentAttachSchema      = "altoc.codocs.entity-document.attach.v1"
)

func isAltocEntityDocumentType(value string) bool {
	switch strings.TrimSpace(value) {
	case "opportunity", "contract", "quotation", "customer", "lead", "tender":
		return true
	default:
		return false
	}
}

// altocEntityDocumentServiceCommand only accepts the two narrowly defined
// Altoc commands. The entity link and scoped entity authorization are proven
// by Altoc before the first hop; this runtime never treats either fact as a
// substitute for Codocs' own owner/share/relation ACL.
func altocEntityDocumentServiceCommand(body map[string]any, uuid, action, operation, capability, schema string, query url.Values) (string, error) {
	serviceCommand, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return "", httperror.New(403, "altoc_entity_document_service_command_required", "signed Altoc entity document command is required")
	}
	command, ok := serviceCommand["command"].(map[string]any)
	if !ok {
		return "", httperror.New(403, "altoc_entity_document_service_command_invalid", "Altoc entity document command payload is invalid")
	}
	actorUID := strings.TrimSpace(firstTextValue(command, "actorUid"))
	entityType := strings.TrimSpace(firstTextValue(command, "entityType"))
	entityID := int64Value(command["entityId"])
	invalid :=
		strings.TrimSpace(firstTextValue(serviceCommand, "targetApp")) != "codocs" ||
			strings.TrimSpace(firstTextValue(serviceCommand, "operationCode")) != operation ||
			strings.TrimSpace(firstTextValue(serviceCommand, "requiredCapability")) != capability ||
			strings.TrimSpace(firstTextValue(serviceCommand, "commandSchemaVersion")) != schema ||
			strings.TrimSpace(firstTextValue(command, "documentUuid")) != strings.TrimSpace(uuid) ||
			strings.TrimSpace(firstTextValue(command, "action")) != action ||
			actorUID == "" || !isAltocEntityDocumentType(entityType) || entityID <= 0 ||
			strings.TrimSpace(query.Get("current_user")) != actorUID ||
			query.Get("hzy_runtime_actor_delegated") != "1" ||
			strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != "service-command" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceAppKey)) != "altoc" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetAppKey)) != "codocs" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceClientKey)) != "altoc" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTenantKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceDeploymentKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetDeploymentKey)) == ""
	if invalid {
		return "", httperror.New(403, "altoc_entity_document_service_command_invalid", "Altoc entity document command binding is invalid")
	}
	return actorUID, nil
}

func (a *Adapter) altocEntityDocumentContent(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := altocEntityDocumentServiceCommand(body, uuid, "content:read", altocEntityDocumentContentOperation, altocEntityDocumentContentCapability, altocEntityDocumentContentSchema, query); err != nil {
		return nil, err
	}
	document, err := a.documentAccess(ctx, uuid, query)
	if err != nil {
		return nil, err
	}
	if int64Value(document["status"]) != 1 {
		return nil, httperror.New(403, "altoc_entity_document_scope_invalid", "document is not active")
	}
	ossPath := strings.TrimSpace(firstTextValue(document, "oss_path"))
	if ossPath == "" {
		return nil, httperror.New(404, "altoc_entity_document_content_missing", "document content is unavailable")
	}
	return map[string]any{
		"uuid":        strings.TrimSpace(firstTextValue(document, "uuid")),
		"title":       strings.TrimSpace(firstTextValue(document, "title")),
		"docType":     strings.TrimSpace(firstTextValue(document, "doc_type")),
		"contentSize": int64Value(document["content_size"]),
		"updatedAt":   strings.TrimSpace(firstTextValue(document, "updated_at")),
		"ossPath":     ossPath,
	}, nil
}

func (a *Adapter) altocEntityDocumentAttachAuthorize(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := altocEntityDocumentServiceCommand(body, uuid, "attach:authorize", altocEntityDocumentAttachOperation, altocEntityDocumentAttachCapability, altocEntityDocumentAttachSchema, query); err != nil {
		return nil, err
	}
	document, err := a.documentAccess(ctx, uuid, query)
	if err != nil {
		return nil, err
	}
	// documentAccess marks relation/read-only shares as readonly. Only the
	// owner or an explicit write share survives this intersection; neither an
	// Altoc entity role nor a document relation can authorize attachment.
	if int64Value(document["status"]) != 1 || boolValue(document["readonly"]) {
		return nil, httperror.New(403, "altoc_entity_document_attach_denied", "Codocs edit or write-share permission is required")
	}
	return map[string]any{
		"uuid":    strings.TrimSpace(firstTextValue(document, "uuid")),
		"title":   strings.TrimSpace(firstTextValue(document, "title")),
		"docType": strings.TrimSpace(firstTextValue(document, "doc_type")),
	}, nil
}
