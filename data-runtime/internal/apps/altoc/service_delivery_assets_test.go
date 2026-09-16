package altoc

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFormalDeliveryAssetCodeForStatusSyncRejectsPlanCodes(t *testing.T) {
	_, err := formalDeliveryAssetCodeForStatusSync("DAP-1", map[string]any{
		"deliveryAssetCode": "CDAP-CL-1",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_delivery_asset_code" {
		t.Fatalf("error = %#v, want 400 invalid_delivery_asset_code", err)
	}
}

func TestFormalDeliveryAssetCodeForStatusSyncDoesNotReusePlanPathAsFormalCode(t *testing.T) {
	code, err := formalDeliveryAssetCodeForStatusSync("DAP-1", map[string]any{
		"sourcePlanCode": "DAP-1",
	})
	if err != nil {
		t.Fatalf("formalDeliveryAssetCodeForStatusSync: %v", err)
	}
	if code != "" {
		t.Fatalf("code = %q, want empty formal code when only a plan code is present", code)
	}
}

func TestFormalDeliveryAssetCodeForStatusSyncUsesFormalPathCode(t *testing.T) {
	code, err := formalDeliveryAssetCodeForStatusSync("CDA-1", map[string]any{})
	if err != nil {
		t.Fatalf("formalDeliveryAssetCodeForStatusSync: %v", err)
	}
	if code != "CDA-1" {
		t.Fatalf("code = %q, want formal path code", code)
	}
}

func TestCustomerDeliveryAssetStatusSyncContextReturnsExpectedCustomer(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT\s+dap\.\*,.*FROM contract_delivery_asset_plan dap`).
		WithArgs("CDA-2", "CDA-2", "DAP-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"code",
			"contract_id",
			"customer_code",
			"external_asset_code",
			"contract_code",
			"contract_customer_code",
			"service_agreement_customer_code",
		}).AddRow(int64(10), "DAP-1", int64(20), "CUS-A", nil, "CON-1", "CUS-A", "CUS-A"))

	result, err := adapter.customerDeliveryAssetStatusSyncContext(context.Background(), "CDA-2", url.Values{
		"sourcePlanCode": []string{"DAP-1"},
	})
	if err != nil {
		t.Fatalf("customerDeliveryAssetStatusSyncContext: %v", err)
	}
	if result["expectedCustomerCode"] != "CUS-A" || result["expected_customer_code"] != "CUS-A" {
		t.Fatalf("result = %#v, want expected customer CUS-A", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestAssertStatusSyncPayloadCustomerRejectsCrossCustomer(t *testing.T) {
	err := assertStatusSyncPayloadCustomer(
		map[string]any{"customer_code": "CUS-A"},
		map[string]any{"customerCode": "CUS-B"},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "delivery_asset_customer_conflict" {
		t.Fatalf("error = %#v, want 409 delivery_asset_customer_conflict", err)
	}
}

func TestAssertStatusSyncPayloadCustomerRejectsNestedEnvironmentCrossCustomer(t *testing.T) {
	err := assertStatusSyncPayloadCustomer(
		map[string]any{"customer_code": "CUS-A"},
		map[string]any{
			"asset": map[string]any{"customer_code": "CUS-A"},
			"environment": map[string]any{
				"customer_code": "CUS-B",
			},
		},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "environment_customer_conflict" {
		t.Fatalf("error = %#v, want 409 environment_customer_conflict", err)
	}
}

func TestAssertStatusSyncPayloadCustomerRejectsNestedPairCustomerConflict(t *testing.T) {
	err := assertStatusSyncPayloadCustomer(
		map[string]any{},
		map[string]any{
			"deliveryAsset": map[string]any{"customerCode": "CUS-A"},
			"environment":   map[string]any{"customerCode": "CUS-B"},
		},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "delivery_asset_environment_conflict" {
		t.Fatalf("error = %#v, want 409 delivery_asset_environment_conflict", err)
	}
}
