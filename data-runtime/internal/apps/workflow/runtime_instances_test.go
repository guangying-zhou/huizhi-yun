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

func TestHandleRuntimeInstanceByBizKeepsDelegatedLookupContract(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT id, instance_no, app_code, resource_code, action_code,.*FROM flow_instances.*status IN \('running', 'suspended'\).*ORDER BY id DESC LIMIT 1`).
		WithArgs("aims", "projects", "P-1", "initiate", "u-1", "u-1", "u-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	query := url.Values{
		"current_user":                {"u-1"},
		"hzy_runtime_actor_delegated": {"1"},
		"app_code":                    {"aims"},
		"resource_code":               {"projects"},
		"biz_id":                      {"P-1"},
		"action_code":                 {"initiate"},
	}
	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/instances/by-biz", query, nil)
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "workflow.instances.by_biz" || response.Code != 0 || response.Data != nil {
		t.Fatalf("operation=%q response=%+v", operation, response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeInstanceBusinessRouteKeepsTrustedActorGuard(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/instances/by-biz-history", url.Values{"current_user": {"u-1"}}, nil)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_workflow_actor_required" || operation != "" {
		t.Fatalf("operation=%q err=%v", operation, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeInstanceUnknownNestedPathKeepsNotFoundEnvelope(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/instances/42/events", url.Values{}, nil)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusNotFound || httpErr.Code != "not_found" || operation != "" || response.Code != 0 {
		t.Fatalf("operation=%q response=%+v err=%v", operation, response, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
