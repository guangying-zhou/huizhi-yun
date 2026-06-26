package assets

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestCustomerDeliveryAssetCodeDoesNotReuseSourcePlanCode(t *testing.T) {
	got := customerDeliveryAssetCode("", "CDAP-CL-10", "", "")
	if got == "CDAP-CL-10" || !strings.HasPrefix(got, "CDA-") {
		t.Fatalf("customerDeliveryAssetCode = %q, want Assets-owned CDA code distinct from plan code", got)
	}
	if customerDeliveryAssetPlanCodeLike(got) {
		t.Fatalf("generated code %q should not look like an Altoc plan code", got)
	}
}

func TestUpsertCustomerDeliveryAssetTxRejectsExplicitPlanCode(t *testing.T) {
	_, _, err := (&Adapter{}).upsertCustomerDeliveryAssetTx(context.Background(), nil, map[string]any{
		"deliveryAssetCode": "CDAP-CL-10",
		"customerCode":      "CUS-1",
	}, "tester")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_delivery_asset_code" {
		t.Fatalf("error = %#v, want 400 invalid_delivery_asset_code", err)
	}
}

func TestUpsertCustomerDeliveryAssetTxReusesSourcePlanFormalCode(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}

	mock.ExpectQuery(`(?s)SELECT id\s+FROM customer_delivery_assets\s+WHERE delivery_asset_code = \?`).
		WithArgs("CDA-CON1-CL1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT id, delivery_asset_code\s+FROM customer_delivery_assets\s+WHERE source_plan_code = \?`).
		WithArgs("CDAP-CL-10").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code"}).
			AddRow(int64(55), "CDA-EXISTING"))
	mock.ExpectExec(`(?s)UPDATE customer_delivery_assets\s+SET customer_code = \?`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO asset_events`).
		WithArgs("customer_delivery_asset", int64(55), "updated", sqlmock.AnyArg(), "tester").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets\s+WHERE id = \?\s+LIMIT 1`).
		WithArgs(int64(55)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "source_plan_code", "customer_code"}).
			AddRow(int64(55), "CDA-EXISTING", "CDAP-CL-10", "CUS-1"))
	mock.ExpectCommit()

	item, created, err := (&Adapter{}).upsertCustomerDeliveryAssetTx(context.Background(), tx, map[string]any{
		"code":             "CDAP-CL-10",
		"customerCode":     "CUS-1",
		"contractCode":     "CON-1",
		"contractLineCode": "CL-1",
		"name":             "计划交付资产",
	}, "tester")
	if err != nil {
		t.Fatalf("upsertCustomerDeliveryAssetTx: %v", err)
	}
	if created {
		t.Fatal("source plan retry should update the existing formal asset, not create another row")
	}
	if item["delivery_asset_code"] != "CDA-EXISTING" {
		t.Fatalf("delivery_asset_code = %#v, want existing formal code", item["delivery_asset_code"])
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
