package aims

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestProductCostFreezeUsesCallerTransactionAndCanonicalCommand(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "review", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": float64(5000)}}}
	trusted := integrationoperation.TrustedContext{TenantCode: "TENANT", DeploymentCode: "AIMS", SourceApp: "aims", ServiceClientID: "aims.runtime"}
	id := "00000000-0000-4000-8000-000000000001"
	key := "aims:product-cost-rules:" + id
	hash, _ := integrationoperation.ValidateAndDigestCommand(command)
	payload, _ := json.Marshal(command)
	mock.ExpectExec("INSERT INTO integration_operation").WithArgs(id, key, key, "TENANT", "AIMS", productCostRulesOperationCode, id, key, string(payload), hash, "U1").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT operation_id,operation_key").WithArgs(id).WillReturnRows(sqlmock.NewRows([]string{"id", "key", "tenant", "deployment", "source", "target", "operation", "biz_type", "biz_code", "idempotency", "hash", "capability", "schema", "actor"}).AddRow(id, key, "TENANT", "AIMS", "aims", "finance", productCostRulesOperationCode, "product_cost_rules_request", id, key, hash, "finance:product-cost:replace-rules", "product-cost-rules.v1", "U1"))
	got, err := freezeProductCostRules(context.Background(), tx, trusted, id, "U1", "PRJ1", command)
	if err != nil || got != key {
		t.Fatalf("%s %v", got, err)
	}

	// Identical retry reuses the same key; changed payload receives a conflict.
	for _, changed := range []bool{false, true} {
		mock.ExpectExec("INSERT INTO integration_operation").WillReturnResult(sqlmock.NewResult(0, 0))
		storedHash := hash
		if changed {
			storedHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		}
		mock.ExpectQuery("SELECT operation_id,operation_key").WithArgs(id).WillReturnRows(sqlmock.NewRows([]string{"id", "key", "tenant", "deployment", "source", "target", "operation", "biz_type", "biz_code", "idempotency", "hash", "capability", "schema", "actor"}).AddRow(id, key, "TENANT", "AIMS", "aims", "finance", productCostRulesOperationCode, "product_cost_rules_request", id, key, storedHash, "finance:product-cost:replace-rules", "product-cost-rules.v1", "U1"))
		got, err = freezeProductCostRules(context.Background(), tx, trusted, id, "U1", "PRJ1", command)
		if changed {
			if !errors.Is(err, errProductCostFreezeConflict) {
				t.Fatalf("expected conflict: %v", err)
			}
		} else if err != nil || got != key {
			t.Fatalf("retry: %s %v", got, err)
		}
	}
	// The helper must not commit; the caller can still roll the operation back.
	mock.ExpectRollback()
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	for _, input := range []struct {
		actor, project string
		trusted        integrationoperation.TrustedContext
	}{
		{"OTHER", "PRJ1", trusted}, {"U1", "OTHER", trusted},
		{"U1", "PRJ1", integrationoperation.TrustedContext{TenantCode: "TENANT", DeploymentCode: "AIMS", SourceApp: "finance", ServiceClientID: "aims.runtime"}},
	} {
		if _, err := freezeProductCostRules(context.Background(), nil, input.trusted, id, input.actor, input.project, command); err == nil {
			t.Fatal("unbound command accepted")
		}
	}
}
