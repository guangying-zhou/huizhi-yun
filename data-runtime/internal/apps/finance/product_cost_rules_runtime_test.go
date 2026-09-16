package finance

import (
	"context"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestProductCostRulesRuntimeRejectsReadAuthorizationBeforeDatabase(t *testing.T) {
	for _, mode := range []string{"read_scope", "read_purpose", "read_action", "wrong_project", "empty_access"} {
		query, body := productCostRuntimeFixture(t)
		query.Set("scope", productCostRulesCapability)
		command := map[string]any{"actorUid": "U1", "projectCode": "PRJ-1", "periodMonth": "2026-09", "expectedRevision": float64(0), "evidenceRef": "APPROVAL", "shares": []any{}}
		digest, err := integrationoperation.ValidateAndDigestCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		envelope := body["serviceCommand"].(map[string]any)
		envelope["command"], envelope["commandSha256"] = command, digest
		envelope["operationCode"], envelope["commandSchemaVersion"], envelope["requiredCapability"] = productCostRulesOperation, productCostRulesSchema, productCostRulesCapability
		auth := body["productCostAuthorization"].(map[string]any)
		delete(body, "productCostAuthorization")
		body["productCostRulesAuthorization"] = auth
		auth["action"], auth["purpose"] = "edit", "product_cost_rules_edit"
		switch mode {
		case "read_scope":
			query.Set("scope", productCostReadCapability)
		case "read_purpose":
			auth["purpose"] = "product_cost_read"
		case "read_action":
			auth["action"] = "view"
		case "wrong_project":
			auth["current_user_project_finance_project_codes"] = "OTHER"
		case "empty_access":
			auth["current_user_project_finance_access"] = ""
		}
		_, operation, err := (&Adapter{}).HandleMutationWithQuery(context.Background(), http.MethodPost, "/v1/finance/internal/product-cost:replace-rules", query, body)
		if err == nil || operation != "finance.product_cost.replace_rules" {
			t.Fatalf("accepted %s: %v", mode, err)
		}
	}
}
