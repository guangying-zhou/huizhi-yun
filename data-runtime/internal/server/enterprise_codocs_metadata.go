package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsMetadataSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_documents",
	Actions: map[string]enterpriseDelegatedAction{
		"edit-metadata": {
			Method: http.MethodPatch, PermitAction: "edit", AllowPayload: true,
			CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern,
			Target:      func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code },
		},
	},
}

var enterpriseCodocsMetadataRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsMetadataSpec)

// Metadata edits never accept storage paths or change document ownership/type.
// Folder moves retain the existing OSS object key. The owning adapter validates
// write ACL, readonly transitions, and destination folder scope before UPDATE.
func enterpriseCodocsMetadataQuery(input enterpriseDelegatedInput, action string, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsMetadataSpec.Actions[action]
	invalid := httperror.New(400, "enterprise_codocs_documents_input_invalid", "Invalid document metadata")
	if !ok || actor == "" || len(input.Payload) == 0 {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsMetadataSpec, act, actor)
	if err != nil {
		return nil, err
	}
	for key, value := range input.Payload {
		switch key {
		case "title":
			title, ok := value.(string)
			if !ok || strings.TrimSpace(title) == "" || len([]rune(title)) > 255 {
				return nil, invalid
			}
		case "star_flag", "home_flag", "readonly_flag":
			if value != float64(0) && value != float64(1) && value != false && value != true {
				return nil, invalid
			}
		case "folder_id":
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
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
