package codocs

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"regexp"
	"testing"
)

func TestProductDocumentMetadataUsesCodocsACL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	body := projectDocumentServiceBody("00000000-0000-4000-8000-000000000001", "PRJ-1")
	if _, err = adapter.productDocumentServiceMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body); err == nil {
		t.Fatal("project contract accepted as product contract")
	}
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentReadOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	envelope["commandSchemaVersion"] = aimsProductDocumentReadSchema
	command := envelope["command"].(map[string]any)
	delete(command, "projectCode")
	command["productCode"] = "P-1"
	command["action"] = "metadata:read"
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("00000000-0000-4000-8000-000000000001").WillReturnRows(projectDocumentServiceReadRows("00000000-0000-4000-8000-000000000001", "PRJ-1"))
	result, err := adapter.productDocumentServiceMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body)
	if err != nil || result["uuid"] != "00000000-0000-4000-8000-000000000001" || result["title"] != "Project requirement" || len(result) != 4 {
		t.Fatalf("metadata %+v %v", result, err)
	}
	for _, key := range []string{"ossPath", "oss_path", "owner_uid", "content", "project_code"} {
		if _, ok := result[key]; ok {
			t.Fatalf("internal field leaked %s", key)
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDocumentMetadataRechecksSharesAndIgnoresDepartmentHints(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	body := projectDocumentServiceBody("00000000-0000-4000-8000-000000000001", "ignored")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentReadOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	envelope["commandSchemaVersion"] = aimsProductDocumentReadSchema
	envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P-1", "documentUuid": "00000000-0000-4000-8000-000000000001", "action": "metadata:read"}
	query := productDocumentServiceQuery()
	query.Set("trusted_department_read_dept_code", "RD")
	query.Set("trustedDepartmentReadDeptCode", "RD")
	for _, shared := range []bool{true, false} {
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("00000000-0000-4000-8000-000000000001").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "updated_at"}).AddRow(19, "00000000-0000-4000-8000-000000000001", "Private department document", "owner-uid", "department", "RD", 0, 1, "2026-09-08"))
		shares := sqlmock.NewRows([]string{"permission"})
		if shared {
			shares.AddRow("read")
		}
		mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares.*document_id = \? AND shared_to_uid = \?`).WithArgs(int64(19), "reader-uid").WillReturnRows(shares)
		if !shared {
			mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
			mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*can_read = 1`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
		}
		result, readErr := adapter.productDocumentServiceMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", query, body)
		if shared {
			if readErr != nil || result["title"] != "Private department document" {
				t.Fatalf("share grant %+v %v", result, readErr)
			}
		} else {
			denied, ok := readErr.(httperror.Error)
			if !ok || denied.Status != 403 || denied.Code != "permission_denied" || result != nil {
				t.Fatalf("revocation bypassed %+v %v", result, readErr)
			}
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDocumentPayloadRejectsScopeInjection(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000001"
	for _, mutation := range []func(map[string]any){
		func(c map[string]any) { c["role"] = "admin" },
		func(c map[string]any) { c["actorUid"] = 123 },
		func(c map[string]any) { c["productCode"] = " P-1" },
		func(c map[string]any) { c["productCode"] = "P/1" },
		func(c map[string]any) { c["documentUuid"] = "invalid" },
		func(c map[string]any) { c["action"] = "content:read" },
	} {
		command := map[string]any{"actorUid": "reader", "productCode": "P-1", "documentUuid": id, "action": "metadata:read"}
		body := map[string]any{integrationoperation.ServiceCommandEnvelopeKey: map[string]any{"command": command}}
		if err := validateProductDocumentMetadataPayload(body, id); err != nil {
			t.Fatal(err)
		}
		mutation(command)
		if err := validateProductDocumentMetadataPayload(body, id); err == nil {
			t.Fatalf("accepted %+v", command)
		}
	}
}

func productDocumentServiceQuery() url.Values {
	q := projectDocumentServiceQuery()
	q.Set("current_user_scopes", aimsProductDocumentReadCapability)
	return q
}
func TestProductDocumentRuntimeRejectsBroadScopeBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	for _, scope := range []string{"", "codocs.read", "codocs:*", "codocs:project-document:content:read"} {
		q := productDocumentServiceQuery()
		q.Set("current_user_scopes", scope)
		_, operation, callErr := adapter.HandleRuntime(context.Background(), "POST", "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/metadata", q, nil)
		denied, ok := callErr.(httperror.Error)
		if !ok || denied.Status != 403 || denied.Code != "insufficient_scope" || operation != "codocs.service.product_document.metadata" {
			t.Fatalf("scope %s %s %v", scope, operation, callErr)
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDocumentContentRechecksSharesAndIgnoresDepartmentHints(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	body := projectDocumentServiceBody("00000000-0000-4000-8000-000000000001", "ignored")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentContentOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	envelope["commandSchemaVersion"] = aimsProductDocumentContentOperation
	envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P-1", "documentUuid": "00000000-0000-4000-8000-000000000001", "action": "content:read"}
	query := productDocumentServiceQuery()
	query.Set("trusted_department_read_dept_code", "RD")
	query.Set("trustedDepartmentReadDeptCode", "RD")
	for _, shared := range []bool{true, false} {
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("00000000-0000-4000-8000-000000000001").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "updated_at", "oss_path"}).AddRow(19, "00000000-0000-4000-8000-000000000001", "Private department document", "owner-uid", "department", "RD", 0, 1, "2026-09-08", "documents/private.md"))
		shares := sqlmock.NewRows([]string{"permission"})
		if shared {
			shares.AddRow("read")
		}
		mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares.*document_id = \? AND shared_to_uid = \?`).WithArgs(int64(19), "reader-uid").WillReturnRows(shares)
		if !shared {
			mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
			mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*can_read = 1`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
		}
		response, operation, readErr := adapter.HandleRuntime(context.Background(), "POST", "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/content", query, body)
		if operation != "codocs.service.product_document.content" {
			t.Fatalf("operation %s", operation)
		}
		var result map[string]any
		if readErr == nil {
			envelope := response.(map[string]any)
			if envelope["success"] != true {
				t.Fatalf("response %+v", envelope)
			}
			result = envelope["data"].(map[string]any)
			if len(result) != 6 || result["ossPath"] != "documents/private.md" {
				t.Fatalf("content grant %+v", result)
			}
		}
		if shared {
			if readErr != nil || result["title"] != "Private department document" {
				t.Fatalf("share grant %+v %v", result, readErr)
			}
		} else {
			denied, ok := readErr.(httperror.Error)
			if !ok || denied.Status != 403 || denied.Code != "permission_denied" || result != nil {
				t.Fatalf("revocation bypassed %+v %v", result, readErr)
			}
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDocumentContentRejectsMetadataCommand(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000001"
	body := projectDocumentServiceBody(id, "ignored")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentReadOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	envelope["commandSchemaVersion"] = aimsProductDocumentReadSchema
	envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P-1", "documentUuid": id, "action": "metadata:read"}
	adapter := &Adapter{}
	if _, err := adapter.productDocumentServiceContent(context.Background(), id, productDocumentServiceQuery(), body); err == nil {
		t.Fatal("metadata command authorized content")
	}
	envelope["command"].(map[string]any)["action"] = "content:read"
	if _, err := adapter.productDocumentServiceContent(context.Background(), id, productDocumentServiceQuery(), body); err == nil {
		t.Fatal("metadata operation authorized content")
	}
}

func TestProductDocumentContentRuntimeRejectsBroadScopeBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	for _, scope := range []string{"", "codocs.read", "codocs:*", "codocs:project-document:content:read"} {
		q := productDocumentServiceQuery()
		q.Set("current_user_scopes", scope)
		_, operation, callErr := adapter.HandleRuntime(context.Background(), "POST", "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/content", q, nil)
		denied, ok := callErr.(httperror.Error)
		if !ok || denied.Status != 403 || denied.Code != "insufficient_scope" || operation != "codocs.service.product_document.content" {
			t.Fatalf("scope %s %s %v", scope, operation, callErr)
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDocumentContentRuntimeRejectsMethods(t *testing.T) {
	adapter := &Adapter{}
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		_, operation, err := adapter.HandleRuntime(context.Background(), method, "/v1/codocs/service/product-documents/00000000-0000-4000-8000-000000000001/content", productDocumentServiceQuery(), nil)
		denied, ok := err.(httperror.Error)
		if !ok || denied.Status != 405 || operation != "codocs.service.product_document.content" {
			t.Fatalf("method %s: %s %v", method, operation, err)
		}
	}
}

func TestAssetsProductDocumentMetadataUsesIndependentIdentity(t *testing.T) {
	for _, source := range []string{"assets", "enterprise"} {
		t.Run(source, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			adapter := &Adapter{db: db}
			body := projectDocumentServiceBody("00000000-0000-4000-8000-000000000001", "PRJ-1")
			if _, err = adapter.assetsProductDocumentMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body); err == nil {
				t.Fatal("project contract accepted as product contract")
			}
			envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
			envelope["operationCode"] = assetsProductDocumentReadOperation
			envelope["requiredCapability"] = aimsProductDocumentReadCapability
			envelope["commandSchemaVersion"] = assetsProductDocumentReadOperation
			command := envelope["command"].(map[string]any)
			delete(command, "projectCode")
			command["productCode"] = "P-1"
			command["action"] = "metadata:read"
			if _, err := adapter.assetsProductDocumentMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body); err == nil {
				t.Fatal("AIMS identity accepted for Assets operation")
			}
			body[integrationoperation.TrustedServiceCommandSourceAppKey] = source
			body[integrationoperation.TrustedServiceCommandSourceClientKey] = source + ".runtime"
			body[integrationoperation.TrustedServiceCommandSourceClientKey] = "other.runtime"
			if _, err := adapter.assetsProductDocumentMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body); err == nil {
				t.Fatal("mismatched physical client accepted")
			}
			body[integrationoperation.TrustedServiceCommandSourceClientKey] = source + ".runtime"
			if _, err := adapter.productDocumentServiceMetadata(context.Background(), "00000000-0000-4000-8000-000000000001", productDocumentServiceQuery(), body); err == nil {
				t.Fatal("Assets identity accepted for AIMS operation")
			}
			mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("00000000-0000-4000-8000-000000000001").WillReturnRows(projectDocumentServiceReadRows("00000000-0000-4000-8000-000000000001", "PRJ-1"))
			wire, operation, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/codocs/service/assets-product-documents/00000000-0000-4000-8000-000000000001/metadata", productDocumentServiceQuery(), body)
			if err != nil || operation != "codocs.service.assets_product_document.metadata" {
				t.Fatalf("runtime: %s %v", operation, err)
			}
			result := wire.(map[string]any)["data"].(map[string]any)
			if err != nil || result["uuid"] != "00000000-0000-4000-8000-000000000001" || result["title"] != "Project requirement" || len(result) != 4 {
				t.Fatalf("metadata %+v %v", result, err)
			}
			for _, key := range []string{"ossPath", "oss_path", "owner_uid", "content", "project_code"} {
				if _, ok := result[key]; ok {
					t.Fatalf("internal field leaked %s", key)
				}
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}

		})
	}
}

func TestAssetsProductDocumentRuntimeRejectsBroadScopeBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	for _, scope := range []string{"", "codocs.read", "codocs:*", "codocs:project-document:content:read"} {
		q := productDocumentServiceQuery()
		q.Set("current_user_scopes", scope)
		_, operation, callErr := adapter.HandleRuntime(context.Background(), "POST", "/v1/codocs/service/assets-product-documents/00000000-0000-4000-8000-000000000001/metadata", q, nil)
		denied, ok := callErr.(httperror.Error)
		if !ok || denied.Status != 403 || denied.Code != "insufficient_scope" || operation != "codocs.service.assets_product_document.metadata" {
			t.Fatalf("scope %s %s %v", scope, operation, callErr)
		}
	}
	_, _, callErr := adapter.HandleRuntime(context.Background(), "GET", "/v1/codocs/service/assets-product-documents/00000000-0000-4000-8000-000000000001/metadata", productDocumentServiceQuery(), nil)
	if denied, ok := callErr.(httperror.Error); !ok || denied.Status != 405 {
		t.Fatalf("GET allowed: %v", callErr)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
