package aims

import (
	"context"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestCreateWorkItemFromServiceTicketReplaysGlobalTicketBinding(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM work_item_service_ext wse.*WHERE wse\.source_ticket_code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "project_code"}).
			AddRow(int64(101), int64(10), "PRJ-1"))
	mock.ExpectExec(`(?s)UPDATE work_item_service_ext.*WHERE work_item_id = \?.*AND source_ticket_code = \?`).
		WithArgs(nil, nil, nil, nil, nil, nil, nil, int64(101), "ST-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT\s+wi\.\*,.*FROM work_items wi.*WHERE wi\.id = \?`).
		WithArgs(int64(101)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "item_key", "project_id", "source_ticket_code"}).
			AddRow(int64(101), "PRJ-1-9", int64(10), "ST-1"))
	mock.ExpectCommit()

	result, err := adapter.createWorkItemFromServiceTicket(context.Background(), "ST-1", map[string]any{
		"projectCode": "PRJ-1",
	})
	if err != nil {
		t.Fatalf("createWorkItemFromServiceTicket: %v", err)
	}
	if result["created"] != false || result["idempotent"] != true {
		t.Fatalf("result = %#v, want idempotent replay", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateWorkItemFromServiceTicketRejectsProjectRebinding(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM work_item_service_ext wse.*WHERE wse\.source_ticket_code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "project_code"}).
			AddRow(int64(101), int64(10), "PRJ-OLD"))
	mock.ExpectRollback()

	_, err := adapter.createWorkItemFromServiceTicket(context.Background(), "ST-1", map[string]any{
		"projectCode": "PRJ-NEW",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "service_ticket_project_conflict" {
		t.Fatalf("error = %#v, want 409 service_ticket_project_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
