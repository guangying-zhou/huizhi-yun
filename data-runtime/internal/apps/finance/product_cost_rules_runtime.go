package finance

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const productCostRulesOperation = "aims.finance.product-cost.rules.replace.v1"
const productCostRulesSchema = "product-cost-rules.v1"
const productCostRulesCapability = "finance:product-cost:replace-rules"

func (a *Adapter) replaceProductCostRulesRuntime(ctx context.Context, method string, query url.Values, body map[string]any) (DataResult[map[string]any], error) {
	empty := DataResult[map[string]any]{}
	deny := func() (DataResult[map[string]any], error) {
		return empty, httperror.New(403, "product_cost_runtime_forbidden", "Trusted product cost authorization required")
	}
	if method != http.MethodPost {
		return empty, httperror.New(405, "method_not_allowed", "POST required")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("scope")) {
		if scope == productCostRulesCapability {
			allowed = true
		}
	}
	if !allowed {
		return deny()
	}
	envelope, command, err := integrationoperation.ReceiptCommandFromBody(body, "finance", productCostRulesOperation, productCostRulesCapability)
	if err != nil {
		return deny()
	}
	input, _, err := parseProductCostRulesCommand(command)
	if err != nil {
		return empty, err
	}
	if envelope.CommandSchemaVersion != productCostRulesSchema || envelope.TrustedContext.SourceApp != "aims" || envelope.TrustedContext.ServiceClientID != "aims.runtime" ||
		query.Get("runtime_source_app") != "finance" || query.Get("tenant") != envelope.TrustedContext.TenantCode || query.Get("deployment") != envelope.TargetDeploymentCode ||
		query.Get("current_user") != input.ActorUID || query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("hzy_runtime_actor_purpose") != "service-command" {
		return deny()
	}
	// Only Finance BFF may supply this short-lived authorization after a fresh
	// Console query. The external AIMS request must not accept this extra field.
	authorization, ok := body["productCostRulesAuthorization"].(map[string]any)
	if !ok || authorization["action"] != "edit" || authorization["purpose"] != "product_cost_rules_edit" {
		return deny()
	}
	expires, ok := authorization["expiresAt"].(float64)
	now := float64(time.Now().UnixMilli())
	if !ok || expires <= now || expires > now+30000 {
		return deny()
	}
	values := url.Values{}
	for _, key := range []string{"current_user", "current_user_project_finance_access", "current_user_project_finance_project_codes"} {
		if value, ok := authorization[key].(string); ok {
			values.Set(key, value)
		}
	}
	if values.Get("current_user") != input.ActorUID {
		return deny()
	}
	if access := values.Get("current_user_project_finance_access"); access != "all" && access != "projects" {
		return deny()
	}
	if err := requireProjectFinanceQueryAccess(values, input.ProjectCode); err != nil {
		return empty, err
	}
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return empty, err
	}
	executed, err := repository.Execute(ctx, envelope, productCostRulesReceiptHandler(input.ActorUID, input.ProjectCode, input.PeriodMonth))
	if errors.Is(err, errProductCostRevisionConflict) {
		return empty, httperror.New(409, "product_cost_revision_conflict", "Product cost rules changed; reload before saving")
	}
	if err != nil {
		return empty, financeReceiptError(err)
	}
	return resultData(map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded", "operationId": envelope.OperationID,
		"operationCode": envelope.OperationCode, "idempotencyKey": envelope.IdempotencyKey,
		"commandSchemaVersion": envelope.CommandSchemaVersion, "commandSha256": envelope.CommandSHA256,
		"idempotent": executed.Existing, "targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value,
	}), nil
}
