package codocs

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func assetAccessQuery(action string) url.Values {
	return url.Values{"current_user": {"U001"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"codocs"}, companyAssetAccessActionKey: {action}, "path": {"codocs/company/rules/test.md"}, "eventId": {"550e8400-e29b-41d4-a716-446655440000"}}
}

func TestCompanyAssetAccessRejectsUntrustedContexts(t *testing.T) {
	for _, action := range []string{"record", "list", "export"} {
		for _, field := range []string{"current_user", "hzy_runtime_actor_delegated", "hzy_runtime_source_app", companyAssetAccessActionKey} {
			t.Run(action+"/"+field, func(t *testing.T) {
				q := assetAccessQuery(action)
				q.Del(field)
				a := &Adapter{}
				var err error
				if action == "record" {
					_, err = a.recordCompanyAssetAccess(context.Background(), q)
				} else {
					_, err = a.listCompanyAssetAccessRecords(context.Background(), q, action == "export")
				}
				if err == nil {
					t.Fatal("untrusted request accepted")
				}
			})
		}
	}
	q := assetAccessQuery("export")
	q.Set("hzy_runtime_source_app", "aims")
	if _, _, err := companyAssetAccessContext(q, "export"); err == nil {
		t.Fatal("another app can forge Codocs authorization")
	}
	q = assetAccessQuery("list")
	if _, _, err := companyAssetAccessContext(q, "export"); err == nil {
		t.Fatal("read authorization grants export")
	}
}

func TestCompanyAssetAccessValidatesPathsAndDateFilters(t *testing.T) {
	for _, path := range []string{"codocs/company/../private.md", "codocs/users/U001/a.md", "codocs/company//a.md", "codocs/company/a\x01.md", "codocs/company/"} {
		q := assetAccessQuery("list")
		q.Set("path", path)
		if _, _, err := companyAssetAccessContext(q, "list"); err == nil {
			t.Fatalf("accepted path %q", path)
		}
	}
	for _, dates := range [][2]string{{"2026-02-30", ""}, {"2026-09-11", "2026-09-10"}, {"", "invalid"}} {
		q := assetAccessQuery("list")
		q.Set("from", dates[0])
		q.Set("to", dates[1])
		if _, err := (&Adapter{}).listCompanyAssetAccessRecords(context.Background(), q, false); err == nil {
			t.Fatal("accepted invalid dates")
		}
	}
}

func TestCompanyAssetAccessRecordsVerifiedActorAndServerTimeWithRetryKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	q := assetAccessQuery("record")
	q.Set("viewerUid", "victim")
	q.Set("viewedAt", "2000-01-01")
	hash := sha256.Sum256([]byte(q.Get("path")))
	for i := 0; i < 2; i++ {
		mock.ExpectExec(`(?s)INSERT INTO company_asset_access_records.*UTC_TIMESTAMP\(3\).*ON DUPLICATE KEY UPDATE id = id`).WithArgs(q.Get("eventId"), hash[:], q.Get("path"), "U001").WillReturnResult(sqlmock.NewResult(0, 1))
		if _, err := (&Adapter{db: db}).recordCompanyAssetAccess(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompanyAssetAccessPersistenceFailureIsReturned(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec(`INSERT INTO company_asset_access_records`).WillReturnError(errors.New("storage unavailable"))
	if _, err := (&Adapter{db: db}).recordCompanyAssetAccess(context.Background(), assetAccessQuery("record")); err == nil {
		t.Fatal("storage failure swallowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompanyAssetAccessListBindsPathAndInclusiveUTCDates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	q := assetAccessQuery("list")
	q.Set("from", "2026-09-10")
	q.Set("to", "2026-09-10")
	q.Set("page", "2")
	q.Set("pageSize", "20")
	hash := sha256.Sum256([]byte(q.Get("path")))
	mock.ExpectQuery(`SELECT COUNT\(\*\).*oss_path_hash = \? AND BINARY oss_path = \? AND viewed_at >= \? AND viewed_at < \?`).WithArgs(hash[:], q.Get("path"), "2026-09-10 00:00:00", "2026-09-11 00:00:00").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(21))
	mock.ExpectQuery(`(?s)SELECT id, viewer_uid AS viewerUid.*ORDER BY viewed_at DESC, id DESC LIMIT \? OFFSET \?`).WithArgs(hash[:], q.Get("path"), "2026-09-10 00:00:00", "2026-09-11 00:00:00", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id", "viewerUid", "ossPath", "viewedAt"}).AddRow("id-1", "U002", q.Get("path"), "2026-09-10T10:00:00.000Z"))
	result, err := (&Adapter{db: db}).listCompanyAssetAccessRecords(context.Background(), q, false)
	if err != nil {
		t.Fatal(err)
	}
	if result["total"] != int64(21) || len(result["items"].([]map[string]any)) != 1 {
		t.Fatalf("wrong result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompanyAssetAccessExportRejectsOversizedResults(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COUNT\(\*\)`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(50001))
	if _, err := (&Adapter{db: db}).listCompanyAssetAccessRecords(context.Background(), assetAccessQuery("export"), true); err == nil {
		t.Fatal("oversize export silently allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
