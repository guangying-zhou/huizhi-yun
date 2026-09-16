package aims

import (
	"context"
	"fmt"
	"net/url"
	"reflect"
	"testing"
	"unsafe"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func versionSummaryQuery() url.Values {
	return url.Values{"current_user_scopes": {productVersionSummaryCapability}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}}
}

func TestProductVersionSummaryRejectsUntrustedRequestsBeforeDatabase(t *testing.T) {
	for key, value := range map[string]string{"current_user_scopes": "aims.read aims:read", "hzy_runtime_source_app": "assets", "hzy_runtime_service_client_id": "assets.runtime", "hzy_runtime_tenant_code": "", "hzy_runtime_deployment_code": ""} {
		t.Run(key, func(t *testing.T) {
			q := versionSummaryQuery()
			q.Set(key, value)
			if _, err := (&Adapter{}).serviceProductVersionSummaries(context.Background(), "P1", q); err == nil {
				t.Fatal("untrusted query accepted")
			}
		})
	}
	for _, code := range []string{"", " P1", "P/1", "P\\1", "P\x001", string([]byte{0xff})} {
		if _, err := (&Adapter{}).serviceProductVersionSummaries(context.Background(), code, versionSummaryQuery()); err == nil {
			t.Fatalf("invalid code accepted: %q", code)
		}
	}
}

func TestMySQLProductVersionSummaryPublicCounts(t *testing.T) {
	db := handoffMySQLDatabase(t)
	// The query must not depend on project, customer, work-item, or raw feature content tables.
	for _, sql := range []string{
		`INSERT INTO product_versions(id,product_code,version_code,name,status,planned_release_date,released_at,sort_order,created_at) VALUES(1,'P1','v1','Release','released',NULL,NULL,0,NOW()),(2,'P1','v2','Empty','planning',NULL,NULL,1,NOW()),(3,'p1','private','Other','released',NULL,NULL,0,NOW())`,
		`INSERT INTO product_version_features(id,version_id,title,status,is_public) VALUES(1,1,'Public','delivered',1),(2,1,'Pending','planned',1),(3,1,'Private','delivered',0),(4,3,'Other','delivered',1)`,
	} {
		if _, err := db.Exec(sql); err != nil {
			t.Fatal(err)
		}
	}
	a := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(a.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	result, err := a.serviceProductVersionSummaries(context.Background(), "P1", versionSummaryQuery())
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 2 {
		t.Fatalf("case-sensitive product boundary: %#v", items)
	}
	for i, want := range []struct{ total, delivered string }{{"2", "1"}, {"0", "0"}} {
		row := items[i]
		if len(row) != 9 {
			t.Fatalf("unexpected summary fields: %#v", row)
		}
		if fmt.Sprint(row["feature_count"]) != want.total || fmt.Sprint(row["delivered_feature_count"]) != want.delivered {
			t.Fatalf("public counts: %#v", row)
		}
	}
}
