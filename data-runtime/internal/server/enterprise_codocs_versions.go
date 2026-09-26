package server

import (
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Version history is exposed as three explicit user-domain operations. The
// transport remains POST (the normal Enterprise delegated envelope), while
// the owning Codocs adapter receives the declared GET/DELETE method.
// Runtime derives the actor from the verified permit and overwrites the
// compatibility actor query keys; browser-supplied actor fields are never
// trusted.
var enterpriseCodocsVersionSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_versions",
	Actions: map[string]enterpriseDelegatedAction{
		"versions": {
			Method: http.MethodGet, PermitAction: "read",
			CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/versions"
			},
		},
		"version-view": {
			Method: http.MethodGet, PermitAction: "read",
			CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			NeedsObject: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/versions/" + in.ObjectID
			},
		},
		"version-delete": {
			Method: http.MethodDelete, PermitAction: "edit",
			CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			NeedsObject: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/versions/" + in.ObjectID
			},
		},
	},
}

var enterpriseCodocsVersionRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsVersionSpec)

func enterpriseCodocsVersionQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsVersionSpec.Actions[action]
	if !ok || actor == "" {
		return nil, httperror.New(http.StatusBadRequest, "enterprise_codocs_versions_input_invalid", "Invalid document version input")
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsVersionSpec, act, actor)
	if err != nil {
		return nil, err
	}
	// No version action accepts caller-selected filters. In particular, do not
	// allow a caller to smuggle current_user/owner scope into the adapter.
	if len(input.Query) != 0 {
		return nil, httperror.New(http.StatusBadRequest, "enterprise_codocs_versions_input_invalid", "Version query parameters are not supported")
	}
	// The owning Codocs adapter rejects current_user without this marker. Only
	// this verified Enterprise delegation may set it after replacing the actor.
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
