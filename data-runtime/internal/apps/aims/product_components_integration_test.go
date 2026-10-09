package aims

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"
)

func TestMySQLProductComponentsThroughRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	const code = "P-COMPONENT-RUNTIME"
	if _, err = db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,UUID(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
		t.Fatal(err)
	}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	ctx := context.Background()
	query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
	call := func(action, key string, input any) (any, error) {
		t.Helper()
		facts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if err != nil {
			t.Fatal(err)
		}
		permission := "edit"
		if action == "delete" {
			permission = "delete"
		}
		capability := action
		if action == "list" {
			permission = "view"
			capability = "read"
		}
		query.Set("current_user_scopes", "aims:product-components:"+capability)
		body := map[string]any{"input": input, "idempotency_key": key, "authorization": productcenter.AuthorizationPermit{Resource: "product_components", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
		result, operation, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/components:"+action, query, body)
		if err != nil {
			return nil, err
		}
		envelope, ok := result.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-components."+action {
			t.Fatalf("envelope %#v %s", result, operation)
		}
		return envelope["data"], nil
	}
	create := func(key string, revision uint64) int64 {
		t.Helper()
		input := productcenter.ProductComponentDraft{Name: key, ExpectedRevision: revision}
		raw, err := call("create", key, input)
		if err != nil {
			t.Fatal(err)
		}
		saved := raw.(productcenter.CommandResult)
		raw, err = call("create", key, input)
		if err != nil {
			t.Fatal(err)
		}
		replay := raw.(productcenter.CommandResult)
		if !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
			t.Fatalf("replay %+v", replay)
		}
		var component productcenter.ProductComponentRecord
		if err = json.Unmarshal(saved.Value, &component); err != nil || component.ID < 1 {
			t.Fatalf("create %+v %v", component, err)
		}
		return component.ID
	}
	root := create("root", 1)
	child := create("child", 2)
	move := productcenter.ProductComponentMove{ComponentID: child, ParentID: &root, ExpectedRevision: 3, ExpectedComponentRevision: 1, Reason: "归入认证模块"}
	raw, err := call("move", "move", move)
	if err != nil {
		t.Fatal(err)
	}
	saved := raw.(productcenter.CommandResult)
	raw, err = call("move", "move", move)
	if err != nil {
		t.Fatal(err)
	}
	if replay := raw.(productcenter.CommandResult); !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("move replay %+v", replay)
	}
	raw, err = call("list", "", map[string]any{"parent_id": nil, "page": 1, "page_size": 1})
	if err != nil {
		t.Fatal(err)
	}
	roots := raw.(productcenter.ProductComponentPage)
	if roots.Total != 1 || len(roots.Items) != 1 || roots.Items[0].ID != root || roots.Items[0].ChildCount != 1 || roots.WorkspaceRevision != 4 {
		t.Fatalf("roots %+v", roots)
	}
	raw, err = call("list", "", map[string]any{"parent_id": root, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	children := raw.(productcenter.ProductComponentPage)
	if children.Total != 1 || len(children.Items) != 1 || children.Items[0].ID != child || children.Items[0].Revision != 2 {
		t.Fatalf("children %+v", children)
	}
	if _, err = call("move", "stale", move); err == nil {
		t.Fatal("stale command accepted")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("receipt count %d %v", count, err)
	}
	const featureID = "11111111-1111-4111-8111-111111111111"
	if _, err = db.Exec(`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(?,?,'登录能力','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, featureID, code); err != nil {
		t.Fatal(err)
	}
	assignment := productcenter.FeatureComponentAssignment{BizID: featureID, ComponentID: &child, ExpectedRevision: 4, ExpectedFeatureRevision: 1, Reason: "功能归入登录模块"}
	assign := func(key string) (productcenter.CommandResult, error) {
		facts, e := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if e != nil {
			t.Fatal(e)
		}
		query.Set("current_user_scopes", "aims:product-features:component-assign")
		raw, op, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/features:component-assign", query, map[string]any{"input": assignment, "idempotency_key": key, "authorization": productcenter.AuthorizationPermit{Resource: "product_features", Action: "edit", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		if e != nil {
			return productcenter.CommandResult{}, e
		}
		envelope := raw.(map[string]any)
		if envelope["code"] != 0 || op != "aims.product-features.component-assign" {
			t.Fatalf("assignment envelope %#v %s", raw, op)
		}
		return envelope["data"].(productcenter.CommandResult), nil
	}
	assigned, err := assign("classify")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := assign("classify")
	if err != nil || !replay.Replayed || replay.ReceiptID != assigned.ReceiptID {
		t.Fatalf("classification replay %+v %v", replay, err)
	}
	facts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
	if err != nil {
		t.Fatal(err)
	}
	query.Set("current_user_scopes", "aims:product-features:read")
	result, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/features:list", query, map[string]any{"input": productcenter.FeaturePageQuery{Page: 1, PageSize: 10, ComponentID: &child}, "authorization": productcenter.AuthorizationPermit{Resource: "product_features", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
	if err != nil {
		t.Fatal(err)
	}
	features := result.(map[string]any)["data"].(productcenter.FeaturePage)
	if features.Total != 1 || len(features.Items) != 1 || features.Items[0].BizID != featureID || features.Items[0].ComponentID == nil || *features.Items[0].ComponentID != child || features.WorkspaceRevision != 5 {
		t.Fatalf("classified features %+v", features)
	}
	assignment.ComponentID = nil
	assignment.ExpectedRevision = 5
	assignment.ExpectedFeatureRevision = 2
	if _, err = assign("ungroup"); err != nil {
		t.Fatal(err)
	}
	var classified int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_features WHERE biz_id=? AND component_id IS NULL AND revision=3`, featureID).Scan(&classified); err != nil || classified != 1 {
		t.Fatalf("ungroup %d %v", classified, err)
	}
	edit := productcenter.ProductComponentEdit{ComponentID: root, Name: "认证平台", Description: "统一身份", SortOrder: -3, ExpectedRevision: 6, ExpectedComponentRevision: 1, Reason: "明确模块职责"}
	raw, err = call("edit", "edit-root", edit)
	if err != nil {
		t.Fatal(err)
	}
	edited := raw.(productcenter.CommandResult)
	raw, err = call("edit", "edit-root", edit)
	if err != nil {
		t.Fatal(err)
	}
	editReplay := raw.(productcenter.CommandResult)
	if !editReplay.Replayed || editReplay.ReceiptID != edited.ReceiptID {
		t.Fatalf("edit replay %+v", editReplay)
	}
	var editResult struct {
		Component         productcenter.ProductComponentRecord `json:"component"`
		WorkspaceRevision uint64                               `json:"workspace_revision"`
	}
	if err = json.Unmarshal(edited.Value, &editResult); err != nil || editResult.WorkspaceRevision != 7 || editResult.Component.ID != root || editResult.Component.Revision != 2 || editResult.Component.ParentID != nil {
		t.Fatalf("edit result %+v %v", editResult, err)
	}
	raw, err = call("list", "", map[string]any{"page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	editedRoots := raw.(productcenter.ProductComponentPage)
	if editedRoots.WorkspaceRevision != 7 || len(editedRoots.Items) != 1 || editedRoots.Items[0].Name != edit.Name || editedRoots.Items[0].Description != edit.Description || editedRoots.Items[0].SortOrder != edit.SortOrder || editedRoots.Items[0].ChildCount != 1 {
		t.Fatalf("edited roots %+v", editedRoots)
	}
	if _, err = call("edit", "stale-root", edit); err == nil {
		t.Fatal("stale edit accepted")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 6 {
		t.Fatalf("final receipt count %d %v", count, err)
	}

	deletion := productcenter.ProductComponentDelete{ComponentID: root, ExpectedRevision: 7, ExpectedComponentRevision: 2, Reason: "清理模块"}
	_, err = call("delete", "delete-parent", deletion)
	var conflict httperror.Error
	if !errors.As(err, &conflict) || conflict.Status != 409 || conflict.Code != "product_component_referenced" {
		t.Fatalf("referenced deletion %v", err)
	}
	deletion.ComponentID = child
	raw, err = call("delete", "delete-child", deletion)
	if err != nil {
		t.Fatal(err)
	}
	deleted := raw.(productcenter.CommandResult)
	raw, err = call("delete", "delete-child", deletion)
	if err != nil {
		t.Fatal(err)
	}
	deleteReplay := raw.(productcenter.CommandResult)
	if !deleteReplay.Replayed || deleteReplay.ReceiptID != deleted.ReceiptID {
		t.Fatalf("delete replay %+v", deleteReplay)
	}
	var deletedValue struct {
		ID                int64  `json:"id"`
		Deleted           bool   `json:"deleted"`
		WorkspaceRevision uint64 `json:"workspace_revision"`
	}
	if err = json.Unmarshal(deleted.Value, &deletedValue); err != nil || deletedValue.ID != child || !deletedValue.Deleted || deletedValue.WorkspaceRevision != 8 {
		t.Fatalf("deleted value %+v %v", deletedValue, err)
	}
	raw, err = call("list", "", map[string]any{"parent_id": root, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	remaining := raw.(productcenter.ProductComponentPage)
	if remaining.Total != 0 || len(remaining.Items) != 0 || remaining.WorkspaceRevision != 8 {
		t.Fatalf("remaining %+v", remaining)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 7 {
		t.Fatalf("deletion receipts %d %v", count, err)
	}

}
