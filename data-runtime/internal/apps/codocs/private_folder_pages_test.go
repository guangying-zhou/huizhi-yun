package codocs

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestPrivateFolderPageAncestryAndCountsShareSnapshot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	query := trustedDocumentListQuery("owner-a")
	query.Set("folder_type", "private")
	query.Set("parent_id", "42")
	query.Set("page", "2")
	query.Set("pageSize", "20")
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT name,parent_id FROM folders WHERE id=\\? AND folder_type='private' AND owner_uid=\\?").WithArgs(int64(42), "owner-a").WillReturnRows(sqlmock.NewRows([]string{"name", "parent_id"}).AddRow("Child", int64(9)))
	mock.ExpectQuery("SELECT name,parent_id FROM folders WHERE id=\\? AND folder_type='private' AND owner_uid=\\?").WithArgs(int64(9), "owner-a").WillReturnRows(sqlmock.NewRows([]string{"name", "parent_id"}).AddRow("Parent", nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM folders WHERE folder_type='private' AND owner_uid=\\? AND parent_id=\\?").WithArgs("owner-a", int64(42)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(23))
	mock.ExpectQuery("(?s)SELECT id,name,parent_id,sort_order,created_at,updated_at,.*FROM folders WHERE folder_type='private' AND owner_uid=\\? AND parent_id=\\?.*LIMIT \\? OFFSET \\?").WithArgs("owner-a", "owner-a", "owner-a", int64(42), 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "parent_id", "sort_order", "created_at", "updated_at", "folderCount", "documentCount"}).AddRow(51, "Leaf", int64(42), 0, "2026-09-27", "2026-09-27", 3, 7))
	mock.ExpectCommit()
	result, err := (&Adapter{db: db}).foldersList(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if result["total"] != int64(23) || result["page"] != 2 {
		t.Fatalf("wrong page %#v", result)
	}
	chain := result["parentChain"].([]map[string]any)
	if len(chain) != 2 || chain[0]["id"] != int64(9) || chain[1]["id"] != int64(42) {
		t.Fatalf("wrong chain %#v", chain)
	}
	item := result["items"].([]map[string]any)[0]
	if item["folderCount"] != int64(3) || item["documentCount"] != int64(7) {
		t.Fatalf("wrong counts %#v", item)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateFolderPageRejectsMalformedParentBeforeSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, parent := range []string{"", "01", "-1", "other"} {
		q := url.Values{"current_user": {"owner-a"}, "hzy_runtime_actor_delegated": {"1"}, "folder_type": {"private"}, "parent_id": {parent}, "page": {"1"}, "pageSize": {"20"}}
		if _, err := (&Adapter{db: db}).foldersList(context.Background(), q); err == nil {
			t.Fatalf("accepted parent %q", parent)
		}
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateDocumentPageUsesSameScopedSnapshotAndStableOrder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	query := trustedDocumentListQuery("owner-a")
	query.Set("type", "private")
	query.Set("owner", "owner-a")
	query.Set("folder_id", "42")
	query.Set("exclude_worklogs", "1")
	query.Set("page", "2")
	query.Set("pageSize", "20")
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\) FROM documents d WHERE .*d.owner_uid = \\?.*d.folder_id = \\?.*worklogs").WithArgs("owner-a", "owner-a", "owner-a", "private", "owner-a", "42").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(27))
	mock.ExpectQuery("(?s)SELECT d.id.*ORDER BY d.updated_at DESC, d.id DESC LIMIT \\? OFFSET \\?").WithArgs("owner-a", "owner-a", "owner-a", "private", "owner-a", "42", 20, 20).WillReturnRows(emptyDocumentListRows())
	mock.ExpectCommit()
	out, err := (&Adapter{db: db}).documentsList(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if out["total"] != int64(27) || out["page"] != 2 {
		t.Fatalf("wrong page %#v", out)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
