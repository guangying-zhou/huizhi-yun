package assets

import (
	"context"
	"math"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductAdoptionReaderAggregatesBeforePagination(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scope := adoptionScopeQuery("U1", "relation", assetsScopeUnit{DirectRelation: true, RelationPredicates: []string{"owner"}})
	for _, page := range []int{1, 2, math.MaxInt} {
		mock.ExpectQuery(`(?s)SELECT delivery.delivery_asset_code.*BINARY delivery.product_code=BINARY \? AND delivery.deleted_at IS NULL.*relation.deleted_at IS NULL AND relation.status='active'.*delivery.responsible_uid=\?.*environment.owner_uid=\?`).
			WithArgs("PROD-1", "U1", "U1").
			WillReturnRows(sqlmock.NewRows([]string{"asset", "environment", "customer", "role", "status", "version"}).
				AddRow("DA1", "ENV1", "CU1", "production", "online", "v1").
				AddRow("DA2", "ENV2", "CU1", "test", "deployed", "").
				AddRow("DA1", "ENV1", "CU1", "backup", "accepted", "v2"))
		got, err := readProductAdoption(context.Background(), db, "PROD-1", scope, scope, page, 1)
		if err != nil {
			t.Fatal(err)
		}
		if got.Total != 2 || got.Summary.Instances != 2 || got.Summary.Customers != 1 || got.QueriedAt.IsZero() {
			t.Fatalf("wrong summary: %+v", got)
		}
		if page == 1 && (len(got.Items) != 1 || !got.Items[0].VersionConflict) {
			t.Fatal("role rows split across pages")
		}
		if page == 2 && (len(got.Items) != 1 || got.Items[0].DeliveryAssetCode != "DA2") {
			t.Fatal("wrong second page")
		}
		if page == math.MaxInt && len(got.Items) != 0 {
			t.Fatal("overflowing page returned data")
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductAdoptionReaderRejectsBeforeDatabase(t *testing.T) {
	all := adoptionScopeQuery("U1", "all")
	denied := adoptionScopeQuery("U1", "none")
	if _, err := readProductAdoption(context.Background(), nil, "PROD-1", all, denied, 1, 20); err == nil {
		t.Fatal("missing environment access accepted")
	}
	if _, err := readProductAdoption(context.Background(), nil, "", all, all, 1, 20); err == nil {
		t.Fatal("empty product accepted")
	}
	if _, err := readProductAdoption(context.Background(), nil, "PROD-1", all, all, 0, 20); err == nil {
		t.Fatal("invalid page accepted")
	}
}
