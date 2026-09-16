package productcenter

import (
	"context"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"reflect"
	"testing"
)

func TestMySQLProductDocumentRequestAtomic(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CREATE")
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-CREATE", "pm", "edit")
		p.Resource = "product_documents"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-CREATE", ActorUID: "pm", Action: "product_documents:template-create", IdempotencyKey: "create-template"}
	input := ProductDocumentRequestCreate{ExpectedRevision: 1, TemplateUUID: "00000000-0000-4000-8000-000000000001", Title: "Spec", Purpose: "requirements"}
	trusted := integrationoperation.TrustedContext{TenantCode: "TENANT", DeploymentCode: "AIMS", SourceApp: "aims"}
	if _, err := db.Exec(`CREATE TRIGGER fail_create_request BEFORE INSERT ON product_document_creation_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateProductDocumentRequest(context.Background(), db, identity, permit(), input, trusted); err == nil {
		t.Fatal("failure ignored")
	}
	for _, table := range []string{"integration_operation", "product_document_creation_requests", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("rollback %s %d %v", table, n, err)
		}
	}
	if _, err := db.Exec("DROP TRIGGER fail_create_request"); err != nil {
		t.Fatal(err)
	}
	first, err := CreateProductDocumentRequest(context.Background(), db, identity, permit(), input, trusted)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreateProductDocumentRequest(context.Background(), db, identity, permit(), input, trusted)
	var firstValue, replayValue map[string]any
	if e := json.Unmarshal(first.Value, &firstValue); e != nil {
		t.Fatal(e)
	}
	if e := json.Unmarshal(replay.Value, &replayValue); e != nil {
		t.Fatal(e)
	}
	if err != nil || !replay.Replayed || !reflect.DeepEqual(firstValue, replayValue) {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var operation, target, actor string
	if err = db.QueryRow(`SELECT operation_id,JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.documentUuid')),original_actor_uid FROM integration_operation`).Scan(&operation, &target, &actor); err != nil {
		t.Fatal(err)
	}
	var linked int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_document_creation_requests WHERE operation_id=? AND document_uuid=? AND created_by=?`, operation, target, actor).Scan(&linked); err != nil || linked != 1 {
		t.Fatalf("request binding %d %v", linked, err)
	}
	detail, err := ReadProductDocumentRequest(context.Background(), db, "P-CREATE", "pm", firstValue["biz_id"].(string), permit())
	if err != nil || detail.DocumentUUID != target || detail.Status != "pending" || detail.RelationBizID != "" {
		t.Fatalf("request detail %+v %v", detail, err)
	}
	if _, err = ReadProductDocumentRequest(context.Background(), db, "P-OTHER", "pm", firstValue["biz_id"].(string), permit()); err == nil {
		t.Fatal("accepted cross-product request read")
	}
	if _, err = ReadProductDocumentRequest(context.Background(), db, "P-CREATE", "other-user", firstValue["biz_id"].(string), permit()); err == nil {
		t.Fatal("accepted wrong actor")
	}
	linkIdentity := CommandIdentity{ProductCode: "P-CREATE", ActorUID: "pm", Action: "product_documents:link-created", IdempotencyKey: "link-created"}
	linkInput := ProductDocumentRequestLink{ExpectedRevision: 2, RequestBizID: firstValue["biz_id"].(string)}
	if _, err = LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput); err == nil {
		t.Fatal("linked pending operation")
	}
	if _, err = db.Exec(`UPDATE integration_operation SET status='succeeded',target_receipt_id='00000000-0000-4000-8000-000000000003',target_biz_type='product_document',target_biz_code=? WHERE operation_id=?`, target, operation); err != nil {
		t.Fatal(err)
	}

	for _, mutation := range []string{
		`UPDATE integration_operation SET target_receipt_id=''`,
		`UPDATE integration_operation SET original_actor_uid='other'`,
		`UPDATE integration_operation SET command_schema_version='v1'`,
		`UPDATE integration_operation SET required_capability='codocs:write'`,
	} {
		if _, err = db.Exec(mutation); err != nil {
			t.Fatal(err)
		}
		if _, err = LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput); err == nil {
			t.Fatalf("accepted corrupted creation evidence: %s", mutation)
		}
		if _, err = db.Exec(`UPDATE integration_operation SET target_receipt_id='00000000-0000-4000-8000-000000000003',original_actor_uid='pm',command_schema_version='product-document-create.v1',required_capability='codocs:product-document:create'`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_link_request BEFORE UPDATE ON product_document_creation_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput); err == nil {
		t.Fatal("link failure ignored")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_documents`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("link rollback %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_link_request`); err != nil {
		t.Fatal(err)
	}
	if _, err = LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput); err != nil {
		t.Fatal(err)
	}
	linkedReplay, err := LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput)
	if err != nil || !linkedReplay.Replayed {
		t.Fatalf("link replay %v", err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_documents d JOIN product_document_creation_requests r ON r.relation_biz_id=d.biz_id WHERE d.document_uuid=? AND r.linked_at IS NOT NULL`, target).Scan(&count); err != nil || count != 1 {
		t.Fatalf("linked relation %d %v", count, err)
	}
	if _, err = db.Exec(`UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3),removed_by='pm' WHERE document_uuid=?`, target); err != nil {
		t.Fatal(err)
	}
	linkIdentity.IdempotencyKey = "link-after-removal"
	linkInput.ExpectedRevision = 3
	if _, err = LinkCreatedProductDocument(context.Background(), db, linkIdentity, permit(), linkInput); err == nil {
		t.Fatal("implicitly restored removed relation")
	}

	identity.IdempotencyKey = "second-template"
	input.ExpectedRevision = 3
	if _, err = CreateProductDocumentRequest(context.Background(), db, identity, permit(), input, trusted); err != nil {
		t.Fatal(err)
	}
	firstPage, err := ListProductDocumentRequests(context.Background(), db, "P-CREATE", "pm", permit(), PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || firstPage.Total != 2 || len(firstPage.Items) != 1 || firstPage.Items[0].Linked {
		t.Fatalf("first request page %+v %v", firstPage, err)
	}
	secondPage, err := ListProductDocumentRequests(context.Background(), db, "P-CREATE", "pm", permit(), PlanningPageQuery{Page: 2, PageSize: 1})
	if err != nil || secondPage.Total != 2 || len(secondPage.Items) != 1 || !secondPage.Items[0].Linked || secondPage.Items[0].BizID != firstValue["biz_id"] {
		t.Fatalf("second request page %+v %v", secondPage, err)
	}
	if _, err = ListProductDocumentRequests(context.Background(), db, "P-CREATE", "other", permit(), PlanningPageQuery{Page: 1, PageSize: 1}); err == nil {
		t.Fatal("accepted unauthorized request listing")
	}

}
