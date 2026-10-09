// Package knowledgecommand validates the two fixed Enterprise knowledge-link
// protocols after Runtime transport authentication. It never trusts body roles.
package knowledgecommand

import (
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"strings"
)

func Validate(target string, q url.Values, body map[string]any) (integrationoperation.ReceiptCommandInput, map[string]any, error) {
	cap := target + ":knowledge-link:create"
	if target == "assets" {
		cap = "assets:asset-link:create"
	}
	deny := func() (integrationoperation.ReceiptCommandInput, map[string]any, error) {
		return integrationoperation.ReceiptCommandInput{}, nil, httperror.New(403, "knowledge_command_forbidden", "知识关联委托无效")
	}
	if target != "assets" && target != "codocs" {
		return deny()
	}
	in, cmd, e := integrationoperation.ReceiptCommandFromBody(body, target, "enterprise."+target+".knowledge-link.v1", cap)
	if e != nil {
		return deny()
	}
	if in.CommandSchemaVersion != "v1" || in.TrustedContext.SourceApp != "enterprise" || in.TrustedContext.ServiceClientID != "enterprise.runtime" || q.Get("hzy_runtime_source_app") != target || q.Get("hzy_runtime_tenant_code") != in.TrustedContext.TenantCode || q.Get("hzy_runtime_deployment_code") != in.TargetDeploymentCode || q.Get("current_user") != fmt.Sprint(cmd["actorUid"]) || q.Get("hzy_runtime_actor_delegated") != "1" || q.Get("hzy_runtime_actor_purpose") != "service-command" {
		return deny()
	}
	allowed := false
	for _, s := range strings.Fields(q.Get("current_user_scopes")) {
		if s == cap {
			allowed = true
		}
	}
	if !allowed {
		return deny()
	}
	if len(cmd) != 11 || cmd["action"] != "link" || cmd["targetDeployment"] != in.TargetDeploymentCode {
		return deny()
	}
	for _, k := range []string{"actorUid", "ticketCode", "documentUuid", "customerCode", "contractCode", "projectCode", "deliveryCode", "deliveryAssetCode", "environmentCode", "targetDeployment"} {
		s, ok := cmd[k].(string)
		if !ok || s == "" || s != strings.TrimSpace(s) || len(s) > 128 || strings.ContainsAny(s, "\r\n\x00") {
			return deny()
		}
	}
	u, e := uuid.Parse(cmd["documentUuid"].(string))
	if e != nil || u == uuid.Nil || u.String() != cmd["documentUuid"] {
		return deny()
	}
	return in, cmd, nil
}
func Receipt(in integrationoperation.ReceiptCommandInput, r integrationoperation.ReceiptExecutionResult) map[string]any {
	return map[string]any{"receiptId": r.ReceiptID, "receiptStatus": "succeeded", "operationId": in.OperationID, "operationCode": in.OperationCode, "idempotencyKey": in.IdempotencyKey, "commandSchemaVersion": in.CommandSchemaVersion, "commandSha256": in.CommandSHA256, "targetBizType": r.TargetBizType, "targetBizCode": r.TargetBizCode, "responseSummarySha256": r.ResponseSummarySHA256, "idempotent": r.Existing}
}
