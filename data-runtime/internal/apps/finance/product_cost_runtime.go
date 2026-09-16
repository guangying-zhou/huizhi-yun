package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) readProductCostRuntime(ctx context.Context, method string, query url.Values, body map[string]any) (DataResult[map[string]any], error) {
	empty := DataResult[map[string]any]{}
	deny := func() (DataResult[map[string]any], error) {
		return empty, httperror.New(403, "product_cost_runtime_forbidden", "Trusted product cost authorization required")
	}
	if method != http.MethodPost {
		return empty, httperror.New(405, "method_not_allowed", "POST required")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("scope")) {
		if scope == productCostReadCapability {
			allowed = true
		}
	}
	if !allowed {
		return deny()
	}
	envelope, command, err := integrationoperation.ReceiptCommandFromBody(body, "finance", productCostReadOperation, productCostReadCapability)
	if err != nil {
		return deny()
	}
	input, err := parseProductCostReadCommand(command)
	if err != nil {
		return empty, err
	}
	if envelope.CommandSchemaVersion != productCostReadOperation || envelope.TrustedContext.SourceApp != "aims" || envelope.TrustedContext.ServiceClientID != "aims.runtime" ||
		query.Get("runtime_source_app") != "finance" || query.Get("tenant") != envelope.TrustedContext.TenantCode || query.Get("deployment") != envelope.TargetDeploymentCode ||
		query.Get("current_user") != input.ActorUID || query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("hzy_runtime_actor_purpose") != "service-command" {
		return deny()
	}
	// Only Finance BFF may supply this short-lived authorization after a fresh
	// Console query. The external AIMS request must not accept this extra field.
	authorization, ok := body["productCostAuthorization"].(map[string]any)
	if !ok {
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
	snapshot, err := readProductCostSnapshot(ctx, a.db, input.ProjectCode, input.PeriodMonth)
	if err != nil {
		return empty, err
	}
	view, err := projectProductCostView(snapshot, input.ProductCode, input.ProjectCode, input.PeriodMonth)
	if err != nil {
		return empty, err
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		return empty, err
	}
	var data map[string]any
	if err := json.Unmarshal(encoded, &data); err != nil {
		return empty, err
	}
	return DataResult[map[string]any]{Data: data}, nil
}
