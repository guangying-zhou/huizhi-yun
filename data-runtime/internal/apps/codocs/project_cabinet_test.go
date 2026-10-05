package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func projectCabinetFileRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"uuid",
		"filename",
		"original_name",
		"file_ext",
		"file_size",
		"oss_path",
		"owner_uid",
		"dept_code",
		"project_code",
		"folder_id",
		"converted_doc_uuid",
		"created_at",
		"updated_at",
	})
}

func TestProjectCabinetRuntimeRoutesKeepOperationsAndEnvelopes(t *testing.T) {
	t.Run("PATCH and PUT fail closed before database access", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		for _, method := range []string{http.MethodPatch, http.MethodPut} {
			_, operation, err := adapter.HandleRuntime(context.Background(), method, "/v1/codocs/project-cabinet/project-file", url.Values{}, map[string]any{"status": 0})
			if operation != "codocs.project_cabinet.contract_required" {
				t.Fatalf("%s operation = %q", method, operation)
			}
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "project_cabinet_mutation_contract_required" {
				t.Fatalf("%s error = %#v", method, err)
			}
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("project mutations must not access storage: %v", err)
		}
	})

	t.Run("list rejects a browser supplied project before database access", func(t *testing.T) {
		adapter := &Adapter{}
		response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/project-cabinet", url.Values{}, nil)
		if err == nil {
			t.Fatal("project cabinet list accepted an unsigned project_code")
		}
		if operation != "codocs.project_cabinet.list" {
			t.Fatalf("operation = %q", operation)
		}
		envelope, ok := response.(map[string]any)
		if !ok || envelope["success"] != true {
			t.Fatalf("response envelope = %#v", response)
		}
	})

	t.Run("detail preserves project-bound query", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \? AND project_code = \?.*LIMIT 1`).
			WithArgs("project-file", "PRJ001").
			WillReturnRows(projectCabinetFileRows().AddRow(
				int64(1), "project-file", "plan.pdf", "plan.pdf", "pdf", int64(123), "codocs/projects/PRJ001/cabinet/plan.pdf",
				"uploader", nil, "PRJ001", nil, nil, "2026-07-11", "2026-07-11",
			))

		response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/project-cabinet/project-file", url.Values{codocsTrustedProjectCabinetQueryKey: {"PRJ001"}}, nil)
		if err != nil {
			t.Fatalf("project cabinet detail returned error: %v", err)
		}
		if operation != "codocs.project_cabinet.get" {
			t.Fatalf("operation = %q", operation)
		}
		envelope := response.(map[string]any)
		data := envelope["data"].(map[string]any)
		if envelope["success"] != true || data["project_code"] != "PRJ001" {
			t.Fatalf("response envelope = %#v", response)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet SQL expectations: %v", err)
		}
	})

	t.Run("create preserves detail lookup", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		mock.ExpectExec("INSERT INTO cabinet_files").
			WithArgs("new-file", "proposal.pdf", "proposal.pdf", "pdf", int64(123), "codocs/projects/PRJ001/cabinet/new-file.pdf", "uploader", nil, "PRJ001", nil).
			WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \? AND project_code = \?.*LIMIT 1`).
			WithArgs("new-file", "PRJ001").
			WillReturnRows(projectCabinetFileRows().AddRow(
				int64(2), "new-file", "proposal.pdf", "proposal.pdf", "pdf", int64(123), "codocs/projects/PRJ001/cabinet/new-file.pdf",
				"uploader", nil, "PRJ001", nil, nil, "2026-07-11", "2026-07-11",
			))

		response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/project-cabinet", url.Values{codocsTrustedProjectCabinetQueryKey: {"PRJ001"}}, map[string]any{
			"uuid":          "new-file",
			"filename":      "proposal.pdf",
			"original_name": "proposal.pdf",
			"file_ext":      "pdf",
			"file_size":     int64(123),
			"oss_path":      "codocs/projects/PRJ001/cabinet/new-file.pdf",
			"owner_uid":     "uploader",
			"project_code":  "PRJ001",
		})
		if err != nil {
			t.Fatalf("project cabinet create returned error: %v", err)
		}
		if operation != "codocs.project_cabinet.create" {
			t.Fatalf("operation = %q", operation)
		}
		envelope := response.(map[string]any)
		data := envelope["data"].(map[string]any)
		if envelope["success"] != true || data["uuid"] != "new-file" {
			t.Fatalf("response envelope = %#v", response)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet SQL expectations: %v", err)
		}
	})
}

func TestCreateProjectCabinetFilePersistsProjectCode(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectExec("INSERT INTO cabinet_files").
		WithArgs(
			"file-uuid",
			"proposal.pdf",
			"proposal.pdf",
			"pdf",
			int64(123),
			"codocs/projects/PRJ001/cabinet/file-uuid.pdf",
			"uploader",
			nil,
			"PRJ001",
			nil,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT id, uuid, filename, original_name").
		WithArgs("file-uuid", "PRJ001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"uuid",
			"filename",
			"original_name",
			"file_ext",
			"file_size",
			"oss_path",
			"owner_uid",
			"dept_code",
			"project_code",
			"folder_id",
			"converted_doc_uuid",
			"created_at",
			"updated_at",
		}).AddRow(
			int64(1),
			"file-uuid",
			"proposal.pdf",
			"proposal.pdf",
			"pdf",
			int64(123),
			"codocs/projects/PRJ001/cabinet/file-uuid.pdf",
			"uploader",
			nil,
			"PRJ001",
			nil,
			nil,
			"2026-06-28 10:00:00",
			"2026-06-28 10:00:00",
		))

	result, err := adapter.createProjectCabinetFile(context.Background(), url.Values{codocsTrustedProjectCabinetQueryKey: {"PRJ001"}}, map[string]any{
		"uuid":          "file-uuid",
		"filename":      "proposal.pdf",
		"original_name": "proposal.pdf",
		"file_ext":      "pdf",
		"file_size":     int64(123),
		"oss_path":      "codocs/projects/PRJ001/cabinet/file-uuid.pdf",
		"owner_uid":     "uploader",
		"project_code":  "PRJ001",
	})
	if err != nil {
		t.Fatalf("createProjectCabinetFile returned error: %v", err)
	}
	if result["project_code"] != "PRJ001" {
		t.Fatalf("project_code = %#v, want PRJ001", result["project_code"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestProjectCabinetDeleteRequiresLockedExpectedPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{codocsTrustedProjectCabinetQueryKey: {"PRJ001"}}
	body := map[string]any{"expected_oss_path": "codocs/projects/PRJ001/cabinet/file-uuid.pdf"}

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT oss_path FROM cabinet_files WHERE uuid = \? AND project_code = \? AND deleted_at IS NULL AND status = 1 FOR UPDATE`).
		WithArgs("file-uuid", "PRJ001").
		WillReturnRows(sqlmock.NewRows([]string{"oss_path"}).AddRow("codocs/projects/PRJ001/cabinet/file-uuid.pdf"))
	mock.ExpectExec(`UPDATE cabinet_files SET status = 0, deleted_at = NOW\(\) WHERE uuid = \? AND project_code = \? AND deleted_at IS NULL AND status = 1`).
		WithArgs("file-uuid", "PRJ001").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodDelete, "/v1/codocs/project-cabinet/file-uuid", query, body)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if operation != "codocs.project_cabinet.delete" || result.(map[string]any)["success"] != true {
		t.Fatalf("result = %#v, operation = %s", result, operation)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectCabinetRejectsUnsignedScopeAndTamperedOSSPath(t *testing.T) {
	adapter := &Adapter{}
	_, _, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/project-cabinet/file-uuid", url.Values{"project_code": {"PRJ001"}}, nil)
	if err == nil {
		t.Fatal("accepted browser supplied project_code")
	}

	_, _, err = adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/project-cabinet", url.Values{codocsTrustedProjectCabinetQueryKey: {"PRJ001"}}, map[string]any{
		"uuid": "file-uuid", "filename": "plan.pdf", "original_name": "plan.pdf", "file_ext": "pdf", "oss_path": "codocs/projects/OTHER/cabinet/file-uuid.pdf", "owner_uid": "audit-user",
	})
	if err == nil {
		t.Fatal("accepted cross-project oss_path")
	}
}
