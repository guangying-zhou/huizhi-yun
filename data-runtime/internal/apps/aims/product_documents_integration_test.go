package aims

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"
)

func TestMySQLProductDocumentMutationRuntimeReplay(t *testing.T) {
	for _, action := range []string{"remove", "edit", "restore", "create"} {
		t.Run(action, func(t *testing.T) { testProductDocumentMutationRuntimeReplay(t, action) })
	}
}
func testProductDocumentMutationRuntimeReplay(t *testing.T, action string) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	migration, err := os.ReadFile("../../../../aims/docs/migration_v5.34_product_documents.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(migration))
	code, biz, document := "P-DOC-RUNTIME", uuid.NewString(), uuid.NewString()
	if _, err = db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if action != "create" {
		if _, err = db.Exec(`INSERT INTO product_documents(biz_id,product_code,document_uuid,purpose,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,'design','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, biz, code, document); err != nil {
			t.Fatal(err)
		}
	}
	if action == "restore" {
		if _, err = db.Exec(`UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3),removed_by='pm' WHERE biz_id=?`, biz); err != nil {
			t.Fatal(err)
		}
	}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	ctx := context.Background()
	q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-documents:" + action}}
	var input any = productcenter.ProductDocumentTransition{BizID: biz, ExpectedRevision: 1, ExpectedDocumentRevision: 1}
	if action == "edit" {
		input = productcenter.ProductDocumentPurposeChange{BizID: biz, ExpectedRevision: 1, ExpectedDocumentRevision: 1, Purpose: "user-guide"}
	}
	if action == "create" {
		input = productcenter.ProductDocumentCreate{DocumentUUID: document, ExpectedRevision: 1, Purpose: "design"}
	}
	run := func(key string) (productcenter.CommandResult, error) {
		facts, e := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if e != nil {
			t.Fatal(e)
		}
		result, op, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/documents:"+action, q, map[string]any{"input": input, "idempotency_key": key, "authorization": productcenter.AuthorizationPermit{Resource: "product_documents", Action: "edit", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		if e != nil {
			return productcenter.CommandResult{}, e
		}
		envelope, ok := result.(map[string]any)
		if !ok || envelope["code"] != 0 || op != "aims.product-documents."+action {
			t.Fatalf("envelope %+v %s", result, op)
		}
		return envelope["data"].(productcenter.CommandResult), nil
	}
	first, err := run("remove-key")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("remove-key")
	if err != nil || !replay.Replayed || replay.ReceiptID != first.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var value map[string]any
	if err = json.Unmarshal(first.Value, &value); err != nil {
		t.Fatalf("value %+v %v", value, err)
	}
	if action == "create" {
		var ok bool
		biz, ok = value["biz_id"].(string)
		if !ok || biz == "" {
			t.Fatalf("create identity %+v", value)
		}
	}
	if value["biz_id"] != biz {
		t.Fatalf("identity %+v", value)
	}
	if action == "edit" && value["purpose"] != "user-guide" {
		t.Fatalf("purpose receipt %+v", value)
	}
	if action == "restore" && value["removed"] != false {
		t.Fatalf("restore receipt %+v", value)
	}
	if action == "remove" && value["removed"] != true {
		t.Fatalf("remove receipt %+v", value)
	}
	if _, err = run("different-key"); err == nil {
		t.Fatal("stale new command accepted")
	}
	var revision, root, count int
	var removed bool
	var storedDocument, purpose string
	if err = db.QueryRow(`SELECT revision,removed_at IS NOT NULL,document_uuid,purpose FROM product_documents WHERE biz_id=?`, biz).Scan(&revision, &removed, &storedDocument, &purpose); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code=?`, code).Scan(&root); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE product_code=? AND object_type='product_document'`, code).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if action == "edit" && purpose != "user-guide" {
		t.Fatalf("stored purpose %s", purpose)
	}
	expectedRelationRevision := 2
	if action == "create" {
		expectedRelationRevision = 1
	}
	if revision != expectedRelationRevision || root != 2 || removed != (action == "remove") || storedDocument != document || count != 1 {
		t.Fatalf("state %d %d %v %s %d", revision, root, removed, storedDocument, count)
	}
}
