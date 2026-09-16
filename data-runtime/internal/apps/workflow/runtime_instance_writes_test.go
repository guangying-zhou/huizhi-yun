package workflow

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestHandleRuntimeInstanceWritesKeepPostRouteAndActorBoundary(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	for _, path := range []string{
		"/v1/workflow/instances/42/cancel",
		"/v1/workflow/instances/42/resubmit",
	} {
		response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, path, url.Values{}, nil)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusUnauthorized || httpErr.Code != "missing_current_user" || operation != "" || response.Code != 0 {
			t.Fatalf("path=%q operation=%q response=%+v err=%v", path, operation, response, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeInstanceCancelKeepsTransactionAndNotFoundEnvelope(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM flow_instances WHERE id = \? FOR UPDATE`).
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectRollback()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/workflow/instances/42/cancel",
		url.Values{},
		map[string]any{"current_user": "u-1"},
	)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusNotFound || httpErr.Code != "instance_not_found" || operation != "" || response.Code != 0 {
		t.Fatalf("operation=%q response=%+v err=%v", operation, response, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
