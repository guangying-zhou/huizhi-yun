package server

import (
	"net/http"
	"net/url"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsRestoreSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_restore",
	Actions: map[string]enterpriseDelegatedAction{
		"restore-plan": {Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/restore-plan" }},
		"restore":      {Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/restore" }},
	},
}
var enterpriseCodocsRestoreRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsRestoreSpec)

func enterpriseCodocsRestoreQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsRestoreSpec.Actions[action]
	if !ok || actor == "" {
		return nil, httperror.New(400, "invalid_document_restore", "Invalid document restore")
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsRestoreSpec, act, actor)
	if err != nil {
		return nil, err
	}
	if err := codocsapp.ValidatePersonalDocumentRestore(input.Payload, action == "restore"); err != nil {
		return nil, err
	}
	return query, nil
}
