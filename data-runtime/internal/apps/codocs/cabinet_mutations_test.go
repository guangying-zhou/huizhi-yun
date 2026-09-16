package codocs

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func trustedCabinetMutationQuery(actor string) url.Values {
	return url.Values{
		"current_user":                {actor},
		"hzy_runtime_actor_delegated": {"1"},
	}
}

func cabinetMutationBody() map[string]any {
	return map[string]any{
		"uuid":          "file-1",
		"filename":      "file.txt",
		"original_name": "file.txt",
		"file_ext":      "txt",
		"file_size":     int64(8),
		"oss_path":      "codocs/users/owner/cabinet/file-1.txt",
		"owner_uid":     "forged-owner",
		"dept_code":     "forged-dept",
		"project_code":  "forged-project",
	}
}

func TestCabinetMutationsRejectUnsignedActorAndMissingDepartmentManagerBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	for _, query := range []url.Values{
		{},
		{"current_user": {"owner"}},
		{"hzy_runtime_actor_delegated": {"1"}},
	} {
		if _, err := adapter.createCabinetFile(context.Background(), query, cabinetMutationBody(), false); err == nil {
			t.Fatalf("personal create accepted query %#v", query)
		}
	}
	if _, err := adapter.createCabinetFile(context.Background(), trustedCabinetMutationQuery("owner"), cabinetMutationBody(), true); err == nil {
		t.Fatal("department create accepted a missing manager marker")
	} else if httpErr, ok := err.(httperror.Error); !ok || httpErr.Code != "trusted_department_manager_required" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("untrusted cabinet mutations must not access storage: %v", err)
	}
}

func TestPersonalCabinetCreateForcesTrustedOwnerAndNullScopeColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	body := cabinetMutationBody()

	mock.ExpectExec("INSERT INTO cabinet_files").
		WithArgs("file-1", "file.txt", "file.txt", "txt", int64(8), "codocs/users/owner/cabinet/file-1.txt", "owner", nil, nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \?.*status = 1.*project_code IS NULL.*owner_uid = \?.*dept_code IS NULL`).
		WithArgs("file-1", "owner").
		WillReturnRows(cabinetFileRows().AddRow(
			int64(1), "file-1", "file.txt", "file.txt", "txt", int64(8), "codocs/users/owner/cabinet/file-1.txt", "owner", nil, nil, nil, nil, "2026-07-11", "2026-07-11",
		))

	result, err := adapter.createCabinetFile(context.Background(), trustedCabinetMutationQuery("owner"), body, false)
	if err != nil {
		t.Fatal(err)
	}
	if result["owner_uid"] != "owner" || result["dept_code"] != nil || result["project_code"] != nil {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDepartmentCabinetCreateUsesManagerMarkerAndRejectsForgedScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	body := cabinetMutationBody()
	body["oss_path"] = "codocs/departments/D1/cabinet/file-1.txt"
	query := trustedCabinetMutationQuery("manager")
	query.Set(codocsTrustedCabinetDepartmentManagerQueryKey, "D1")

	mock.ExpectExec("INSERT INTO cabinet_files").
		WithArgs("file-1", "file.txt", "file.txt", "txt", int64(8), "codocs/departments/D1/cabinet/file-1.txt", "manager", "D1", nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \?.*status = 1.*project_code IS NULL.*dept_code = \?`).
		WithArgs("file-1", "D1").
		WillReturnRows(cabinetFileRows().AddRow(
			int64(1), "file-1", "file.txt", "file.txt", "txt", int64(8), "codocs/departments/D1/cabinet/file-1.txt", "manager", "D1", nil, nil, nil, "2026-07-11", "2026-07-11",
		))

	result, err := adapter.createCabinetFile(context.Background(), query, body, true)
	if err != nil {
		t.Fatal(err)
	}
	if result["owner_uid"] != "manager" || result["dept_code"] != "D1" || result["project_code"] != nil {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCabinetPatchRejectsNonAllowlistedFieldsBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedCabinetMutationQuery("owner")

	for _, body := range []map[string]any{
		{"status": 0},
		{"owner_uid": "victim"},
		{"dept_code": "D2"},
		{"project_code": "P2"},
		{"converted_doc_uuid": "document-1"},
	} {
		if _, err := adapter.updateCabinetFile(context.Background(), "file-1", query, body, false); err == nil {
			t.Fatalf("patch accepted %#v", body)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unsupported patch fields must not access storage: %v", err)
	}
}

func TestCabinetDeleteAndConvertedDocumentKeepScopeInSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedCabinetMutationQuery("manager")
	query.Set(codocsTrustedCabinetDepartmentManagerQueryKey, "D1")

	mock.ExpectExec(`UPDATE cabinet_files SET status = 0, deleted_at = NOW\(\) WHERE uuid = \? AND deleted_at IS NULL AND status = 1 AND project_code IS NULL AND dept_code = \?`).
		WithArgs("file-1", "D1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	if _, err := adapter.deleteCabinetFile(context.Background(), "file-1", query, true); err != nil {
		t.Fatal(err)
	}

	mock.ExpectExec(`UPDATE cabinet_files SET converted_doc_uuid = \? WHERE uuid = \? AND deleted_at IS NULL AND status = 1 AND project_code IS NULL AND dept_code = \?`).
		WithArgs("document-1", "file-2", "D1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \?.*status = 1.*project_code IS NULL.*dept_code = \?`).
		WithArgs("file-2", "D1").
		WillReturnRows(cabinetFileRows().AddRow(
			int64(2), "file-2", "file.txt", "file.txt", "txt", int64(8), "codocs/departments/D1/cabinet/file-2.txt", "manager", "D1", nil, nil, "document-1", "2026-07-11", "2026-07-11",
		))
	if _, err := adapter.markCabinetFileConverted(context.Background(), "file-2", query, map[string]any{"converted_doc_uuid": "document-1"}, true); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
