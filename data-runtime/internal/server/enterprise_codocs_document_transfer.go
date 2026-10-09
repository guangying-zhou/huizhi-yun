package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDocumentTransferSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "document-transfer", ErrorCode: "enterprise_codocs_document_transfer",
	Actions: map[string]enterpriseDelegatedAction{
		"department": {Method: http.MethodPost, PermitAction: "department", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/dept-shares" }},
		"project": {Method: http.MethodPost, PermitAction: "project", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string {
			return "/v1/codocs/documents/" + in.Code + "/project-transfer"
		}},
	},
}

var enterpriseCodocsDocumentTransferRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDocumentTransferSpec)

func enterpriseCodocsDocumentTransferQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsDocumentTransferSpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_document_transfer_input_invalid", "Invalid document transfer")
	if !ok || actor == "" || len(input.Payload) == 0 {
		return nil, invalid
	}
	allowed := map[string]map[string]bool{
		"department": {"dept_code": true, "message": true},
		"project":    {"project_code": true, "source_oss_path": true, "new_oss_path": true},
	}[action]
	for key, raw := range input.Payload {
		if !allowed[key] {
			return nil, invalid
		}
		value, ok := raw.(string)
		if !ok || len(value) > 500 || strings.ContainsAny(value, "\x00\r\n") {
			return nil, invalid
		}
	}
	required := []string{"dept_code"}
	if action == "project" {
		required = []string{"project_code", "source_oss_path", "new_oss_path"}
	}
	for _, key := range required {
		value, ok := input.Payload[key].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil, invalid
		}
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsDocumentTransferSpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
