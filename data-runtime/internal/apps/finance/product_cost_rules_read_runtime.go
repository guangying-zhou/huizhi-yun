package finance

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const productCostRulesReadOperation = "aims.finance.product-cost.rules.read.v1"
const productCostRulesReadSchema = "product-cost-rules-read.v1"
const productCostRulesReadCapability = "finance:product-cost:read-rules"

func (a *Adapter) readProductCostRulesRuntime(ctx context.Context, method string, query url.Values, body map[string]any) (DataResult[map[string]any], error) {
	empty := DataResult[map[string]any]{}
	deny := func() (DataResult[map[string]any], error) {
		return empty, httperror.New(403, "product_cost_runtime_forbidden", "Trusted product cost authorization required")
	}
	if method != http.MethodPost {
		return empty, httperror.New(405, "method_not_allowed", "POST required")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("scope")) {
		if scope == productCostRulesReadCapability {
			allowed = true
		}
	}
	if !allowed {
		return deny()
	}
	envelope, command, err := integrationoperation.ReceiptCommandFromBody(body, "finance", productCostRulesReadOperation, productCostRulesReadCapability)
	if err != nil {
		return deny()
	}
	input, err := parseProductCostRulesReadCommand(command)
	if err != nil {
		return empty, err
	}
	if envelope.CommandSchemaVersion != productCostRulesReadSchema || envelope.TrustedContext.SourceApp != "aims" || envelope.TrustedContext.ServiceClientID != "aims.runtime" ||
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

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return empty, err
	}
	defer tx.Rollback()
	rules, err := readProductCostAttribution(ctx, tx, input.ProjectCode, input.PeriodMonth)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return empty, err
	}
	data := map[string]any{"projectCode": input.ProjectCode, "periodMonth": input.PeriodMonth, "revision": int64(0), "evidenceRef": "", "shares": []map[string]any{}}
	if err == nil {
		shares := make([]map[string]any, 0, len(rules.Shares))
		for _, share := range rules.Shares {
			shares = append(shares, map[string]any{"productCode": share.ProductCode, "basisPoints": share.BasisPoints})
		}
		data["revision"] = rules.Revision
		data["evidenceRef"] = rules.EvidenceRef
		data["shares"] = shares
	}
	if err = tx.Commit(); err != nil {
		return empty, err
	}
	return resultData(data), nil
}

// The editor reads the whole project rule set, with no single-product filter.
func parseProductCostRulesReadCommand(command map[string]any) (productCostReadCommand, error) {
	if len(command) != 4 {
		return productCostReadCommand{}, httperror.New(400, "product_cost_command_invalid", "Four rule read fields required")
	}
	copy := map[string]any{}
	for key, value := range command {
		copy[key] = value
	}
	if _, exists := copy["productCode"]; exists {
		return productCostReadCommand{}, httperror.New(400, "product_cost_command_invalid", "Product filter is not allowed")
	}
	copy["productCode"] = "rules-read"
	return parseProductCostReadCommand(copy)
}
