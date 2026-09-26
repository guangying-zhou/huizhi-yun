package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsCollaborationSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "collab-documents", ErrorCode: "enterprise_codocs_collaboration",
	Actions: map[string]enterpriseDelegatedAction{
		"list":       {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"category", "scope", "keyword", "dept_code", "owner_uid"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/collab-docs" }},
		"list-admin": {Method: http.MethodGet, PermitAction: "review-admin", QueryKeys: []string{"category", "scope", "keyword", "dept_code", "owner_uid"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/collab-docs" }},
	},
}

var enterpriseCodocsCollaborationRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsCollaborationSpec)

func enterpriseCodocsCollaborationQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsCollaborationSpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_collaboration_input_invalid", "Invalid collaboration query")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsCollaborationSpec, act, actor)
	if err != nil {
		return nil, err
	}
	switch query.Get("category") {
	case "shared", "original", "outside":
	default:
		return nil, invalid
	}
	switch query.Get("scope") {
	case "all", "todo", "initiated", "participated", "done":
	default:
		return nil, invalid
	}
	for _, key := range []string{"keyword", "dept_code", "owner_uid"} {
		if strings.ContainsAny(query.Get(key), "\x00\r\n") {
			return nil, invalid
		}
	}
	if action == "list-admin" {
		query.Set("codocs_trusted_review_execution_admin", "1")
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
