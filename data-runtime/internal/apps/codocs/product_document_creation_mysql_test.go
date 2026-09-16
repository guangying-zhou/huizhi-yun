package codocs

import (
	"context"
	"database/sql"
	"os"
	"regexp"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestMySQLProductCreationReceiptReplay(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires explicit isolated MySQL socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?multiStatements=true&parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "pc_create_" + regexp.MustCompile("-").ReplaceAllString(uuid.NewString(), "")
	if _, err = admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?multiStatements=true&parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "document_relations"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE `" + table + "`.*?ENGINE=InnoDB.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("missing schema", table)
		}
		if _, err = db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range []string{"migration_v1.4_service_command_receipt.sql", "migration_v1.6_product_document_creation.sql"} {
		ddl, err := os.ReadFile("../../../../codocs/docs/" + file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(ddl)); err != nil {
			t.Fatal(err)
		}
	}
	a := &Adapter{db: db}
	target := "00000000-0000-4000-8000-000000000001"
	body := projectDocumentServiceBody(target, "ignored")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentCreateOperation
	envelope["requiredCapability"] = aimsProductDocumentCreateCapability
	envelope["commandSchemaVersion"] = aimsProductDocumentCreateSchema
	envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P", "documentUuid": target, "templateUuid": "00000000-0000-4000-8000-000000000002", "title": "Spec", "action": "create"}
	freezeProductCreateTestEnvelope(envelope)
	query := productDocumentServiceQuery()
	query.Set("current_user_scopes", aimsProductDocumentCreateCapability)
	ctx := context.Background()
	prepared, err := a.prepareProductDocumentCreation(ctx, body, query, "original")
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.prepareProductDocumentCreation(ctx, body, query, "changed")
	if err != nil || again.Content != "original" {
		t.Fatalf("prepare replay %+v %v", again, err)
	}
	path := "product-creations/" + prepared.OperationID + "/00000000-0000-4000-8000-000000000004.md"
	// Force owner relation failure after the document INSERT; the receipt and
	// document must both roll back and preparation must remain retryable.
	if _, err = db.Exec("CREATE TRIGGER fail_owner BEFORE INSERT ON document_relations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test owner failure'"); err != nil {
		t.Fatal(err)
	}
	if _, err = a.completeProductDocumentCreation(ctx, body, query, path, prepared.ContentSHA256); err == nil {
		t.Fatal("injected failure ignored")
	}
	for _, table := range []string{"documents", "document_relations", "service_command_receipt"} {
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s: %d %v", table, count, err)
		}
	}
	var state string
	if err = db.QueryRow("SELECT state FROM product_document_creation").Scan(&state); err != nil || state != "prepared" {
		t.Fatalf("preparation rollback %s %v", state, err)
	}
	if _, err = db.Exec("DROP TRIGGER fail_owner"); err != nil {
		t.Fatal(err)
	}
	first, err := a.completeProductDocumentCreation(ctx, body, query, path, prepared.ContentSHA256)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE documents SET title='User edited title'"); err != nil {
		t.Fatal(err)
	}
	recovered, err := a.prepareProductDocumentCreation(ctx, body, query, "changed after completion")
	if err != nil || recovered.State != "completed" || recovered.PublishedPath != path || recovered.Content != "original" {
		t.Fatalf("recovery %+v %v", recovered, err)
	}
	replay, err := a.completeProductDocumentCreation(ctx, body, query, recovered.PublishedPath, recovered.ContentSHA256)
	if err != nil || !replay.Existing || first.ReceiptID != replay.ReceiptID {
		t.Fatalf("receipt replay %+v %v", replay, err)
	}
	var title string
	if err = db.QueryRow("SELECT title FROM documents").Scan(&title); err != nil || title != "User edited title" {
		t.Fatalf("replay overwrote edit %s %v", title, err)
	}
	if err = db.QueryRow("SELECT state FROM product_document_creation").Scan(&state); err != nil || state != "completed" {
		t.Fatalf("completion %s %v", state, err)
	}
	for _, table := range []string{"documents", "document_relations", "service_command_receipt"} {
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("single write %s: %d %v", table, count, err)
		}
	}
}
