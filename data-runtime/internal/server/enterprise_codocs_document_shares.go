package server

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDocumentShareCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:/[1-9][0-9]{0,18})?$`)

var enterpriseCodocsDocumentShareSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "document-shares", ErrorCode: "enterprise_codocs_document_shares",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentShareCode, Target: documentShareTarget(false)},
		"mark-read": {Method: http.MethodPost, PermitAction: "mark-read", CodePattern: enterpriseCodocsDocumentShareCode, Target: func(in enterpriseDelegatedInput) string {
			return "/v1/codocs/documents/" + in.Code + "/read"
		}},
		"create": {Method: http.MethodPost, PermitAction: "create", CodePattern: enterpriseCodocsDocumentShareCode, AllowPayload: true, Target: documentShareTarget(false)},
		"update": {Method: http.MethodPatch, PermitAction: "edit", CodePattern: enterpriseCodocsDocumentShareCode, AllowPayload: true, Target: documentShareTarget(true)},
		"delete": {Method: http.MethodDelete, PermitAction: "delete", CodePattern: enterpriseCodocsDocumentShareCode, AllowPayload: true, Target: documentShareTarget(true)},
	},
}

var enterpriseCodocsDocumentShareRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDocumentShareSpec)

func documentShareTarget(nested bool) func(enterpriseDelegatedInput) string {
	return func(in enterpriseDelegatedInput) string {
		parts := strings.Split(in.Code, "/")
		path := "/v1/codocs/documents/" + parts[0] + "/shares"
		if nested {
			path += "/" + parts[1]
		}
		return path
	}
}

func enterpriseCodocsDocumentShareQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsDocumentShareSpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_document_shares_input_invalid", "Invalid document share input")
	parts := strings.Split(input.Code, "/")
	if !ok || actor == "" || len(parts) != map[bool]int{true: 2, false: 1}[action == "update" || action == "delete"] {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsDocumentShareSpec, act, actor)
	if err != nil {
		return nil, err
	}
	if action == "list" || action == "mark-read" {
		if len(input.Payload) != 0 {
			return nil, invalid
		}
	} else {
		for key, value := range input.Payload {
			switch action {
			case "create":
				if key != "sharedToUid" && key != "permission" && key != "message" {
					return nil, invalid
				}
			case "update":
				if key != "permission" {
					return nil, invalid
				}
			case "delete":
				return nil, invalid
			}
			if text, ok := value.(string); ok && (len([]rune(text)) > 500 || strings.ContainsAny(text, "\x00\r\n") && key != "message") {
				return nil, invalid
			}
		}
		if action == "create" {
			target, targetOK := input.Payload["sharedToUid"].(string)
			permission, permissionOK := input.Payload["permission"].(string)
			if !targetOK || strings.TrimSpace(target) == "" || len([]rune(target)) > 64 || !permissionOK || (permission != "read" && permission != "write") {
				return nil, invalid
			}
		}
		if action == "update" {
			permission, permissionOK := input.Payload["permission"].(string)
			if !permissionOK || (permission != "read" && permission != "write") || len(input.Payload) != 1 {
				return nil, invalid
			}
		}
		input.Payload["actorUid"] = actor
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
