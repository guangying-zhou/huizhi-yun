package aims

import (
	"context"
	"net/url"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestProductCostStatusRuntimeScopesOriginalRequest(t *testing.T) {
	for _, status := range []string{"succeeded", "dead_letter", "retry_wait", "missing"} {
		t.Run(status, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			a := &Adapter{Adapter: &compat.Adapter{}}
			field := reflect.ValueOf(a.Adapter).Elem().FieldByName("db")
			reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
			q := url.Values{"current_user": {"U1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}, "current_user_scopes": {"aims.read aims:product-cost-rules:status"}}
			requestID := "00000000-0000-4000-8000-000000000001"
			b := map[string]any{"requestId": requestID, "authorization": map[string]any{"actorUid": "U1", "projectId": "1", "projectCode": "PRJ1", "resource": "projects", "action": "edit", "purpose": "product_cost_rules_status", "expiresAt": float64(time.Now().Add(15 * time.Second).UnixMilli())}}
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT project_code FROM aims_projects WHERE id").WithArgs(int64(1)).WillReturnRows(sqlmock.NewRows([]string{"project_code"}).AddRow("PRJ1"))
			rows := sqlmock.NewRows([]string{"status"})
			if status != "missing" {
				rows.AddRow(status)
			}
			mock.ExpectQuery("SELECT status FROM integration_operation WHERE operation_id=.*original_actor_uid=.*JSON_UNQUOTE").WithArgs(requestID, "TENANT", "AIMS", productCostRulesOperationCode, "U1", "PRJ1").WillReturnRows(rows)
			if status == "missing" {
				mock.ExpectRollback()
			} else {
				mock.ExpectCommit()
			}
			data, _, handled, err := a.handleProductCostFreezeRuntime(context.Background(), "POST", "/v1/aims/internal/product-cost-rules:status", q, b)
			if !handled {
				t.Fatal("not handled")
			}
			if status == "missing" {
				if err == nil {
					t.Fatal("missing request accepted")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				result := data.(map[string]any)
				if len(result) != 5 || result["synced"] != (status == "succeeded") || result["pending"] != (status == "retry_wait") {
					t.Fatalf("%v", result)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
