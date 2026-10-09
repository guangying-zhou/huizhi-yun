package server

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

var enterpriseCodocsRecycleSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_recycle",
	Actions: map[string]enterpriseDelegatedAction{
		"recycle": {Method: http.MethodDelete, PermitAction: "delete", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code }},
	},
}
var enterpriseCodocsRecycleRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsRecycleSpec)

func enterpriseCodocsRecycleQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsRecycleSpec.Actions[action]
	if !ok || actor == "" {
		return nil, httperror.New(400, "invalid_document_recycle", "Invalid document recycle")
	}
	return enterpriseDelegatedQuery(input, enterpriseCodocsRecycleSpec, act, actor)
}
