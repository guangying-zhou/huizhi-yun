package assets

import (
	"context"
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
