package server

import (
	"net/http"
	"net/url"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsCreationSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_creation",
	Actions: map[string]enterpriseDelegatedAction{
		"create": {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/documents" }},
	},
}
var enterpriseCodocsCreationRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsCreationSpec)

func enterpriseCodocsCreationQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsCreationSpec.Actions[action]
	if !ok || actor == "" {
		return nil, httperror.New(400, "invalid_document_creation", "Invalid document creation")
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsCreationSpec, act, actor)
	if err != nil {
		return nil, err
	}
	if err := codocsapp.ValidatePersonalDocumentCreation(input.Payload); err != nil {
		return nil, err
	}
	return query, nil
}
