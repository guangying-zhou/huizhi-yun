package assets

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestListProductsFiltersMultipleProductCodesInOneQuery(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)FROM product_assets p.*AND p\.product_code IN \(\?,\?\).*GROUP BY p\.id`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "product_code", "product_name", "status", "asset_count", "base_count"}).
			AddRow(int64(2), "PROD-2", "产品二", "mvp", int64(0), int64(0)).
			AddRow(int64(1), "PROD-1", "产品一", "pmf", int64(0), int64(0)))

	result, err := adapter.listProducts(context.Background(), url.Values{
		"product_codes": {"PROD-1, PROD-2,PROD-1"},
		"current_user":  {"u1"}, assetsObjectAccessQueryKey: {"all"},
	})
	if err != nil {
		t.Fatalf("listProducts: %v", err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %#v", result["items"])
	}
	if result["total"] != 2 {
		t.Fatalf("total = %#v", result["total"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUniqueCSVValuesTrimsAndDeduplicates(t *testing.T) {
	values := uniqueCSVValues(" PROD-1,PROD-2, PROD-1, ,PROD-3 ")
	if len(values) != 3 || values[0] != "PROD-1" || values[1] != "PROD-2" || values[2] != "PROD-3" {
		t.Fatalf("values = %#v", values)
	}
}

func TestProductDetailRequiresScopeBeforeStorage(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	for _, query := range []url.Values{{}, {"current_user": {"u1"}}, {"current_user": {"u1"}, assetsObjectAccessQueryKey: {"none"}}} {
		if _, err := adapter.getProduct(context.Background(), 7, query); err == nil {
			t.Fatal("missing scope allowed")
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductDetailAppliesOwnerAndProjectBeforeRelatedReads(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)WHERE p.id = \? AND .*business_owner_uid.*technical_owner_uid.* AND p.project_code IN \(\?\)`).WithArgs(int64(7), "u1", "P1").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	_, err := adapter.getProduct(context.Background(), 7, url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"projectCodes":["P1"]}]`}})
	if err == nil {
		t.Fatal("out-of-scope record returned")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductListAndServiceRoutesKeepSeparateAuthorization(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	if _, err := a.listProducts(context.Background(), url.Values{}); err == nil {
		t.Fatal("unscoped user list allowed")
	}
	for _, scope := range []string{"assets.read", "assets:read", "*"} {
		_, _, handled, err := a.handleProductCatalogRuntime(context.Background(), "GET", "/v1/assets/service/products", url.Values{"current_user_scopes": {scope}})
		if !handled || err == nil {
			t.Fatal("service scope accepted", scope)
		}
	}
	q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"projectCodes":["P1"]}]`}}
	m.ExpectQuery(`(?s)FROM product_assets p.*business_owner_uid.*technical_owner_uid.* AND p.project_code IN \(\?\).*GROUP BY p.id`).WillReturnRows(sqlmock.NewRows([]string{"id", "product_code", "status", "asset_count"}).AddRow(1, "PROD-1", "mvp", 0))
	result, err := a.listProducts(context.Background(), q)
	if err != nil || result["total"] != 1 {
		t.Fatalf("scoped list %v %v", result, err)
	}
	valid := url.Values{"hzy_runtime_source_app": {"assets"}, "hzy_runtime_tenant_code": {"tenant"}, "hzy_runtime_deployment_code": {"deployment"}, "hzy_runtime_service_client_id": {"assets.runtime"}, "current_user_scopes": {"assets.read assets:product:read"}}
	m.ExpectQuery(`(?s)FROM product_assets p.*AND 1=1.*GROUP BY p.id`).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	if _, _, handled, err := a.handleProductCatalogRuntime(context.Background(), "GET", "/v1/assets/service/products", valid); !handled || err != nil {
		t.Fatalf("service directory: %v", err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductUpdateScopeIsTransactional(t *testing.T) {
	for _, scenario := range []string{"denied", "moved-out", "allowed"} {
		t.Run(scenario, func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsPermissionActionQueryKey: {"edit"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true}]`}}
			m.ExpectBegin()
			first := sqlmock.NewRows([]string{"id"})
			if scenario != "denied" {
				first.AddRow(7)
			}
			m.ExpectQuery(`SELECT p.id FROM product_assets p WHERE p.id=\? AND .*business_owner_uid.*FOR UPDATE`).WithArgs(int64(7), "u1").WillReturnRows(first)
			if scenario != "denied" {
				m.ExpectExec(`UPDATE product_assets`).WillReturnResult(sqlmock.NewResult(0, 1))
				after := sqlmock.NewRows([]string{"id"})
				if scenario == "allowed" {
					after.AddRow(7)
				}
				m.ExpectQuery(`SELECT p.id FROM product_assets p WHERE p.id=\? AND .*business_owner_uid.*FOR UPDATE`).WithArgs(int64(7), "u1").WillReturnRows(after)
			}
			if scenario == "allowed" {
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			err := a.updateProduct(context.Background(), 7, map[string]any{"product_name": "Updated"}, q)
			if (err == nil) != (scenario == "allowed") {
				t.Fatalf("unexpected result %v", err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductCreateRequiresScopeAndRollsBackOutOfScopeOwner(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		t.Run(map[bool]string{false: "denied", true: "allowed"}[allowed], func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			if _, err := a.createProduct(context.Background(), map[string]any{}, url.Values{}); err == nil {
				t.Fatal("anonymous create allowed")
			}
			q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsPermissionActionQueryKey: {"edit"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"projectCodes":["P1"]}]`}}
			m.ExpectBegin()
			m.ExpectExec(`INSERT INTO product_assets`).WillReturnResult(sqlmock.NewResult(7, 1))
			rows := sqlmock.NewRows([]string{"id"})
			if allowed {
				rows.AddRow(7)
			}
			m.ExpectQuery(`SELECT p.id FROM product_assets p WHERE p.id=\? AND .*business_owner_uid.* AND p.project_code IN \(\?\).*FOR UPDATE`).WithArgs(int64(7), "u1", "P1").WillReturnRows(rows)
			if allowed {
				m.ExpectExec(`INSERT INTO asset_events`).WillReturnResult(sqlmock.NewResult(1, 1))
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			id, err := a.createProduct(context.Background(), map[string]any{"product_name": "New", "business_owner_uid": "u1", "project_code": "P1"}, q)
			if (err == nil) != allowed {
				t.Fatalf("unexpected %v", err)
			}
			if allowed && id != 7 {
				t.Fatalf("id %d", id)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductRelationsCheckParentInsideTransaction(t *testing.T) {
	for _, kind := range []string{"base", "asset", "document"} {
		t.Run(kind, func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsPermissionActionQueryKey: {"edit"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true}]`}}
			if kind == "document" {
				for _, column := range []string{"artifact_type", "source_context"} {
					m.ExpectQuery(`(?s)FROM information_schema.COLUMNS`).WithArgs("asset_documents", column).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				}
			}
			m.ExpectBegin()
			m.ExpectQuery(`SELECT p.id FROM product_assets p WHERE p.id=\? AND .*FOR UPDATE`).WithArgs(int64(7), "u1").WillReturnRows(sqlmock.NewRows([]string{"id"}))
			m.ExpectRollback()
			var err error
			if kind == "base" {
				err = a.linkProductBase(context.Background(), 7, map[string]any{"technology_base_id": 9}, q)
			} else if kind == "document" {
				err = a.linkProductDocument(context.Background(), 7, map[string]any{"document_id": "00000000-0000-4000-8000-000000000001"}, q)
			} else {
				err = a.linkProductAsset(context.Background(), 7, map[string]any{"asset_id": 9}, q)
			}
			if err == nil {
				t.Fatal("out-of-scope parent allowed")
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductAssetTargetHasIndependentScope(t *testing.T) {
	for _, access := range []string{"", "none", "relation", "all"} {
		t.Run(access, func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"all"}, assetsPermissionActionQueryKey: {"edit"}, "current_user_product_target_access": {access}, "current_user_product_target_units": {`[{"projectCodes":["P1"]}]`}}
			m.ExpectBegin()
			m.ExpectQuery(`SELECT p.id.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
			if access == "relation" {
				m.ExpectQuery(`SELECT ai.id.*archived_at IS NULL.*project_code IN \(\?\).*FOR UPDATE`).WithArgs(int64(9), "P1").WillReturnRows(sqlmock.NewRows([]string{"id"}))
			}
			if access == "all" {
				m.ExpectQuery(`SELECT ai.id.*archived_at IS NULL.*FOR UPDATE`).WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
				m.ExpectExec(`INSERT INTO product_asset_resources`).WillReturnResult(sqlmock.NewResult(1, 1))
				m.ExpectExec(`INSERT INTO asset_events`).WillReturnResult(sqlmock.NewResult(1, 1))
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			err := a.linkProductAsset(context.Background(), 7, map[string]any{"asset_id": 9}, q)
			if (err == nil) != (access == "all") {
				t.Fatalf("unexpected %v", err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductBaseTargetHasIndependentScope(t *testing.T) {
	for _, access := range []string{"", "none", "relation", "all"} {
		t.Run(access, func(t *testing.T) {
			a, m, closeDB := newAssetsSQLMockAdapter(t)
			defer closeDB()
			q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"all"}, assetsPermissionActionQueryKey: {"edit"}, "current_user_product_target_access": {access}, "current_user_product_target_units": {`[{"projectCodes":["P1"]}]`}}
			m.ExpectBegin()
			m.ExpectQuery(`SELECT p.id.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
			if access == "relation" {
				m.ExpectQuery(`SELECT tb.id.*.*project_code IN \(\?\).*FOR UPDATE`).WithArgs(int64(9), "P1").WillReturnRows(sqlmock.NewRows([]string{"id"}))
			}
			if access == "all" {
				m.ExpectQuery(`SELECT tb.id.*.*FOR UPDATE`).WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
				m.ExpectExec(`INSERT INTO product_asset_bases`).WillReturnResult(sqlmock.NewResult(1, 1))
				m.ExpectExec(`INSERT INTO asset_events`).WillReturnResult(sqlmock.NewResult(1, 1))
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			err := a.linkProductBase(context.Background(), 7, map[string]any{"technology_base_id": 9}, q)
			if (err == nil) != (access == "all") {
				t.Fatalf("unexpected %v", err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductDocumentRejectsInvalidIdentityBeforeStorage(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	valid := "00000000-0000-4000-8000-000000000001"
	for _, body := range []map[string]any{{}, {"document_id": "DOC-1"}, {"document_id": 7}, {"document_id": "00000000-0000-0000-0000-000000000000"}, {"document_id": " " + valid}, {"document_id": valid, "document_uuid": "00000000-0000-4000-8000-000000000002"}} {
		if err := a.linkProductDocument(context.Background(), 7, body, url.Values{}); err == nil {
			t.Fatal("invalid identity allowed", body)
		}
	}
	for _, key := range []string{"document_id", "document_uuid", "documentUuid"} {
		if got, err := productDocumentIdentity(map[string]any{key: valid}); err != nil || got != valid {
			t.Fatalf("valid alias %s: %v", key, err)
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
