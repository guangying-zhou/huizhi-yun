package compat

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func newRuntimeUpdateHookTestAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	adapter := &Adapter{
		appCode:      "test",
		db:           database,
		responseMode: ResponseCodeData,
		resources: []ResourceSpec{
			{Path: "items", Table: "items", IDColumn: "id"},
		},
		columnCache: map[string]map[string]columnInfo{
			"items": {
				"id":         {Name: "id", DataType: "bigint"},
				"status":     {Name: "status", DataType: "varchar"},
				"updated_by": {Name: "updated_by", DataType: "varchar", Nullable: true},
			},
		},
	}
	return adapter, mock, func() { _ = database.Close() }
}

func TestHandleRuntimeUpdateWithTxHookCommitsUpdateHookAndMetadataTogether(t *testing.T) {
	adapter, mock, closeDB := newRuntimeUpdateHookTestAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `items` SET `status` = \\?, `updated_by` = \\? WHERE `id` = \\?").
		WithArgs("completed", "u1", "7").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO hook_witness \(resource_id, operation_key\) VALUES \(\?, \?\)`).
		WithArgs("7", "operation-7").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT \\* FROM `items` WHERE `id` = \\? LIMIT 1").
		WithArgs("7").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "updated_by"}).AddRow(int64(7), "completed", "u1"))

	response, operation, err := adapter.HandleRuntimeUpdateWithTxHook(
		context.Background(),
		http.MethodPut,
		"/v1/test/items/7",
		url.Values{"current_user": []string{"u1"}},
		map[string]any{"status": "completed"},
		func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
			if _, err := tx.ExecContext(ctx, "INSERT INTO hook_witness (resource_id, operation_key) VALUES (?, ?)", identifier, "operation-7"); err != nil {
				return nil, err
			}
			return map[string]any{"serviceTicketDelivery": map[string]any{
				"linked":          true,
				"operationKey":    "operation-7",
				"operationStatus": "pending",
			}}, nil
		},
	)
	if err != nil {
		t.Fatalf("HandleRuntimeUpdateWithTxHook: %v", err)
	}
	if operation != "test.items.update" {
		t.Fatalf("operation = %q", operation)
	}
	envelope := response.(map[string]any)
	data := envelope["data"].(map[string]any)
	if data["status"] != "completed" {
		t.Fatalf("updated resource = %#v", data)
	}
	metadata, ok := data["serviceTicketDelivery"].(map[string]any)
	if !ok || metadata["operationKey"] != "operation-7" || metadata["operationStatus"] != "pending" {
		t.Fatalf("hook metadata = %#v", data["serviceTicketDelivery"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestHandleRuntimeUpdateWithTxHookAcceptsIdempotentNoOpUpdate(t *testing.T) {
	adapter, mock, closeDB := newRuntimeUpdateHookTestAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `items` SET `status` = \\?, `updated_by` = \\? WHERE `id` = \\?").
		WithArgs("in_progress", "u1", "7").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT 1 FROM `items` WHERE `id` = \\? LIMIT 1").
		WithArgs("7").
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
	mock.ExpectExec(`INSERT INTO hook_witness \(resource_id, operation_key\) VALUES \(\?, \?\)`).
		WithArgs("7", "operation-7").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT \\* FROM `items` WHERE `id` = \\? LIMIT 1").
		WithArgs("7").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "updated_by"}).AddRow(int64(7), "in_progress", "u1"))

	response, _, err := adapter.HandleRuntimeUpdateWithTxHook(
		context.Background(),
		http.MethodPut,
		"/v1/test/items/7",
		url.Values{"current_user": []string{"u1"}},
		map[string]any{"status": "in_progress"},
		func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
			if _, err := tx.ExecContext(ctx, "INSERT INTO hook_witness (resource_id, operation_key) VALUES (?, ?)", identifier, "operation-7"); err != nil {
				return nil, err
			}
			return map[string]any{"operationKey": "operation-7"}, nil
		},
	)
	if err != nil {
		t.Fatalf("idempotent update returned error: %v", err)
	}
	envelope := response.(map[string]any)
	data := envelope["data"].(map[string]any)
	if data["status"] != "in_progress" || data["operationKey"] != "operation-7" {
		t.Fatalf("updated resource = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestHandleRuntimeUpdateWithTxHookStillRejectsMissingRecord(t *testing.T) {
	adapter, mock, closeDB := newRuntimeUpdateHookTestAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `items` SET `status` = \\?, `updated_by` = \\? WHERE `id` = \\?").
		WithArgs("in_progress", "u1", "404").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT 1 FROM `items` WHERE `id` = \\? LIMIT 1").
		WithArgs("404").
		WillReturnRows(sqlmock.NewRows([]string{"1"}))
	mock.ExpectRollback()

	hookCalled := false
	_, _, err := adapter.HandleRuntimeUpdateWithTxHook(
		context.Background(),
		http.MethodPut,
		"/v1/test/items/404",
		url.Values{"current_user": []string{"u1"}},
		map[string]any{"status": "in_progress"},
		func(context.Context, *sql.Tx, string) (map[string]any, error) {
			hookCalled = true
			return nil, nil
		},
	)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusNotFound || httpErr.Code != "record_not_found" {
		t.Fatalf("error = %v, want record not found", err)
	}
	if hookCalled {
		t.Fatal("hook must not run for a missing record")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestHandleRuntimeUpdateWithTxHookRollsBackResourceWhenHookFails(t *testing.T) {
	adapter, mock, closeDB := newRuntimeUpdateHookTestAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `items` SET `status` = \\?, `updated_by` = \\? WHERE `id` = \\?").
		WithArgs("completed", "u1", "7").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO hook_witness \(resource_id\) VALUES \(\?\)`).
		WithArgs("7").
		WillReturnError(errors.New("outbox unavailable"))
	mock.ExpectRollback()

	_, _, err := adapter.HandleRuntimeUpdateWithTxHook(
		context.Background(),
		http.MethodPut,
		"/v1/test/items/7",
		url.Values{"current_user": []string{"u1"}},
		map[string]any{"status": "completed"},
		func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
			if _, err := tx.ExecContext(ctx, "INSERT INTO hook_witness (resource_id) VALUES (?)", identifier); err != nil {
				return nil, err
			}
			return nil, nil
		},
	)
	if err == nil || err.Error() != "outbox unavailable" {
		t.Fatalf("error = %v, want outbox failure", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("resource update and hook failure must roll back together: %v", err)
	}
}
