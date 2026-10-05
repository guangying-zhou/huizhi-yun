package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsFolderSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-folders", ErrorCode: "enterprise_codocs_folders",
	Actions: map[string]enterpriseDelegatedAction{
		"create": {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders" }},
		"view":   {Method: http.MethodGet, PermitAction: "read", NeedsObject: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID }},
		"update": {Method: http.MethodPatch, PermitAction: "edit", NeedsObject: true, AllowPayload: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID }},
		"delete": {Method: http.MethodDelete, PermitAction: "delete", NeedsObject: true, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/folders/" + in.ObjectID }},
	},
}

var enterpriseCodocsFolderRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsFolderSpec)

func enterpriseCodocsFolderQuery(input enterpriseDelegatedInput, action string, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsFolderSpec.Actions[action]
	invalid := httperror.New(400, "enterprise_codocs_folders_input_invalid", "Invalid folder input")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsFolderSpec, act, actor)
	if err != nil {
		return nil, err
	}
	if action == "update" || action == "create" {
		if len(input.Payload) == 0 {
			return nil, invalid
		}
		for key, value := range input.Payload {
			switch key {
			case "folder_type":
				if action != "create" || (value != "private" && value != "slide") {
					return nil, invalid
				}
			case "name":
				name, ok := value.(string)
				if !ok || strings.TrimSpace(name) == "" || len([]rune(name)) > 100 {
					return nil, invalid
				}
			case "parent_id":
				if value != nil {
					id, ok := value.(float64)
					if !ok || id < 1 || id > 9007199254740991 || id != float64(int64(id)) {
						return nil, invalid
					}
				}
			default:
				return nil, invalid
			}
		}
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
