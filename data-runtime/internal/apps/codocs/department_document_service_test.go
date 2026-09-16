package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func departmentDocumentServiceQuery() url.Values {
	return url.Values{
		"current_user":                {"reader-uid"},
		"hzy_runtime_actor_delegated": {"1"},
		"hzy_runtime_actor_purpose":   {"service-command"},
	}
}

func departmentDocumentServiceBody(deptCode string) map[string]any {
	return map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-1",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "CODOCS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "codocs",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"targetApp":            "codocs",
			"operationCode":        aimsDepartmentDocumentsListOperation,
			"requiredCapability":   aimsDepartmentDocumentsListCapability,
			"commandSchemaVersion": aimsDepartmentDocumentsListSchema,
			"command": map[string]any{
				"actorUid": "reader-uid",
				"deptCode": deptCode,
				"pageSize": 100,
				"action":   "list",
			},
		},
	}
}

func TestDepartmentDocumentServiceRejectsUntrustedSourceBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	body := departmentDocumentServiceBody("GMO")
	body[integrationoperation.TrustedServiceCommandSourceClientKey] = "aims"
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/department-documents/search", departmentDocumentServiceQuery(), body)
	if operation != "codocs.service.department_documents.list" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "department_documents_service_command_invalid" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("invalid command must not access storage: %v", err)
	}
}

func TestDepartmentDocumentServiceListsOnlySignedDepartmentScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	visibility := `(?s)d\.status = 1.*d\.owner_uid = \?.*document_shares visible_share.*document_relations visible_relation.*d\.doc_type = 'department' AND d\.dept_code = \?.*d\.doc_type = \?.*d\.dept_code = \?`
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents d WHERE `+visibility).
		WithArgs("reader-uid", "reader-uid", "reader-uid", "GMO", "department", "GMO").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT d\.id, d\.uuid.*FROM documents d.*WHERE `+visibility).
		WithArgs("reader-uid", "reader-uid", "reader-uid", "GMO", "department", "GMO", 100, 0).
		WillReturnRows(emptyDocumentListRows())
	mock.ExpectQuery("SELECT COLUMN_NAME\\s+FROM information_schema\\.COLUMNS").
		WithArgs("folders", "is_open").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("is_open"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM folders WHERE .*folder_type = 'department' AND dept_code = \?.*folder_type = \?.*dept_code = \?`).
		WithArgs("reader-uid", "GMO", "department", "GMO").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT id, name, folder_type.*FROM folders.*folder_type = 'department' AND dept_code = \?.*folder_type = \?.*dept_code = \?`).
		WithArgs("reader-uid", "GMO", "department", "GMO", 100, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id", "sort_order", "is_open", "created_at", "updated_at"}))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/department-documents/search", departmentDocumentServiceQuery(), departmentDocumentServiceBody("GMO"))
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "codocs.service.department_documents.list" {
		t.Fatalf("operation = %q", operation)
	}
	data := result.(map[string]any)["data"].(map[string]any)
	if data["deptCode"] != "GMO" {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
