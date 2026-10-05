package server

import (
	"net/http"
	"net/url"
	"regexp"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsAccessRecordSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "document-access-records", ErrorCode: "enterprise_codocs_access_records",
	Actions: map[string]enterpriseDelegatedAction{
		"record": {Method: http.MethodPost, PermitAction: "record", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: func(in enterpriseDelegatedInput) string { return "/v1/codocs/documents/" + in.Code }},
	},
}
var enterpriseCodocsAccessRecordRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsAccessRecordSpec)
var enterpriseCodocsPathHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func enterpriseCodocsAccessRecordQuery(input enterpriseDelegatedInput, action string, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsAccessRecordSpec.Actions[action]
	if !ok || actor == "" || len(input.Payload) != 2 {
		return nil, httperror.New(400, "invalid_access_record", "Invalid access record")
	}
	id, ok := input.Payload["eventId"].(string)
	if _, err := uuid.Parse(id); !ok || err != nil {
		return nil, httperror.New(400, "invalid_access_record", "Invalid event identifier")
	}
	hash, ok := input.Payload["pathSha256"].(string)
	if !ok || !enterpriseCodocsPathHashPattern.MatchString(hash) {
		return nil, httperror.New(400, "invalid_access_record", "Invalid storage binding")
	}
	return enterpriseDelegatedQuery(input, enterpriseCodocsAccessRecordSpec, act, actor)
}
