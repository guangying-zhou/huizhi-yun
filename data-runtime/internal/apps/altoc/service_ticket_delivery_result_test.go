package altoc

import (
	"context"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func serviceTicketDeliveryTestBody() map[string]any {
	return map[string]any{
		"current_user":        "aims.runtime",
		"current_user_scopes": []string{"altoc.write", "altoc:service-ticket:delivery-result:sync"},
		"aimsProjectCode":     "PRJ-1",
		"workItemKey":         "PRJ-1-9",
		"deliveryStatus":      "processing",
		"deliveryGeneration":  1,
	}
}

func TestSyncServiceTicketDeliveryResultRejectsBindingChange(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "status", "aims_project_code", "project_code", "aims_work_item_key", "aims_delivery_generation"}).
			AddRow(int64(1), "ST-1", "processing", "PRJ-OLD", "PRJ-OLD", "PRJ-OLD-1", 1))
	mock.ExpectRollback()
	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	_, err = adapter.syncServiceTicketDeliveryResultTx(context.Background(), tx, "ST-1", serviceTicketDeliveryTestBody())
	_ = tx.Rollback()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "service_ticket_delivery_binding_conflict" {
		t.Fatalf("error = %#v, want 409 service_ticket_delivery_binding_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSyncServiceTicketDeliveryResultIgnoresStateRegression(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "status", "aims_project_code", "project_code", "aims_work_item_key", "aims_delivery_generation"}).
			AddRow(int64(1), "ST-1", "resolved", "PRJ-1", "PRJ-1", "PRJ-1-9", 1))
	mock.ExpectCommit()
	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	result, err := adapter.syncServiceTicketDeliveryResultTx(context.Background(), tx, "ST-1", serviceTicketDeliveryTestBody())
	if err != nil {
		t.Fatalf("syncServiceTicketDeliveryResult: %v", err)
	}
	if result["updated"] != false || result["idempotent"] != true {
		t.Fatalf("result = %#v, want stale idempotent replay", result)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
