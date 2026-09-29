package assets

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductCatalogRequiresExactTrustedService(t *testing.T) {
	valid := url.Values{"hzy_runtime_source_app": {"assets"}, "hzy_runtime_tenant_code": {"tenant"}, "hzy_runtime_deployment_code": {"deployment"}, "hzy_runtime_service_client_id": {"assets.runtime"}, "current_user_scopes": {"assets.read assets:product:read"}}
	if err := requireProductCatalogService(valid); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		if err := requireProductCatalogService(q); err == nil {
			t.Fatalf("accepted missing %s", key)
		}
	}
	valid.Set("hzy_runtime_service_client_id", "aims.runtime")
	if requireProductCatalogService(valid) == nil {
		t.Fatal("accepted another service client")
	}
	valid.Set("hzy_runtime_service_client_id", "assets.runtime")
	for _, scope := range []string{"assets.read", "assets:read", "assets:*", "*"} {
		valid.Set("current_user_scopes", scope)
		if requireProductCatalogService(valid) == nil {
			t.Fatalf("accepted broad scope %s", scope)
		}
	}
}

func TestProductCatalogPageUsesBoundedSQLAndSnapshotWatermark(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	m.ExpectBegin()
	m.ExpectQuery(`SELECT CONCAT`).WillReturnRows(sqlmock.NewRows([]string{"watermark", "ready"}).AddRow("epoch:5", 1))
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM product_assets`).WithArgs("", "", "software", "software", "", "", "").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(101))
	m.ExpectQuery(`(?s)SELECT p.product_code.*ORDER BY BINARY p.product_code,p.id LIMIT \? OFFSET \?`).WithArgs("", "", "software", "software", "", "", "", 100, 100).WillReturnRows(sqlmock.NewRows([]string{"code", "name", "line", "label", "sort", "status", "business", "technical", "updated"}).AddRow("P-101", "Final", "software", "Software", 1, "eol", nil, nil, "2026-09-07T12:00:00.000Z"))
	m.ExpectCommit()
	p, err := a.productCatalog(context.Background(), url.Values{"page": {"2"}, "pageSize": {"100"}, "productLine": {"software"}, "watermark": {"epoch:5"}})
	if err != nil {
		t.Fatal(err)
	}
	if p.Total != 101 || p.Page != 2 || p.NextPage != nil || len(p.Items) != 1 || p.Items[0].Onboardable {
		t.Fatalf("unexpected page %#v", p)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductCatalogRejectsChangedOrMissingWatermarkBeforeRows(t *testing.T) {
	for _, test := range []struct {
		name, expected string
		ready          int
	}{{"changed", "epoch:4", 1}, {"missing", "", 1}, {"migration", "epoch:5", 0}} {
		t.Run(test.name, func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			m.ExpectBegin()
			m.ExpectQuery(`SELECT CONCAT`).WillReturnRows(sqlmock.NewRows([]string{"watermark", "ready"}).AddRow("epoch:5", test.ready))
			m.ExpectRollback()
			_, err := a.productCatalog(context.Background(), url.Values{"page": {"2"}, "watermark": {test.expected}})
			if err == nil {
				t.Fatal("expected rejection")
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductCatalogRejectsInvalidPagingBeforeDatabase(t *testing.T) {
	for _, raw := range []string{"0", "-1", "01", "1.5", "101", "100000000000000000000"} {
		if _, err := catalogPageNumber(raw, 100, 100); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}

func TestProductCatalogExportRequiresNarrowScopeAndRegisteredFields(t *testing.T) {
	valid := url.Values{"hzy_runtime_source_app": {"assets"}, "hzy_runtime_tenant_code": {"tenant"}, "hzy_runtime_deployment_code": {"deployment"}, "hzy_runtime_service_client_id": {"assets.runtime"}, "current_user_scopes": {"assets:product:read assets:product:export"}}
	if err := requireProductCatalogExportService(valid); err != nil {
		t.Fatal(err)
	}
	for _, scopes := range []string{"assets:product:read", "assets:product:export", "assets:*", "*"} {
		valid.Set("current_user_scopes", scopes)
		if requireProductCatalogExportService(valid) == nil {
			t.Fatalf("accepted incomplete or broad export scope %q", scopes)
		}
	}
	for _, fields := range []string{"", "product_code,business_owner_uid", "product_code,technical_owner_uid", "product_code,source_updated_at", "product_code,product_code", "product_code, product_name"} {
		if _, err := parseProductCatalogExportFields(fields); err == nil {
			t.Fatalf("accepted export fields %q", fields)
		}
	}
	if fields, err := parseProductCatalogExportFields("product_code,product_name,product_line_label,source_status,onboardable"); err != nil || len(fields) != 5 {
		t.Fatalf("registered fields rejected: %v %#v", err, fields)
	}
}

func TestProductCatalogExportPreservesScopedPagingWithoutHiddenRelations(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	m.ExpectBegin()
	m.ExpectQuery(`SELECT CONCAT`).WillReturnRows(sqlmock.NewRows([]string{"watermark", "ready"}).AddRow("epoch:8", 1))
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM product_assets`).WithArgs("", "", "software", "software", "", "", "").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	m.ExpectQuery(`(?s)SELECT p.product_code.*LIMIT \? OFFSET \?`).WithArgs("", "", "software", "software", "", "", "", 1, 1).WillReturnRows(sqlmock.NewRows([]string{"code", "name", "line", "label", "sort", "status", "business", "technical", "updated"}).AddRow("P-002", "Visible", "software", "Software", 1, "mvp", "secret-owner", "secret-tech", "2026-09-15T00:00:00.000Z"))
	m.ExpectCommit()
	result, err := a.productCatalogExport(context.Background(), url.Values{"page": {"2"}, "pageSize": {"1"}, "productLine": {"software"}, "watermark": {"epoch:8"}, "fields": {"product_code,product_name,product_line_label"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 2 || result.Page != 2 || result.PageSize != 1 || result.NextPage != nil || len(result.Items) != 1 {
		t.Fatalf("export paging changed: %#v", result)
	}
	row := result.Items[0]
	if len(row) != 3 || row["product_code"] != "P-002" || row["product_name"] != "Visible" {
		t.Fatalf("unexpected export projection %#v", row)
	}
	for _, hidden := range []string{"business_owner_uid", "technical_owner_uid", "source_updated_at", "product_line_sort_order", "assets", "technology_bases", "documents"} {
		if _, leaked := row[hidden]; leaked {
			t.Fatalf("hidden field or relation leaked: %s", hidden)
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductCatalogUnregisteredExportsRemainUnhandled(t *testing.T) {
	a, _, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	for _, path := range []string{"/v1/assets/service/products/export", "/v1/assets/service/products/catalog/export-all", "/v1/assets/service/products/catalog.csv"} {
		if _, _, handled, _ := a.handleProductCatalogRuntime(context.Background(), http.MethodGet, path, url.Values{}); handled {
			t.Fatalf("unregistered export handled: %s", path)
		}
	}
}
