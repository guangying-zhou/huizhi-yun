package codocs

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func trustedCabinetReadQuery(actor string) url.Values {
	return url.Values{
		"current_user":                {actor},
		"hzy_runtime_actor_delegated": {"1"},
	}
}

func cabinetFileRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "uuid", "filename", "original_name", "file_ext", "file_size", "oss_path",
		"owner_uid", "dept_code", "project_code", "folder_id", "converted_doc_uuid", "created_at", "updated_at",
	})
}

func TestCabinetListRejectsMissingOrUndelegatedActorBeforeDatabaseRead(t *testing.T) {
	adapter := &Adapter{}
	for _, query := range []url.Values{
		{},
		{"current_user": {"viewer"}},
		{"hzy_runtime_actor_delegated": {"1"}},
	} {
		if _, err := adapter.cabinetList(context.Background(), query, false); err == nil {
			t.Fatalf("cabinetList accepted untrusted query %#v", query)
		}
	}
}

func TestCabinetListBindsPersonalScopeToTrustedActorAndIgnoresBrowserOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := trustedCabinetReadQuery("viewer")
	query.Set("owner_uid", "victim")
	query.Set("folder_id", "null")
	visibility := `owner_uid = \?.*dept_code IS NULL.*project_code IS NULL.*folder_id IS NULL`
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM cabinet_files WHERE .*` + visibility).
		WithArgs("viewer").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*`+visibility+`.*LIMIT \? OFFSET \?`).
		WithArgs("viewer", 5000, 0).
		WillReturnRows(cabinetFileRows().AddRow(
			int64(1), "personal-file", "mine.txt", "mine.txt", "txt", int64(1), "codocs/users/viewer/cabinet/personal-file.txt",
			"viewer", nil, nil, nil, nil, "2026-07-11", "2026-07-11",
		))

	result, err := adapter.cabinetList(context.Background(), query, false)
	if err != nil {
		t.Fatalf("cabinetList returned error: %v", err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["owner_uid"] != "viewer" {
		t.Fatalf("personal cabinet result = %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestDepartmentCabinetListRequiresTargetBoundDepartmentScope(t *testing.T) {
	adapter := &Adapter{}
	if _, err := adapter.cabinetList(context.Background(), trustedCabinetReadQuery("viewer"), true); err == nil {
		t.Fatal("department cabinet list accepted a missing trusted department scope")
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter = &Adapter{db: db}
	query := trustedCabinetReadQuery("viewer")
	query.Set(codocsTrustedCabinetDepartmentReadQueryKey, "D1")
	query.Set("dept_code", "D2")
	query.Set("folder_id", "null")
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM cabinet_files WHERE .*dept_code = \?.*folder_id IS NULL`).
		WithArgs("D1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*dept_code = \?.*folder_id IS NULL.*LIMIT \? OFFSET \?`).
		WithArgs("D1", 5000, 0).
		WillReturnRows(cabinetFileRows())

	if _, err := adapter.cabinetList(context.Background(), query, true); err != nil {
		t.Fatalf("cabinetList returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestCabinetFileScopePredicateRejectsCrossOwnerAndUsesExactDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	personal := trustedCabinetReadQuery("viewer")
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*uuid = \?.*owner_uid = \?.*dept_code IS NULL.*project_code IS NULL`).
		WithArgs("victim-file", "viewer").
		WillReturnRows(cabinetFileRows())
	if _, err := adapter.cabinetFile(context.Background(), "victim-file", personal, false); err == nil {
		t.Fatal("personal cabinet detail accepted a cross-owner record")
	}

	department := trustedCabinetReadQuery("viewer")
	department.Set(codocsTrustedCabinetDepartmentReadQueryKey, "D1")
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*uuid = \?.*dept_code = \?.*LIMIT 1`).
		WithArgs("department-file", "D1").
		WillReturnRows(cabinetFileRows().AddRow(
			int64(2), "department-file", "policy.pdf", "policy.pdf", "pdf", int64(2), "codocs/departments/D1/cabinet/policy.pdf",
			"owner", "D1", nil, nil, nil, "2026-07-11", "2026-07-11",
		))
	result, err := adapter.cabinetFile(context.Background(), "department-file", department, true)
	if err != nil {
		t.Fatalf("department cabinet detail returned error: %v", err)
	}
	if got := result["dept_code"]; got != "D1" {
		t.Fatalf("dept_code = %#v, want D1", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestTrustedCabinetReadContextDoesNotTreatBrowserScopeValuesAsAuthority(t *testing.T) {
	query := url.Values{
		"current_user": {"viewer"},
		"owner_uid":    {"victim"},
		"dept_code":    {"D2"},
	}
	if _, _, err := requireTrustedCabinetReadContext(query, false); err == nil || !strings.Contains(err.Error(), "Trusted runtime actor") {
		t.Fatalf("context error = %v, want trusted actor rejection", err)
	}
}
