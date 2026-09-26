package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestUpdateFolderOpenUpdatesDepartmentFolder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                               {"manager-1"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"D1"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	mock.ExpectQuery("SELECT dept_code\\s+FROM folders\\s+WHERE id = \\? AND folder_type = 'department'").
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("D1"))
	mock.ExpectExec("UPDATE folders\\s+SET is_open = \\?, updated_at = NOW\\(\\)\\s+WHERE id = \\? AND folder_type = 'department' AND dept_code = \\?").
		WithArgs(1, "42", "D1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.updateFolderOpen(context.Background(), "42", query, map[string]any{
		"is_open": true,
	})
	if err != nil {
		t.Fatalf("updateFolderOpen returned error: %v", err)
	}
	if got := int64Value(result["id"]); got != 42 {
		t.Fatalf("id = %d, want 42", got)
	}
	if got := int64Value(result["is_open"]); got != 1 {
		t.Fatalf("is_open = %d, want 1", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestUpdateFolderOpenRejectsNonDepartmentFolder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                               {"manager-1"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"D1"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	mock.ExpectQuery("SELECT dept_code\\s+FROM folders\\s+WHERE id = \\? AND folder_type = 'department'").
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}))

	if _, err := adapter.updateFolderOpen(context.Background(), "42", query, map[string]any{
		"isOpen": true,
	}); err == nil {
		t.Fatal("updateFolderOpen should reject folders outside department type")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestUpdateFolderOpenRejectsDepartmentMarkerForAnotherFolderDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                               {"manager-1"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"D1"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	mock.ExpectQuery("SELECT dept_code\\s+FROM folders\\s+WHERE id = \\? AND folder_type = 'department'").
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("D2"))

	_, err = adapter.updateFolderOpen(context.Background(), "42", query, map[string]any{"is_open": true})
	if err == nil {
		t.Fatal("updateFolderOpen should reject a trusted marker for another department")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "folder_department_scope_mismatch" {
		t.Fatalf("error = %#v, want forbidden folder_department_scope_mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("department mismatch must not update storage: %v", err)
	}
}

func TestFolderReadsAndOpenMutationRejectUnsignedActorsBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"untrusted-user"}}
	if _, err := adapter.foldersList(context.Background(), query); err == nil {
		t.Fatal("folder list must require signed actor delegation")
	}
	if _, err := adapter.updateFolderOpen(context.Background(), "42", query, map[string]any{"is_open": true}); err == nil {
		t.Fatal("folder open mutation must require signed actor delegation")
	}
	if _, err := adapter.openDepartmentDocuments(context.Background(), query); err == nil {
		t.Fatal("open department document reads must require signed actor delegation")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unsigned folder operations must not query storage: %v", err)
	}
}

func TestVisibleOpenDepartmentFoldersSupportsUnsignedDatabaseIDs(t *testing.T) {
	folders := []map[string]any{
		{
			"id":          uint64(91),
			"name":        "Open root",
			"dept_code":   "GMO",
			"parent_id":   nil,
			"is_open":     int64(1),
			"folder_type": "department",
		},
		{
			"id":          uint64(92),
			"name":        "Open descendant",
			"dept_code":   "GMO",
			"parent_id":   uint64(91),
			"is_open":     int64(0),
			"folder_type": "department",
		},
	}

	visible, ids := visibleOpenDepartmentFolders(folders)
	if len(visible) != 2 {
		t.Fatalf("visible folders = %#v, want open root and descendant", visible)
	}
	if len(ids) != 2 || ids[0] != 91 || ids[1] != 92 {
		t.Fatalf("visible folder ids = %v, want [91 92]", ids)
	}
}

func TestOpenDepartmentDocumentsReturnsOnlyOpenFolderSubtrees(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                {"viewer-1"},
		"hzy_runtime_actor_delegated": {"1"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	folderColumns := []string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id", "sort_order", "is_open", "created_at", "updated_at"}
	mock.ExpectQuery("(?s)SELECT id, name, folder_type, owner_uid, dept_code, project_code,.*FROM folders.*WHERE folder_type = 'department'").
		WillReturnRows(sqlmock.NewRows(folderColumns).
			AddRow(1, "D1 closed root", "department", nil, "D1", nil, nil, 1, 0, nil, nil).
			AddRow(2, "D1 open child", "department", nil, "D1", nil, 1, 2, 1, nil, nil).
			AddRow(3, "D1 descendant", "department", nil, "D1", nil, 2, 3, 0, nil, nil).
			AddRow(4, "D2 closed", "department", nil, "D2", nil, nil, 4, 0, nil, nil).
			AddRow(5, "D2 open", "department", nil, "D2", nil, nil, 5, 1, nil, nil).
			AddRow(6, "cross-department child", "department", nil, "D3", nil, 5, 6, 0, nil, nil))
	documentColumns := []string{
		"id", "uuid", "title", "doc_type", "oss_path", "owner_uid", "dept_code", "project_code", "folder_id",
		"content_size", "last_editor_uid", "status", "star_flag", "home_flag", "readonly_flag", "publish_info",
		"ai_abstract", "created_at", "updated_at", "folder_name",
	}
	mock.ExpectQuery("(?s)SELECT d\\.id, d\\.uuid, d\\.title, d\\.doc_type, d\\.oss_path, d\\.owner_uid,.*d\\.folder_id IN \\(\\?,\\?,\\?\\).*").
		WithArgs(int64(2), int64(3), int64(5)).
		WillReturnRows(sqlmock.NewRows(documentColumns).
			AddRow(11, "doc-open", "Open document", "department", "codocs/departments/D1/doc-open.md", "owner-1", "D1", nil, 3, 10, nil, 1, 0, 0, 0, nil, nil, nil, nil, "D1 descendant"))

	result, err := adapter.openDepartmentDocuments(context.Background(), query)
	if err != nil {
		t.Fatalf("openDepartmentDocuments returned error: %v", err)
	}
	folders, ok := result["folders"].([]map[string]any)
	if !ok {
		t.Fatalf("folders type = %T, want []map[string]any", result["folders"])
	}
	if len(folders) != 3 {
		t.Fatalf("visible folders = %#v, want 3 folders", folders)
	}
	if got := []int64{int64Value(folders[0]["id"]), int64Value(folders[1]["id"]), int64Value(folders[2]["id"])}; got[0] != 2 || got[1] != 3 || got[2] != 5 {
		t.Fatalf("visible folder ids = %v, want [2 3 5]", got)
	}
	documents, ok := result["documents"].([]map[string]any)
	if !ok {
		t.Fatalf("documents type = %T, want []map[string]any", result["documents"])
	}
	if len(documents) != 1 || stringValue(documents[0]["uuid"]) != "doc-open" {
		t.Fatalf("documents = %#v, want doc-open", documents)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestOpenDepartmentDocumentsBindsUUIDInsideVisibleFolders(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                {"viewer-1"},
		"hzy_runtime_actor_delegated": {"1"},
		"uuid":                        {"doc-open"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	folderColumns := []string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id", "sort_order", "is_open", "created_at", "updated_at"}
	mock.ExpectQuery("(?s)SELECT id, name, folder_type, owner_uid, dept_code, project_code,.*FROM folders.*WHERE folder_type = 'department'").
		WillReturnRows(sqlmock.NewRows(folderColumns).
			AddRow(8, "Open", "department", nil, "D1", nil, nil, 1, 1, nil, nil))
	documentColumns := []string{
		"id", "uuid", "title", "doc_type", "oss_path", "owner_uid", "dept_code", "project_code", "folder_id",
		"content_size", "last_editor_uid", "status", "star_flag", "home_flag", "readonly_flag", "publish_info",
		"ai_abstract", "created_at", "updated_at", "folder_name",
	}
	mock.ExpectQuery("(?s)d\\.folder_id IN \\(\\?\\).*d\\.uuid = \\?").
		WithArgs(int64(8), "doc-open").
		WillReturnRows(sqlmock.NewRows(documentColumns))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/open-department-documents", query, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.open_department_documents.list" {
		t.Fatalf("operation = %q", operation)
	}
	if result == nil {
		t.Fatal("result must not be nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCreatePrivateFolderBindsOwnerToTrustedActor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                {"owner-1"},
		"hzy_runtime_actor_delegated": {"1"},
	}
	mock.ExpectExec("INSERT INTO folders").
		WithArgs("测试", "private", "owner-1", nil, nil, nil, 0).
		WillReturnResult(sqlmock.NewResult(51, 1))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/folders", query, map[string]any{
		"name":         " 测试 ",
		"folder_type":  "private",
		"owner_uid":    "spoofed-owner",
		"dept_code":    "spoofed-department",
		"project_code": "spoofed-project",
	})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.folders.create" {
		t.Fatalf("operation = %q", operation)
	}
	envelope := result.(map[string]any)
	data := envelope["data"].(map[string]any)
	if data["id"] != int64(51) || data["owner_uid"] != "owner-1" || data["folder_type"] != "private" {
		t.Fatalf("data = %#v", data)
	}
	if data["dept_code"] != nil || data["project_code"] != nil {
		t.Fatalf("private folder leaked caller namespace: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCreateDepartmentFolderRequiresExactTrustedManagerScope(t *testing.T) {
	adapter := &Adapter{}
	query := url.Values{
		"current_user":                               {"manager-1"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"D1"},
	}
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/folders", query, map[string]any{
		"name":        "部门目录",
		"folder_type": "department",
		"dept_code":   "D2",
	})
	if operation != "codocs.folders.create" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "folder_department_scope_mismatch" {
		t.Fatalf("error = %#v, want folder_department_scope_mismatch", err)
	}
}

func TestCreateDepartmentFolderAcceptsLegacyParentOwnerWithinSameDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                               {"caoqian"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"RD"},
	}
	mock.ExpectQuery("(?s)SELECT folder_type, owner_uid, dept_code, project_code.*FROM folders.*WHERE id = \\?").
		WithArgs(int64(35)).
		WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).
			AddRow("department", "caoqian", "RD", nil))
	mock.ExpectExec("INSERT INTO folders").
		WithArgs("2026年7月", "department", nil, "RD", nil, int64(35), 0).
		WillReturnResult(sqlmock.NewResult(95, 1))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/folders", query, map[string]any{
		"name":        "2026年7月",
		"folder_type": "department",
		"dept_code":   "RD",
		"parent_id":   35,
	})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.folders.create" {
		t.Fatalf("operation = %q", operation)
	}
	data := result.(map[string]any)["data"].(map[string]any)
	if data["id"] != int64(95) || data["dept_code"] != "RD" || data["parent_id"] != int64(35) {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCreateDepartmentFolderStillRejectsParentFromAnotherDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                               {"caoqian"},
		"hzy_runtime_actor_delegated":                {"1"},
		"codocs_trusted_department_manage_dept_code": {"RD"},
	}
	mock.ExpectQuery("(?s)SELECT folder_type, owner_uid, dept_code, project_code.*FROM folders.*WHERE id = \\?").
		WithArgs(int64(56)).
		WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).
			AddRow("department", "renjianwei", "HFZX", nil))

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/folders", query, map[string]any{
		"name":        "不应创建",
		"folder_type": "department",
		"dept_code":   "RD",
		"parent_id":   56,
	})
	if operation != "codocs.folders.create" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "folder_parent_scope_mismatch" {
		t.Fatalf("error = %#v, want folder_parent_scope_mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCreatePrivateFolderStillRejectsParentOwnedByAnotherUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                {"caoqian"},
		"hzy_runtime_actor_delegated": {"1"},
	}
	mock.ExpectQuery("(?s)SELECT folder_type, owner_uid, dept_code, project_code.*FROM folders.*WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).
			AddRow("private", "another-user", nil, nil))

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/folders", query, map[string]any{
		"name":        "不应创建",
		"folder_type": "private",
		"parent_id":   77,
	})
	if operation != "codocs.folders.create" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "folder_parent_scope_mismatch" {
		t.Fatalf("error = %#v, want folder_parent_scope_mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestScopedFolderDetailAndMutationsRejectMissingActorBeforeStorage(t *testing.T) {
	adapter := &Adapter{}
	for _, check := range []struct {
		name   string
		method string
		path   string
	}{
		{"detail", "GET", "/v1/codocs/folders/42"},
		{"update", "PATCH", "/v1/codocs/folders/42"},
		{"delete", "DELETE", "/v1/codocs/folders/42"},
	} {
		t.Run(check.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), check.method, check.path, url.Values{}, map[string]any{})
			if err == nil {
				t.Fatal("generic folder route must fail closed")
			}
			if operation != "codocs.folders.scoped" {
				t.Fatalf("operation = %q, want scoped folder audit operation", operation)
			}
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusUnauthorized || httpErr.Code != "current_user_required" {
				t.Fatalf("error = %#v, want 401 current_user_required", err)
			}
		})
	}
}

func TestFoldersListBindsExactTrustedDepartmentMarkerInSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"current_user":                      {"viewer-1"},
		"hzy_runtime_actor_delegated":       {"1"},
		codocsTrustedDepartmentReadQueryKey: {"D1"},
		"project_code":                      {"P1"},
		"folder_type":                       {"department"},
	}
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	visibilitySQL := "(?s)SELECT COUNT\\(\\*\\) FROM folders WHERE .*folder_type = 'private'.*owner_uid = \\?.*folder_type = 'department'.*dept_code = \\?.*folder_type = \\?.*project_code = \\?"
	mock.ExpectQuery(visibilitySQL).
		WithArgs("viewer-1", "D1", "department", "P1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery("(?s)SELECT id, name, folder_type, owner_uid, dept_code, project_code,.*FROM folders.*folder_type = 'private'.*owner_uid = \\?.*folder_type = 'department'.*dept_code = \\?.*folder_type = \\?.*project_code = \\?.*LIMIT \\? OFFSET \\?").
		WithArgs("viewer-1", "D1", "department", "P1", 5000, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id", "sort_order", "is_open", "created_at", "updated_at"}))

	result, err := adapter.foldersList(context.Background(), query)
	if err != nil {
		t.Fatalf("foldersList returned error: %v", err)
	}
	if total := result["total"]; total != int64(0) {
		t.Fatalf("total = %#v, want 0", total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("trusted department marker must be bound to folder SQL: %v", err)
	}
}

func TestDocumentsListFiltersByUUID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\) FROM documents d WHERE d\\.status = 1 AND \\(.*d\\.owner_uid = \\?.*document_shares visible_share.*document_relations visible_relation.*AND d\\.uuid = \\?").
		WithArgs("viewer-open", "viewer-open", "viewer-open", "doc-open").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery("(?s)SELECT .*FROM documents d\\s+LEFT JOIN folders f ON d\\.folder_id = f\\.id\\s+WHERE d\\.status = 1 AND \\(.*d\\.owner_uid = \\?.*document_shares visible_share.*document_relations visible_relation.*AND d\\.uuid = \\?.*LIMIT \\? OFFSET \\?").
		WithArgs("viewer-open", "viewer-open", "viewer-open", "doc-open", 5000, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"uuid",
			"title",
			"doc_type",
			"oss_path",
			"owner_uid",
			"dept_code",
			"project_code",
			"folder_id",
			"content_size",
			"last_editor_uid",
			"created_at",
			"updated_at",
			"star_flag",
			"home_flag",
			"readonly_flag",
			"publish_info",
			"folder_name",
		}).AddRow(
			1,
			"doc-open",
			"Open Doc",
			"department",
			"codocs/departments/D1/docs/Open Doc.md",
			"u1",
			"D1",
			nil,
			42,
			100,
			nil,
			"2026-07-02 10:00:00",
			"2026-07-02 10:00:00",
			0,
			0,
			0,
			nil,
			"Open Folder",
		))

	result, err := adapter.documentsList(context.Background(), url.Values{"uuid": {"doc-open"}, "current_user": {"viewer-open"}, "hzy_runtime_actor_delegated": {"1"}})
	if err != nil {
		t.Fatalf("documentsList returned error: %v", err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v, want one document", result["items"])
	}
	if got := stringValue(items[0]["uuid"]); got != "doc-open" {
		t.Fatalf("uuid = %q, want doc-open", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
