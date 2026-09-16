package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	aimsProjectDocumentContentCapability = "codocs:project-document:content:read"
	aimsProjectDocumentContentOperation  = "aims.codocs.project-document.content-read.v1"
	aimsProjectDocumentContentSchema     = "aims.codocs.project-document.content.v1"
)

// projectDocumentServiceCommand is intentionally limited to the fixed B
// command. Project/member/role facts remain at Aims; the only actor fact that
// reaches Codocs is the request-target HMAC-bound user actor.
func projectDocumentServiceCommand(body map[string]any, uuid string, query url.Values) (string, string, error) {
	return scopedDocumentServiceCommand(body, uuid, query, documentServiceContract{ContextField: "projectCode", Capability: aimsProjectDocumentContentCapability, Operation: aimsProjectDocumentContentOperation, Schema: aimsProjectDocumentContentSchema, Action: "content:read"})
}

type documentServiceContract struct{ ContextField, Capability, Operation, Schema, Action, SourceApp string }

func scopedDocumentServiceCommand(body map[string]any, uuid string, query url.Values, contract documentServiceContract) (string, string, error) {
	sourceApp := contract.SourceApp
	if sourceApp == "" {
		sourceApp = "aims"
	}

	serviceCommand, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return "", "", httperror.New(http.StatusForbidden, "project_document_service_command_required", "signed project document service command is required")
	}
	command, ok := serviceCommand["command"].(map[string]any)
	if !ok {
		return "", "", httperror.New(http.StatusForbidden, "project_document_service_command_invalid", "project document service command payload is invalid")
	}
	actorUID := strings.TrimSpace(firstTextValue(command, "actorUid"))
	projectCode := strings.TrimSpace(firstTextValue(command, contract.ContextField))
	invalid :=
		strings.TrimSpace(firstTextValue(serviceCommand, "targetApp")) != "codocs" ||
			strings.TrimSpace(firstTextValue(serviceCommand, "operationCode")) != contract.Operation ||
			strings.TrimSpace(firstTextValue(serviceCommand, "requiredCapability")) != contract.Capability ||
			strings.TrimSpace(firstTextValue(serviceCommand, "commandSchemaVersion")) != contract.Schema ||
			strings.TrimSpace(firstTextValue(command, "documentUuid")) != strings.TrimSpace(uuid) ||
			strings.TrimSpace(firstTextValue(command, "action")) != contract.Action ||
			actorUID == "" || projectCode == "" ||
			strings.TrimSpace(query.Get("current_user")) != actorUID ||
			query.Get("hzy_runtime_actor_delegated") != "1" ||
			strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != "service-command" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceAppKey)) != sourceApp ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetAppKey)) != "codocs" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceClientKey)) != sourceApp+".runtime" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTenantKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceDeploymentKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetDeploymentKey)) == ""
	if invalid {
		return "", "", httperror.New(http.StatusForbidden, "project_document_service_command_invalid", "project document service command binding is invalid")
	}
	return actorUID, projectCode, nil
}

// projectDocumentServiceContent first performs Codocs' ordinary document ACL
// (owner/share/current relation only). The signed Aims command owns the project
// mapping: a project may reference an existing private/department document, so
// the storage doc_type/project_code cannot be treated as the project boundary.
// Aims project membership is still never a substitute for the Codocs ACL.
func (a *Adapter) projectDocumentServiceContent(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	_, _, err := projectDocumentServiceCommand(body, uuid, query)
	if err != nil {
		return nil, err
	}
	document, err := a.documentAccess(ctx, uuid, query)
	if err != nil {
		return nil, err
	}
	if int64Value(document["status"]) != 1 {
		return nil, httperror.New(http.StatusForbidden, "project_document_scope_invalid", "document is not active")
	}
	ossPath := strings.TrimSpace(firstTextValue(document, "oss_path"))
	if ossPath == "" {
		return nil, httperror.New(http.StatusNotFound, "project_document_content_missing", "project document content is unavailable")
	}
	// ossPath is an internal BFF-to-runtime implementation value. The BFF drops
	// it and returns only the content DTO to the Aims caller.
	return map[string]any{
		"uuid":        strings.TrimSpace(firstTextValue(document, "uuid")),
		"title":       strings.TrimSpace(firstTextValue(document, "title")),
		"docType":     strings.TrimSpace(firstTextValue(document, "doc_type")),
		"contentSize": int64Value(document["content_size"]),
		"updatedAt":   strings.TrimSpace(firstTextValue(document, "updated_at")),
		"ossPath":     ossPath,
	}, nil
}
