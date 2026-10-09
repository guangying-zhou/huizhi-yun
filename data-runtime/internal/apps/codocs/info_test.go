package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func newInfoAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return &Adapter{db: db}, mock, func() { _ = db.Close() }
}

func TestInfoListPaginatesAndProjectsViewers(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	query := url.Values{"page": {"2"}, "pageSize": {"10"}, "category": {"news"}}
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM info_items i WHERE 1=1 AND i\\.category = \\?").
		WithArgs("news").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(21))
	mock.ExpectQuery("(?s)SELECT i\\.id, i\\.bookmark_id, i\\.title.*FROM info_items i.*WHERE 1=1 AND i\\.category = \\?.*LIMIT \\? OFFSET \\?").
		WithArgs("news", 10, 10).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "bookmark_id", "title", "category", "summary", "author", "oss_path", "published_at", "cover_image", "view_count", "viewers", "source_url",
		}).AddRow(9, "bookmark-9", "News", "news", "Summary", "Author", "info/news.md", "2026-07-11", nil, 8, `[{"uid":"u-1","realName":"One"}]`, "https://example.test/news"))
	mock.ExpectQuery("(?s)SELECT MAX\\(COALESCE\\(b\\.post_time, i\\.published_at\\)\\).*FROM info_items i.*WHERE 1=1 AND i\\.category = \\?").
		WithArgs("news").
		WillReturnRows(sqlmock.NewRows([]string{"MAX"}).AddRow("2026-07-11"))

	result, err := adapter.infoList(context.Background(), query)
	if err != nil {
		t.Fatalf("infoList: %v", err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || int64Value(items[0]["view_count"]) != 1 {
		t.Fatalf("items = %#v, want projected one-viewer item", items)
	}
	if _, present := items[0]["viewers"]; present {
		t.Fatalf("list projection must not expose viewers: %#v", items[0])
	}
	pagination := result["pagination"].(map[string]any)
	if pagination["page"] != 2 || pagination["pageSize"] != 10 || pagination["totalPages"] != int64(3) {
		t.Fatalf("pagination = %#v, want page 2 / size 10 / total pages 3", pagination)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestInfoBookmarksWhitelistsStatusesBeforeQuerying(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	query := url.Values{"status": {"pending,unknown,pending,processed"}}
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM info_bookmarks WHERE 1=1 AND status IN \\(\\?,\\?\\)").
		WithArgs("pending", "processed").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery("SELECT \\* FROM info_bookmarks WHERE 1=1 AND status IN \\(\\?,\\?\\) ORDER BY post_time DESC LIMIT \\? OFFSET \\?").
		WithArgs("pending", "processed", 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}).AddRow("bookmark-1", "pending"))

	result, err := adapter.infoBookmarks(context.Background(), query)
	if err != nil {
		t.Fatalf("infoBookmarks: %v", err)
	}
	if got := result["items"].([]map[string]any); len(got) != 1 || got[0]["status"] != "pending" {
		t.Fatalf("items = %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("status whitelist must define SQL args: %v", err)
	}
}

func TestUpdateInfoBookmarksIgnoreUsesRequestedIDs(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectExec("UPDATE info_bookmarks SET status = 'ignored' WHERE id IN \\(\\?,\\?\\)").
		WithArgs("bookmark-1", "bookmark-2").
		WillReturnResult(sqlmock.NewResult(0, 2))
	result, err := adapter.updateInfoBookmarks(context.Background(), map[string]any{
		"action": "ignore",
		"ids":    []any{"bookmark-1", "bookmark-2"},
	})
	if err != nil {
		t.Fatalf("updateInfoBookmarks ignore: %v", err)
	}
	if result["updated"] != 2 {
		t.Fatalf("result = %#v, want two updated bookmarks", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ignore SQL mismatch: %v", err)
	}
}

func TestUpdateInfoBookmarksProcessValidatesCategoryAndUsesRequestedIDs(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectExec("UPDATE info_bookmarks SET status = 'processing' WHERE id IN \\(\\?,\\?\\)").
		WithArgs("bookmark-1", "bookmark-2").
		WillReturnResult(sqlmock.NewResult(0, 2))
	result, err := adapter.updateInfoBookmarks(context.Background(), map[string]any{
		"action":   "process",
		"ids":      []string{"bookmark-1", "bookmark-2"},
		"category": "auto",
	})
	if err != nil {
		t.Fatalf("updateInfoBookmarks process: %v", err)
	}
	if result["updated"] != 2 || result["category"] != "auto" {
		t.Fatalf("result = %#v, want processing response", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("process SQL mismatch: %v", err)
	}
}

func TestUpdateInfoBookmarksProcessRejectsInvalidCategoryBeforeSQL(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	if _, err := adapter.updateInfoBookmarks(context.Background(), map[string]any{
		"action":   "process",
		"ids":      []string{"bookmark-1"},
		"category": "forged",
	}); err == nil {
		t.Fatal("process must reject a category outside the explicit allowlist")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("invalid process category must not issue SQL: %v", err)
	}
}

func TestImportInfoBookmarksCommitsInsertedBookmark(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT author_handle FROM info_bookmarks WHERE id = \\? LIMIT 1").
		WithArgs("1234567890123456789").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)INSERT INTO info_bookmarks.*VALUES").
		WithArgs("1234567890123456789", "writer", "snippet", "full", "https://example.test/source", 1, "Article", "cover.png", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.importInfoBookmarks(context.Background(), map[string]any{"bookmarks": []any{map[string]any{
		"id":                "1234567890123456789",
		"author_handle":     "writer",
		"content_snippet":   "snippet",
		"full_content":      "full",
		"source_url":        "https://example.test/source",
		"has_external_link": true,
		"article_title":     "Article",
		"cover_image":       "cover.png",
	}}})
	if err != nil {
		t.Fatalf("importInfoBookmarks: %v", err)
	}
	if result["inserted"] != 1 || result["updated"] != 0 || result["skipped"] != 0 {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bookmark insert must commit: %v", err)
	}
}

func TestImportInfoBookmarksRollsBackWhenInsertFails(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT author_handle FROM info_bookmarks WHERE id = \\? LIMIT 1").
		WithArgs("bookmark-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)INSERT INTO info_bookmarks.*VALUES").
		WillReturnError(errors.New("insert failed"))
	mock.ExpectRollback()

	_, err := adapter.importInfoBookmarks(context.Background(), map[string]any{"bookmarks": []map[string]any{{"id": "bookmark-1"}}})
	if err == nil {
		t.Fatal("importInfoBookmarks must return the insert failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("failed bookmark insert must roll back: %v", err)
	}
}

func TestCreateInfoItemFromBookmarkCommitsBookmarkAndItemTogether(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE info_bookmarks SET status = 'processed' WHERE id = \\?").
		WithArgs("bookmark-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)INSERT INTO info_items.*VALUES").
		WithArgs("bookmark-1", "Published", "news", "summary", "writer", "info/published.md", "cover.png").
		WillReturnResult(sqlmock.NewResult(71, 1))
	mock.ExpectCommit()

	result, err := adapter.createInfoItemFromBookmark(context.Background(), map[string]any{
		"bookmark_id": "bookmark-1",
		"title":       "Published",
		"category":    "news",
		"summary":     "summary",
		"author":      "writer",
		"oss_path":    "info/published.md",
		"cover_image": "cover.png",
	})
	if err != nil {
		t.Fatalf("createInfoItemFromBookmark: %v", err)
	}
	if int64Value(result["id"]) != 71 || result["created"] != true {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bookmark state and item insert must commit together: %v", err)
	}
}

func TestCreateInfoItemFromBookmarkRollsBackBookmarkWhenItemInsertFails(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE info_bookmarks SET status = 'processed' WHERE id = \\?").
		WithArgs("bookmark-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)INSERT INTO info_items.*VALUES").
		WillReturnError(errors.New("item insert failed"))
	mock.ExpectRollback()

	_, err := adapter.createInfoItemFromBookmark(context.Background(), map[string]any{
		"bookmark_id": "bookmark-1",
		"title":       "Published",
		"category":    "article",
		"oss_path":    "info/published.md",
	})
	if err == nil {
		t.Fatal("createInfoItemFromBookmark must return the item insert failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bookmark processed transition must roll back with item insert: %v", err)
	}
}

func TestDeleteInfoItemRestoresSourceBookmark(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectQuery("SELECT id, bookmark_id, oss_path FROM info_items WHERE id = \\? LIMIT 1").
		WithArgs("71").
		WillReturnRows(sqlmock.NewRows([]string{"id", "bookmark_id", "oss_path"}).AddRow(71, "bookmark-1", "info/published.md"))
	mock.ExpectExec("DELETE FROM info_items WHERE id = \\?").
		WithArgs("71").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE info_bookmarks SET status = 'pending' WHERE id = \\?").
		WithArgs("bookmark-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.deleteInfoItem(context.Background(), "71")
	if err != nil {
		t.Fatalf("deleteInfoItem: %v", err)
	}
	if result["restoredBookmarkId"] != "bookmark-1" || result["deleted"] != true {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("delete must restore source bookmark: %v", err)
	}
}

func TestInfoDetailDoesNotDuplicateExistingReader(t *testing.T) {
	adapter, mock, closeDB := newInfoAdapter(t)
	defer closeDB()

	mock.ExpectQuery("(?s)SELECT i\\.\\*, b\\.source_url.*FROM info_items i.*WHERE i\\.id = \\?.*LIMIT 1").
		WithArgs("71").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "viewers", "view_count", "source_url"}).
			AddRow(71, "Published", `[{"uid":"reader-1","realName":"Reader"}]`, 1, "https://example.test/source"))

	result, err := adapter.infoDetail(context.Background(), "71", url.Values{"actorUid": {"reader-1"}, "actorName": {"Different name"}})
	if err != nil {
		t.Fatalf("infoDetail: %v", err)
	}
	if int64Value(result["view_count"]) != 1 {
		t.Fatalf("view_count = %#v, reader should be deduplicated", result["view_count"])
	}
	viewers := result["viewers"].([]map[string]string)
	if len(viewers) != 1 || viewers[0]["uid"] != "reader-1" {
		t.Fatalf("viewers = %#v, reader should occur once", viewers)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("existing reader must not issue an update: %v", err)
	}
}
