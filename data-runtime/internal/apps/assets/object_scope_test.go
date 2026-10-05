package assets

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func assetsScopeQuery(uid, access string) url.Values {
	query := url.Values{"current_user": {uid}, assetsObjectAccessQueryKey: {access}}
	if access == "relation" {
		query.Set(assetsScopeUnitsQueryKey, `[{"directRelation":true,"departmentCodes":[],"projectCodes":[]}]`)
	}
	return query
}

func TestAssetsObjectScopeRejectsMissingOrForgedAccess(t *testing.T) {
	for _, query := range []url.Values{
		{},
		{"current_user": {"owner"}},
		{"current_user": {"owner"}, assetsObjectAccessQueryKey: {"forged"}},
		assetsScopeQuery("owner", "none"),
	} {
		if _, _, err := assetsObjectAccess(query); err == nil {
			t.Fatalf("untrusted scope accepted: %#v", query)
		}
	}
}

func TestAssetItemObjectScopeAllowsCurrentRelationAndIndependentAll(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT ai.id FROM asset_items ai.*owner_uid.*custodian_uid.*user_uid`).
		WithArgs("pub-1", "current-owner").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	if err := a.requireAssetItemObjectAccess(context.Background(), assetsScopeQuery("current-owner", "relation"), "pub-1"); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(`(?s)SELECT ai.id FROM asset_items ai.*owner_uid.*custodian_uid.*user_uid`).
		WithArgs("pub-1", "old-owner").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	if err := a.requireAssetItemObjectAccess(context.Background(), assetsScopeQuery("old-owner", "relation"), "pub-1"); err == nil {
		t.Fatal("old relation still allowed")
	}
	if err := a.requireAssetItemObjectAccess(context.Background(), assetsScopeQuery("independent-admin", "all"), "pub-1"); err != nil {
		t.Fatal(err)
	}
}

func TestAssetItemDepartmentAndProjectUnitsStayIndependent(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	query := assetsScopeQuery("viewer", "relation")
	query.Set(assetsScopeUnitsQueryKey, `[{"directRelation":false,"departmentCodes":["D-1"],"projectCodes":[]},{"directRelation":false,"departmentCodes":[],"projectCodes":["P-1"]}]`)
	mock.ExpectQuery(`(?s)SELECT ai.id FROM asset_items ai.*dept_code IN.*OR.*project_code IN`).
		WithArgs("pub-1", "D-1", "P-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	if err := a.requireAssetItemObjectAccess(context.Background(), query, "pub-1"); err != nil {
		t.Fatal(err)
	}
}

func TestIPAssetProjectUnitUsesLinkedProductProjectCode(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	query := assetsScopeQuery("viewer", "relation")
	query.Set(assetsScopeUnitsQueryKey, `[{"directRelation":false,"departmentCodes":[],"projectCodes":["P-1"]}]`)
	mock.ExpectQuery(`(?s)SELECT ip.id FROM ip_assets ip.*scope_project_product.project_code IN`).
		WithArgs("9", "P-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
	if err := a.requireIPAssetObjectAccess(context.Background(), query, "9"); err != nil {
		t.Fatal(err)
	}
}

func TestIPAssetObjectScopeIncludesProductOwnersAndFiltersList(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT ip.id FROM ip_assets ip.*ip_asset_products.*business_owner_uid.*technical_owner_uid`).
		WithArgs("9", "product-owner", "product-owner").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
	if err := a.requireIPAssetObjectAccess(context.Background(), assetsScopeQuery("product-owner", "relation"), "9"); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM ip_assets ip.*ip_asset_products`).
		WithArgs("product-owner", "product-owner").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT ip\.\* FROM ip_assets ip.*ip_asset_products.*ORDER BY ip.id DESC LIMIT \? OFFSET \?`).
		WithArgs("product-owner", "product-owner", 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "ip_code", "owner_uid"}).AddRow(9, "IP-9", "other"))
	result, err := a.listScopedIPAssets(context.Background(), assetsScopeQuery("product-owner", "relation"))
	if err != nil || result["total"] != int64(1) {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestOffboardingPatchNeedsActionSpecificObjectScope(t *testing.T) {
	a, _, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	err := a.requireOffboardingRecoveryObjectAccess(context.Background(), assetsScopeQuery("responsible", "none"), "AOR-1")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != 403 {
		t.Fatalf("view-only scope was accepted for PATCH: %#v", err)
	}
}

func TestOffboardingListAndGetUseCurrentResponsibleUnlessIndependentAll(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)FROM asset_offboarding_recovery_cases c WHERE 1=1 AND c.status='active' AND c.recovery_responsible_uid=\?`).
		WithArgs("current-owner").
		WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "recovery_responsible_uid"}).AddRow(1, "AOR-1", "current-owner"))
	items, err := a.listOffboardingRecoveries(context.Background(), assetsScopeQuery("current-owner", "relation"))
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%#v err=%v", items, err)
	}

	mock.ExpectQuery(`(?s)FROM asset_offboarding_recovery_cases c WHERE c.case_code=\? LIMIT 1`).
		WithArgs("AOR-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "recovery_responsible_uid"}).AddRow(1, "AOR-1", "new-owner"))
	mock.ExpectQuery(`(?s)FROM asset_items ai JOIN asset_offboarding_recovery_cases`).
		WithArgs("AOR-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "asset_code"}))
	item, err := a.getOffboardingRecovery(context.Background(), "AOR-1", time.Now(), assetsScopeQuery("old-owner-with-admin", "all"))
	if err != nil || item["case_code"] != "AOR-1" {
		t.Fatalf("item=%#v err=%v", item, err)
	}
}
