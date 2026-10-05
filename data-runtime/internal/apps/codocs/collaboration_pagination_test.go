package codocs

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"testing"
)

func collabPageRows() *sqlmock.Rows {
	columns := []string{"document_id", "document_uuid", "title", "doc_type", "oss_path", "owner_uid", "dept_code", "readonly_flag", "status", "publish_info", "updated_at", "relation_type", "source_type", "source_id", "can_edit", "relation_metadata", "review_id", "review_status", "review_type", "review_sub_type", "review_execution_status", "review_current_node", "flow_snapshot"}
	return sqlmock.NewRows(columns).
		AddRow(3, "C", "third", "private", "", "owner-c", "D3", 0, 1, nil, "2026-01-01", "shared_with_me", "share", "1", 1, nil, nil, nil, nil, nil, nil, 0, "[]").
		AddRow(2, "B", "second", "private", "", "owner-b", "D2", 0, 1, nil, "2026-01-01", "shared_by_me", "share", "1", 1, nil, nil, nil, nil, nil, nil, 0, "[]").
		AddRow(1, "A", "first", "private", "", "owner-a", "D1", 0, 1, nil, "2026-01-01", "shared_to_me", "share", "1", 1, nil, nil, nil, nil, nil, nil, 0, "[]").
		AddRow(1, "A", "first", "private", "", "owner-a", "D1", 0, 1, nil, "2026-01-01", "shared_by_me", "share", "2", 1, nil, nil, nil, nil, nil, nil, 0, "[]")
}
func TestCollaborationPageCountsMergedVisibleScopeBeforePaging(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)WHERE dr.related_uid = \? AND dr.status = 1 AND d.status != 0 AND dr.relation_type LIKE \?.*ORDER BY d.updated_at DESC, d.id DESC, dr.id ASC`).WithArgs("viewer", "shared_%").WillReturnRows(collabPageRows())
	mock.ExpectCommit()
	result, err := a.collabDocs(context.Background(), url.Values{"current_user": {"viewer"}, "category": {"shared"}, "scope": {"all"}, "sharedTab": {"received"}, "page": {"2"}, "pageSize": {"1"}})
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if result["total"] != 2 || len(items) != 1 || items[0]["uuid"] != "A" || len(items[0]["relationTypes"].([]string)) != 2 {
		t.Fatal(result)
	}
	if len(result["ownerUids"].([]string)) != 2 || len(result["deptCodes"].([]string)) != 2 {
		t.Fatal("metadata truncated to current page", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestCollaborationSharedTabsAndBounds(t *testing.T) {
	both := map[string]any{"relationTypes": []string{"shared_by_me", "shared_with_me"}}
	for _, tab := range []string{"received", "sent", ""} {
		if !includeCollabSharedTab(both, tab) {
			t.Fatal(tab)
		}
	}
	out := pageCollabDocs([]map[string]any{{"uuid": "A", "updatedAt": "2026-01-01", "ownerUid": "a"}, {"uuid": "B", "updatedAt": "2026-01-01", "ownerUid": "b"}}, 9, 100)
	if out["total"] != 2 || len(out["items"].([]map[string]any)) != 0 || out["pageSize"] != 100 {
		t.Fatal(out)
	}
}
