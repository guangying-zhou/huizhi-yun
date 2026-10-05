package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestScopedLegacyReadsRejectServiceSubjectWithoutDelegatedActorBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	for _, check := range []struct {
		name      string
		path      string
		operation string
	}{
		{"department-cabinet-folders", "/v1/codocs/dept-cabinet/folders", "codocs.dept_cabinet.folders.list"},
		{"department-shares", "/v1/codocs/dept-shares", "codocs.dept_shares.list"},
	} {
		t.Run(check.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, check.path, url.Values{}, map[string]any{})
			if operation != check.operation {
				t.Fatalf("operation = %q, want %q", operation, check.operation)
			}
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusUnauthorized {
				t.Fatalf("error = %#v, want unsigned actor rejection", err)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unsigned generic replacement paths must not access storage: %v", err)
	}
}

func TestReviewTemplatesMovedToWorkflowBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/reviews/templates", url.Values{}, map[string]any{})
	if operation != "codocs.reviews.templates.removed" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusGone {
		t.Fatalf("error = %#v, want removed template contract", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("removed template contract must not access storage: %v", err)
	}
}

func TestDepartmentCabinetFoldersListBindsExactTrustedDepartmentBeforeSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedCabinetReadQuery("viewer")
	query.Set(codocsTrustedCabinetDepartmentReadQueryKey, "D1")
	query.Set("dept_code", "D2")
	query.Set("parent_id", "null")

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM cabinet_folders WHERE dept_code = \? AND parent_id IS NULL`).
		WithArgs("D1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id, name, parent_id, owner_uid, dept_code, sort_order, created_at, updated_at\s+FROM cabinet_folders\s+WHERE dept_code = \? AND parent_id IS NULL`).
		WithArgs("D1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "parent_id", "owner_uid", "dept_code", "sort_order", "created_at", "updated_at"}).
			AddRow(int64(1), "handover", nil, "manager", "D1", int64(0), "2026-07-11", "2026-07-11"))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/dept-cabinet/folders", query, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "codocs.dept_cabinet.folders.list" {
		t.Fatalf("operation = %q", operation)
	}
	data := result.(map[string]any)["data"].(map[string]any)
	if items := data["items"].([]map[string]any); len(items) != 1 || items[0]["dept_code"] != "D1" {
		t.Fatalf("items = %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestGenericCabinetFolderCRUDFailsClosedBeforeStorage(t *testing.T) {
	adapter := &Adapter{}
	for _, check := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/codocs/cabinet/folders"},
		{http.MethodPost, "/v1/codocs/cabinet/folders"},
		{http.MethodPatch, "/v1/codocs/cabinet/folders/7"},
		{http.MethodDelete, "/v1/codocs/cabinet/folders/7"},
		{http.MethodPost, "/v1/codocs/dept-cabinet/folders"},
		{http.MethodPatch, "/v1/codocs/dept-cabinet/folders/7"},
	} {
		_, operation, err := adapter.HandleRuntime(context.Background(), check.method, check.path, url.Values{}, map[string]any{})
		if operation != "codocs.cabinet_folders.contract_required" {
			t.Fatalf("%s %s operation = %q", check.method, check.path, operation)
		}
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "cabinet_folder_scope_contract_required" {
			t.Fatalf("%s %s error = %#v", check.method, check.path, err)
		}
	}
}

func TestDepartmentShareUpdateRejectsMissingManagerScopeBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"manager"}, "hzy_runtime_actor_delegated": {"1"}}
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/dept-shares/42", query, map[string]any{"status": "accepted"})
	if operation != "codocs.dept_shares.update" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_department_manager_required" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing manager marker must not access storage: %v", err)
	}
}
