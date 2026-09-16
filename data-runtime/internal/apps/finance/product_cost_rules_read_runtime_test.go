package finance

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestProductCostRulesReadRuntimeRejectsViewAuthorizationBeforeDatabase(t *testing.T) {
	for _, mode := range []string{"read_scope", "read_purpose", "read_action", "wrong_project", "empty_access"} {
		query, body := productCostRuntimeFixture(t)
		query.Set("scope", productCostRulesReadCapability)
		command := map[string]any{"actorUid": "U1", "projectCode": "PRJ-1", "periodMonth": "2026-09", "action": "read"}
		digest, err := integrationoperation.ValidateAndDigestCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		envelope := body["serviceCommand"].(map[string]any)
		envelope["command"], envelope["commandSha256"] = command, digest
		envelope["operationCode"], envelope["commandSchemaVersion"], envelope["requiredCapability"] = productCostRulesReadOperation, productCostRulesReadSchema, productCostRulesReadCapability
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
		_, operation, err := (&Adapter{}).HandleMutationWithQuery(context.Background(), http.MethodPost, "/v1/finance/internal/product-cost:read-rules", query, body)
		if err == nil || operation != "finance.product_cost.read_rules" {
			t.Fatalf("accepted %s: %v", mode, err)
		}
	}
}

func TestProductCostRulesReadRuntimeReturnsWholeRevision(t *testing.T) {
	for _, exists := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		q, b := productCostRuntimeFixture(t)
		q.Set("scope", productCostRulesReadCapability)
		command := map[string]any{"actorUid": "U1", "projectCode": "PRJ-1", "periodMonth": "2026-09", "action": "read"}
		hash, _ := integrationoperation.ValidateAndDigestCommand(command)
		envelope := b["serviceCommand"].(map[string]any)
		envelope["command"], envelope["commandSha256"] = command, hash
		envelope["operationCode"], envelope["commandSchemaVersion"], envelope["requiredCapability"] = productCostRulesReadOperation, productCostRulesReadSchema, productCostRulesReadCapability
		auth := b["productCostAuthorization"].(map[string]any)
		delete(b, "productCostAuthorization")
		auth["action"], auth["purpose"] = "edit", "product_cost_rules_edit"
		b["productCostRulesAuthorization"] = auth
		mock.ExpectBegin()
		rows := sqlmock.NewRows([]string{"revision", "evidence_ref", "shares_json", "total_basis_points"})
		if exists {
			rows.AddRow(3, "review", `[{"ProductCode":"P1","BasisPoints":5000},{"ProductCode":"P2","BasisPoints":3000}]`, 8000)
		}
		mock.ExpectQuery("SELECT r.revision").WithArgs("PRJ-1", "2026-09").WillReturnRows(rows)
		mock.ExpectCommit()
		result, err := (&Adapter{db: db}).readProductCostRulesRuntime(context.Background(), "POST", q, b)
		if err != nil {
			t.Fatal(err)
		}
		shares := result.Data["shares"].([]map[string]any)
		if exists {
			if result.Data["revision"] != int64(3) || len(shares) != 2 {
				t.Fatalf("%v", result.Data)
			}
		} else if result.Data["revision"] != int64(0) || len(shares) != 0 {
			t.Fatalf("%v", result.Data)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
