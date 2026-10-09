package aims

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestMySQLCrossDependenciesThroughRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	const source = "P-CROSS-RUNTIME-A"
	const target = "P-CROSS-RUNTIME-B"
	const item = "00000000-0000-4000-8000-000000000001"
	const pred = "00000000-0000-4000-8000-000000000002"
	for i, code := range []string{source, target} {
		if _, err = db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,UUID(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,?,'共享能力','接口范围','reliability','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, []string{item, pred}[i], code); err != nil {
			t.Fatal(err)
		}
	}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	ctx := context.Background()
	var beforeDispatch func()
	expectConflict := false
	call := func(action, key string, input any) any {
		t.Helper()
		permission, capability := "view", "read"
		if action == "create" || action == "remove" {
			permission = "edit"
			capability = "cross-dependency-" + action
		}
		permit := func(code, action string) productcenter.AuthorizationPermit {
			t.Helper()
			facts, e := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
			if e != nil {
				t.Fatal(e)
			}
			return productcenter.AuthorizationPermit{Resource: "product_priorities", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		}
		targetPermit := permit(target, "view")
		body := map[string]any{"input": input, "idempotency_key": key, "authorization": permit(source, permission), "predecessor_authorization": targetPermit, "predecessor_authorizations": map[string]productcenter.AuthorizationPermit{target: targetPermit}}
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:" + capability}}
		if beforeDispatch != nil {
			beforeDispatch()
		}
		raw, operation, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+source+"/cross-dependencies:"+action, query, body)
		if expectConflict {
			var response httperror.Error
			if !errors.As(e, &response) || response.Status != 409 {
				t.Fatalf("expected stale authorization conflict, got %v", e)
			}
			return nil
		}
		if e != nil {
			t.Fatalf("%s: %v", action, e)
		}
		envelope, ok := raw.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-cross-dependencies."+action {
			t.Fatalf("envelope %#v %s", raw, operation)
		}
		return envelope["data"]
	}
	input := productcenter.CrossDependencyCreate{ItemBizID: item, PredecessorProductCode: target, PredecessorBizID: pred, ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedPredecessorProductRevision: 1, ExpectedPredecessorRevision: 1, Reason: "共享接口"}
	saved := call("create", "create", input).(productcenter.CommandResult)
	replay := call("create", "create", input).(productcenter.CommandResult)
	if !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatal("create replay diverged")
	}
	// Simulate relation revocation between BFF fact collection and Runtime.
	// Even an existing receipt must not bypass fresh authorization.
	beforeDispatch = func() {
		if _, e := db.Exec(`UPDATE product_members SET status='inactive' WHERE product_code=? AND uid='pm'`, target); e != nil {
			t.Fatal(e)
		}
	}
	expectConflict = true
	call("create", "create", input)
	beforeDispatch = nil
	expectConflict = false
	var receiptCount, edgeCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE product_code=?`, source).Scan(&receiptCount); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies`).Scan(&edgeCount); err != nil {
		t.Fatal(err)
	}
	if receiptCount != 1 || edgeCount != 1 {
		t.Fatalf("denied replay mutated receipts=%d edges=%d", receiptCount, edgeCount)
	}
	if _, err = db.Exec(`UPDATE product_members SET status='active' WHERE product_code=? AND uid='pm'`, target); err != nil {
		t.Fatal(err)
	}
	var value struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(saved.Value, &value); err != nil || value.BizID == "" {
		t.Fatalf("receipt %s %v", saved.Value, err)
	}
	detail := call("view", "", map[string]any{"biz_id": value.BizID, "predecessor_product_code": target}).(productcenter.CrossDependencyView)
	if detail.ItemBizID != item || detail.PredecessorBizID != pred || detail.WorkspaceRevision != 2 || detail.PredecessorProductRevision != 1 {
		t.Fatalf("detail %+v", detail)
	}
	pageInput := map[string]any{"item_biz_id": item, "page": 1, "page_size": 20}
	page := call("list", "", pageInput).(productcenter.CrossDependencyPage)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != value.BizID {
		t.Fatalf("list %+v", page)
	}
	// Exercise discovery through dispatch and JSON encoding without depending on
	// the internal discovery result's concrete Go type.
	found, _ := json.Marshal(call("targets", "", map[string]any{"item_biz_id": item}))
	var targets struct {
		ProductCodes []string `json:"product_codes"`
	}
	if err = json.Unmarshal(found, &targets); err != nil || len(targets.ProductCodes) != 1 || targets.ProductCodes[0] != target {
		t.Fatalf("targets %s %v", found, err)
	}
	input.ExpectedRevision = 2
	input.ExpectedItemRevision = 2
	remove := productcenter.CrossDependencyRemove{CrossDependencyCreate: input, DependencyBizID: value.BizID, ExpectedDependencyRevision: 1}
	removed := call("remove", "remove", remove).(productcenter.CommandResult)
	replay = call("remove", "remove", remove).(productcenter.CommandResult)
	if !replay.Replayed || replay.ReceiptID != removed.ReceiptID {
		t.Fatal("remove replay diverged")
	}
	page = call("list", "", pageInput).(productcenter.CrossDependencyPage)
	if page.Total != 0 || len(page.Items) != 0 || page.WorkspaceRevision != 3 {
		t.Fatalf("removed list %+v", page)
	}
	var receipts, edges int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE product_code=?`, source).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies`).Scan(&edges); err != nil {
		t.Fatal(err)
	}
	if receipts != 2 || edges != 0 {
		t.Fatalf("receipts=%d edges=%d", receipts, edges)
	}
}
