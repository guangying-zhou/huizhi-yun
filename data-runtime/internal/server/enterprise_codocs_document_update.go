package server

import (
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDocumentUpdateSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_document_update",
	Actions: map[string]enterpriseDelegatedAction{
		"update-plan": {Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/update-plan" }},
		"update":      {Method: http.MethodPut, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code }},
	},
}

var enterpriseCodocsDocumentUpdateRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDocumentUpdateSpec)

func enterpriseCodocsDocumentUpdateQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsDocumentUpdateSpec.Actions[action]
	if !ok || actor == "" || len(input.Payload) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "enterprise_codocs_document_update_input_invalid", "Invalid document update")
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsDocumentUpdateSpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
