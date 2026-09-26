package server

import (
	"net/http"
	"net/url"
	"regexp"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsPublishExecutionSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "publish-execution", ErrorCode: "enterprise_codocs_publish_execution",
	Actions: map[string]enterpriseDelegatedAction{
		"seal": {Method: http.MethodPost, PermitAction: "seal", AllowPayload: true, CodePattern: regexp.MustCompile(`^[1-9][0-9]{0,18}$`), Target: func(in enterpriseDelegatedInput) string {
			return "/v1/codocs/reviews/publish-requests/" + in.Code + "/seal"
		}},
		"send": {Method: http.MethodPost, PermitAction: "send", AllowPayload: true, CodePattern: regexp.MustCompile(`^[1-9][0-9]{0,18}$`), Target: func(in enterpriseDelegatedInput) string {
			return "/v1/codocs/reviews/publish-requests/" + in.Code + "/send"
		}},
		"receive": {Method: http.MethodPost, PermitAction: "receive", AllowPayload: true, CodePattern: regexp.MustCompile(`^[1-9][0-9]{0,18}$`), Target: func(in enterpriseDelegatedInput) string {
			return "/v1/codocs/reviews/publish-requests/" + in.Code + "/receive"
		}},
	},
}

var enterpriseCodocsPublishExecutionRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsPublishExecutionSpec)

func enterpriseCodocsPublishExecutionQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsPublishExecutionSpec.Actions[action]
	invalid := httperror.New(http.StatusBadRequest, "enterprise_codocs_publish_execution_input_invalid", "Invalid publication execution input")
	if !ok || actor == "" {
		return nil, invalid
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsPublishExecutionSpec, act, actor)
	if err != nil {
		return nil, err
	}
	allowed := map[string]map[string]bool{
		"seal":    {"sealTypes": true, "pageCount": true, "remark": true},
		"send":    {"senderUid": true, "receiverName": true, "receiverPhone": true, "channel": true, "sentDate": true, "targetAccount": true, "remark": true},
		"receive": {"receiveDate": true},
	}[action]
	for key := range input.Payload {
		if !allowed[key] {
			return nil, invalid
		}
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}
