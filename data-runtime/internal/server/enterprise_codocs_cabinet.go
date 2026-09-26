package server

import (
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"net/http"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsCabinetSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-cabinet", ErrorCode: "enterprise_codocs_cabinet",
	Actions: map[string]enterpriseDelegatedAction{
		"conversion-plan": {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code + "/conversion-plan" }},
		"convert":         {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code + "/to-document" }},
		"upload-plan":     {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/upload-plan" }},
		"upload":          {Method: http.MethodPost, PermitAction: "create", AllowPayload: true, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/upload" }},
		"delete":          {Method: http.MethodDelete, PermitAction: "delete", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code }},
		"list":            {Method: http.MethodGet, PermitAction: "read", QueryKeys: []string{"page", "pageSize", "folder_id"}, Target: func(enterpriseDelegatedInput) string { return "/v1/codocs/cabinet" }},
		"view":            {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code }},
		"download":        {Method: http.MethodGet, PermitAction: "export", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code }},
		"converted-info":  {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/cabinet/" + in.Code + "/converted-info" }},
	},
}

var enterpriseCodocsCabinetRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsCabinetSpec)

func enterpriseCodocsCabinetQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsCabinetSpec.Actions[action]
	invalid := httperror.New(400, "invalid_personal_cabinet_read", "Invalid personal cabinet read")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsCabinetSpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	if action == "conversion-plan" || action == "convert" {
		if err := codocsapp.ValidatePersonalCabinetConversion(input.Payload, action == "convert"); err != nil {
			return nil, err
		}
	}
	if action == "upload-plan" || action == "upload" {
		if err := codocsapp.ValidatePersonalCabinetUpload(input.Payload); err != nil {
			return nil, err
		}
	}
	if action == "list" {
		for key, fallback := range map[string]int{"page": 1, "pageSize": 20} {
			value := fallback
			if raw := query.Get(key); raw != "" {
				value, err = strconv.Atoi(raw)
				if err != nil || value < 1 || (key == "pageSize" && value > 200) || (key == "page" && value > 1000000) {
					return nil, invalid
				}
			}
			query.Set(key, strconv.Itoa(value))
		}
		if folder := query.Get("folder_id"); folder != "" && folder != "null" {
			id, err := strconv.ParseInt(folder, 10, 64)
			if err != nil || id < 1 || id > 9007199254740991 || strconv.FormatInt(id, 10) != folder {
				return nil, invalid
			}
		}
	}
	return query, nil
}
