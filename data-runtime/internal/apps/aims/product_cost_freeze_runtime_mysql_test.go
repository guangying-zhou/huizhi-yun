package aims

import (
	"context"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"testing"
	"time"
	"unsafe"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestMySQLProductCostFreezeAndStatusRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	db.SetMaxOpenConns(1)
	schema, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS " + "`aims_projects`" + ".*?\\) ENGINE=.*?;").FindString(string(schema))
	if ddl == "" {
		t.Fatal("canonical project DDL missing")
	}
	// Foreign table creation is unnecessary for nullable relations in this fixture.
	if _, err = db.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ddl); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../../aims/docs/migration_v5.0_integration_operation_outbox.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(migration))
	if _, err = db.Exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(1,'PRJ1','Project','Project','U1','U1')"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P1',?,'U1','U1',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	a := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(a.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	q := url.Values{"current_user": {"U1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}}
	id := uuid.NewString()
	command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(0), "evidenceRef": "review", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": 5000}}}
	call := func(action string) (any, error) {
		q.Set("current_user_scopes", "aims:product-cost-rules:"+action)
		b := map[string]any{"requestId": id, "authorization": map[string]any{"actorUid": q.Get("current_user"), "projectId": "1", "projectCode": "PRJ1", "resource": "projects", "action": "edit", "purpose": "product_cost_rules_" + action, "expiresAt": float64(time.Now().Add(15 * time.Second).UnixMilli())}}
		if action == "freeze" {
			b["command"] = command
		}
		result, _, err := a.HandleRuntime(context.Background(), "POST", "/v1/aims/internal/product-cost-rules:"+action, q, b)
		return result, err
	}
	for i := 0; i < 2; i++ {
		if _, err := call("freeze"); err != nil {
			t.Fatal(err)
		}
	}
	result, err := call("status")
	if err != nil {
		t.Fatal(err)
	}
	data := result.(map[string]any)["data"].(map[string]any)
	if data["status"] != "pending" {
		t.Fatalf("%v", data)
	}
	q.Set("current_user", "OTHER")
	if _, err := call("status"); err == nil {
		t.Fatal("other actor read request")
	}
	q.Set("current_user", "U1")
	id = uuid.NewString()
	command["shares"] = []any{map[string]any{"productCode": "MISSING", "basisPoints": 5000}}
	if _, err := call("freeze"); err == nil {
		t.Fatal("missing product accepted")
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 1 {
		t.Fatalf("count %d: %v", count, err)
	}
}
