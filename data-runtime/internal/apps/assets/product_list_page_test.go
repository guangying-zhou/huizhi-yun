package assets

import (
	"context"
	"database/sql/driver"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductPaginationKeepsScopedTotalsOnEmptyPage(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	q := url.Values{"page": {"3"}, "pageSize": {"20"}, "current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"projectCodes":["P1"]}]`}}
	args := make([]driver.Value, 15)
	args = append(args, "u1", "P1")
	m.ExpectBegin()
	m.ExpectQuery(`(?s)SELECT COUNT\(\*\).*business_owner_uid.*AND p.project_code IN \(\?\).*product_summary`).WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"total", "active", "assets"}).AddRow(23, 17, 42))
	m.ExpectQuery(`(?s)SELECT.*business_owner_uid.*AND p.project_code IN \(\?\).*LIMIT \? OFFSET \?`).WithArgs(append(args, 20, 40)...).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	m.ExpectCommit()
	result, err := a.listProducts(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if result["total"] != int64(23) || len(result["items"].([]map[string]any)) != 0 {
		t.Fatalf("page: %#v", result)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductPaginationRejectsInvalidBoundsBeforeStorage(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	for _, q := range []url.Values{{"page": {"0"}}, {"page": {"1000001"}}, {"pageSize": {"101"}}, {"pageSize": {"abc"}}} {
		q.Set("current_user", "u1")
		q.Set(assetsObjectAccessQueryKey, "all")
		if _, err := a.listProducts(context.Background(), q); err == nil {
			t.Fatalf("allowed %v", q)
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
