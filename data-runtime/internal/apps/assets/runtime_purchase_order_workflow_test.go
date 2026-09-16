package assets

import (
	"context"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestCreatePurchaseOrderOnlyCreatesDraft(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO purchase_orders").
		WithArgs(
			"PO-1",
			"physical",
			"self_use",
			"trusted-operator",
			"UNKNOWN",
			nil,
			nil,
			nil,
			nil,
			nil,
			float64(1000),
			nil,
			"draft",
			nil,
			nil,
			nil,
		).
		WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectExec("INSERT INTO asset_events").
		WithArgs("purchase_order", int64(42), "created", sqlmock.AnyArg(), "trusted-operator").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	id, err := adapter.createPurchaseOrder(
		context.Background(),
		map[string]any{
			"order_no":      "PO-1",
			"budget_amount": float64(1000),
		},
		"trusted-operator",
	)
	if err != nil {
		t.Fatalf("createPurchaseOrder returned error: %v", err)
	}
	if id != 42 {
		t.Fatalf("id = %d, want 42", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCreatePurchaseOrderRejectsTerminalStatusWithoutWorkflow(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	_, err := adapter.createPurchaseOrder(
		context.Background(),
		map[string]any{
			"order_no": "PO-1",
			"status":   "approved",
		},
		"trusted-operator",
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "asset_purchase_order_status_requires_workflow" {
		t.Fatalf("expected purchase order status workflow forbidden error, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestUpdatePurchaseOrderRejectsWorkflowControlFields(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	err := adapter.updatePurchaseOrder(
		context.Background(),
		42,
		map[string]any{"status": "approved"},
		"trusted-operator",
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "asset_purchase_order_status_requires_workflow" {
		t.Fatalf("expected purchase order status workflow forbidden error, got %#v", err)
	}

	err = adapter.updatePurchaseOrder(
		context.Background(),
		42,
		map[string]any{"workflow_instance_id": "WF-1"},
		"trusted-operator",
	)
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "asset_purchase_order_workflow_requires_submit" {
		t.Fatalf("expected purchase order workflow submit forbidden error, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
