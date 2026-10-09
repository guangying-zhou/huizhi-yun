package codocs

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"testing"
)

func TestProductDocumentSearchFiltersBeforePagination(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	visibility := `(?s) FROM documents d WHERE d.status=1 AND .*d.owner_uid = \?.*visible_share.shared_to_uid = \?.*visible_relation.related_uid = \?.*visible_relation.can_read = 1.*AND LOCATE\(\?,d.title\)>0`
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT COUNT\(\*\)`+visibility).WithArgs("u", "u", "u", "100%").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(21))
	mock.ExpectQuery(`SELECT d.uuid,d.title,d.doc_type,d.updated_at`+visibility+` ORDER BY d.updated_at DESC,d.id DESC LIMIT \? OFFSET \?`).WithArgs("u", "u", "u", "100%", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"uuid", "title", "doc_type", "updated_at"}).AddRow("doc", "100%需求", "product", "2026-09-08"))
	mock.ExpectCommit()
	body := projectDocumentServiceBody("", "P")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentSearchOperation
	envelope["commandSchemaVersion"] = aimsProductDocumentSearchOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	envelope["command"] = map[string]any{"actorUid": "u", "productCode": "P", "action": "search", "search": "100%", "page": 2, "pageSize": 20}
	query := productDocumentServiceQuery()
	query.Set("current_user", "u")
	raw, operation, err := a.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/product-documents/search", query, body)
	if err != nil {
		t.Fatal(err)
	}
	response := raw.(map[string]any)
	if operation != "codocs.service.product_document.search" || response["success"] != true {
		t.Fatalf("response %+v %s", response, operation)
	}
	result := response["data"].(map[string]any)
	if err != nil || result["total"] != 21 {
		t.Fatalf("result %+v %v", result, err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || len(items[0]) != 4 || items[0]["updated_at"] != "2026-09-08" {
		t.Fatalf("items %+v", items)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestProductDocumentSearchRejectsInvalidInputBeforeStorage(t *testing.T) {
	a := &Adapter{}
	for _, q := range []productDocumentSearchQuery{{Page: 0, PageSize: 20}, {Page: 1, PageSize: 101}, {Page: 1, PageSize: 20, Search: "x\n"}} {
		if _, err := a.searchVisibleProductDocuments(context.Background(), "u", q); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
	if _, err := a.searchVisibleProductDocuments(context.Background(), "", productDocumentSearchQuery{Page: 1, PageSize: 20}); err == nil {
		t.Fatal("missing actor accepted")
	}
}
