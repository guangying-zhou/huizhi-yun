package workflow

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func newWorkflowRuntimeSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return &Adapter{db: db}, mock, func() { _ = db.Close() }
}

func TestHandleRuntimeAdminActionDefsPreservesListEnvelopeAndOperation(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`SELECT COUNT\(\*\) AS total FROM flow_action_defs a`).
		WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(int64(1)))
	mock.ExpectQuery(`(?s)SELECT a\.\*, f\.code AS form_code, f\.name AS form_name`).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "app_code", "resource_code", "action_code", "name", "status"}).
			AddRow(int64(9), "aims", "projects", "initiate", "立项", int64(1)))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/admin/action-defs", url.Values{}, nil)
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "workflow.admin.action_defs.list" || response.Code != 0 {
		t.Fatalf("operation=%q response=%+v", operation, response)
	}
	data, ok := response.Data.(map[string]any)
	if !ok || data["total"] != int64(1) || data["page"] != 1 || data["page_size"] != 20 {
		t.Fatalf("unexpected envelope: %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeAdminTemplatesRemainBeforeGenericFlowSchemaDetail(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT id, code, name, description, nodes, config.*FROM flow_schemas.*WHERE is_template = 1 AND status = 1`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "description", "nodes", "config"}).
			AddRow(int64(7), "two-step", "两级审批", nil, `[{"type":"approval"}]`, `{}`))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/admin/flow-schemas/templates", url.Values{}, nil)
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "workflow.admin.flow_schemas.templates" || response.Code != 0 {
		t.Fatalf("operation=%q response=%+v", operation, response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeAdminUnknownPathKeepsNotFoundEnvelope(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/workflow/admin/unknown", url.Values{}, nil)
	if err == nil || operation != "" || response.Code != 0 {
		t.Fatalf("response=%+v operation=%q err=%v", response, operation, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
