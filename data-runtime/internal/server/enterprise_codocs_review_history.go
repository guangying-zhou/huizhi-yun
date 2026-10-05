package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsReviewHistorySpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "review-history", ErrorCode: "enterprise_codocs_review_history",
	Actions: map[string]enterpriseDelegatedAction{
		"by-document":         {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/reviews/by-document/" + in.Code }},
		"by-oss-path":         {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"path"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/reviews/by-oss-path" }},
		"company-by-oss-path": {Method: http.MethodGet, PermitAction: "company-read", QueryKeys: []string{"path"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/reviews/by-oss-path" }},
	},
}

var enterpriseCodocsReviewHistoryRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsReviewHistorySpec)

func enterpriseCodocsReviewHistoryQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsReviewHistorySpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_review_history_input_invalid", "Invalid review history input")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsReviewHistorySpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	if action == "by-document" {
		return query, nil
	}
	path := strings.TrimSpace(query.Get("path"))
	if path == "" || len([]rune(path)) > 1024 || strings.ContainsAny(path, "\x00\r\n") || strings.HasPrefix(path, "/") {
		return nil, invalid
	}
	company := strings.HasPrefix(path, "codocs/company/")
	if company != (action == "company-by-oss-path") {
		return nil, invalid
	}
	if company {
		query.Set("codocs_trusted_company_publish_history", "1")
		query.Set("hzy_runtime_source_app", "codocs")
	}
	return query, nil
}
