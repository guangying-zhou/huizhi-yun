package server

import (
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// These routes are the narrow Enterprise bridge for the document-detail
// annotation panel. They deliberately target the existing Codocs annotation
// handlers; no generic Codocs proxy or caller-selected actor is exposed.
var enterpriseCodocsAnnotationsSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "document-annotations", ErrorCode: "enterprise_codocs_document_annotations",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/annotations" },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "create", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code + "/annotations" },
		},
		"update": {
			Method: http.MethodPatch, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			NeedsObject: true, Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/annotations/" + in.ObjectID
			},
		},
		"reply-create": {
			Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			NeedsObject: true, Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/annotations/" + in.ObjectID + "/replies"
			},
		},
		"reply-delete": {
			Method: http.MethodDelete, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			NeedsObject: true, NeedsSub: true, Target: func(in enterpriseDelegatedInput) string {
				return "/v1/codocs/documents/" + in.Code + "/annotations/" + in.ObjectID + "/replies/" + in.SubID
			},
		},
	},
}

var enterpriseCodocsAnnotationsRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsAnnotationsSpec)

func enterpriseCodocsAnnotationsQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsAnnotationsSpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_document_annotations_input_invalid", "Invalid document annotation input")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsAnnotationsSpec, act, actor)
	if err != nil {
		return nil, err
	}
	// A browser may never choose any identity field. The actor is inserted only
	// after the service credential and permit have been verified, and is used by
	// the existing annotation/write ACL checks.
	query.Set("hzy_runtime_actor_delegated", "1")

	allowed := map[string]map[string]bool{
		"list":         {},
		"create":       {"selected_text": true, "context_before": true, "context_after": true, "position_hint": true, "content": true, "mentioned_users": true},
		"update":       {"status": true},
		"reply-create": {"content": true, "mentioned_users": true},
		"reply-delete": {},
	}[action]
	if input.Payload == nil {
		input.Payload = map[string]any{}
	}
	for key := range input.Payload {
		if !allowed[key] {
			return nil, invalid
		}
	}
	if action == "create" {
		if stringValue(input.Payload["selected_text"]) == "" || stringValue(input.Payload["content"]) == "" {
			return nil, invalid
		}
	} else if action == "update" {
		status := stringValue(input.Payload["status"])
		if status != "open" && status != "resolved" && status != "deleted" {
			return nil, invalid
		}
	} else if action == "reply-create" && stringValue(input.Payload["content"]) == "" {
		return nil, invalid
	}
	return query, nil
}
