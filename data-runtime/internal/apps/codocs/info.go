package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) infoList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20)
	if pageSize > 50 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := []any{}
	category := strings.TrimSpace(query.Get("category"))
	if category == "article" || category == "news" {
		where = append(where, "i.category = ?")
		args = append(args, category)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM info_items i WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT i.id, i.bookmark_id, i.title, i.category, i.summary, i.author,
        i.oss_path, COALESCE(b.post_time, i.published_at) AS published_at,
        i.cover_image, i.view_count, i.viewers, b.source_url
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE `+whereSQL+`
      ORDER BY COALESCE(b.post_time, i.published_at) DESC
      LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		item["view_count"] = infoViewCount(item["viewers"], item["view_count"])
		delete(item, "viewers")
	}

	var lastUpdated any
	_ = a.db.QueryRowContext(ctx, `
      SELECT MAX(COALESCE(b.post_time, i.published_at))
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE `+whereSQL, args...).Scan(&lastUpdated)

	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":       page,
			"pageSize":   pageSize,
			"total":      total,
			"totalPages": int64((total + int64(pageSize) - 1) / int64(pageSize)),
		},
		"last_updated": normalizeSQLValue(lastUpdated),
	}, nil
}

func (a *Adapter) infoDetail(ctx context.Context, id string, query url.Values) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
      SELECT i.*, b.source_url
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE i.id = ?
      LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "info_not_found", "Info item not found")
	}

	item := items[0]
	viewers := infoViewers(item["viewers"])
	actorUID := strings.TrimSpace(firstNonEmpty(query.Get("actorUid"), query.Get("current_user")))
	actorName := strings.TrimSpace(firstNonEmpty(query.Get("actorName"), query.Get("current_user_name"), actorUID))
	if actorUID != "" && actorName != "" && !infoViewerExists(viewers, actorUID) {
		viewers = append(viewers, map[string]string{"uid": actorUID, "realName": actorName})
		viewersJSON, err := json.Marshal(viewers)
		if err != nil {
			return nil, err
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_items SET viewers = ?, view_count = ? WHERE id = ?", string(viewersJSON), len(viewers), id); err != nil {
			return nil, err
		}
	}

	item["viewers"] = viewers
	item["view_count"] = len(viewers)
	return item, nil
}

func (a *Adapter) deleteInfoItem(ctx context.Context, id string) (map[string]any, error) {
	var itemID int64
	var bookmarkID sql.NullString
	var ossPath sql.NullString
	if err := a.db.QueryRowContext(ctx, "SELECT id, bookmark_id, oss_path FROM info_items WHERE id = ? LIMIT 1", id).Scan(&itemID, &bookmarkID, &ossPath); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "info_not_found", "Info item not found")
		}
		return nil, err
	}

	if _, err := a.db.ExecContext(ctx, "DELETE FROM info_items WHERE id = ?", id); err != nil {
		return nil, err
	}
	if bookmarkID.Valid && bookmarkID.String != "" {
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'pending' WHERE id = ?", bookmarkID.String); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"id":                 itemID,
		"restoredBookmarkId": nullableStringFromSQL(bookmarkID),
		"oss_path":           nullableStringFromSQL(ossPath),
		"deleted":            true,
	}, nil
}

func (a *Adapter) infoBookmarks(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := []any{}
	statuses := validInfoBookmarkStatuses(strings.Split(firstNonEmpty(query.Get("status"), "all"), ","))
	if len(statuses) > 0 {
		where = append(where, "status IN ("+placeholders(len(statuses))+")")
		for _, status := range statuses {
			args = append(args, status)
		}
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM info_bookmarks WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, "SELECT * FROM info_bookmarks WHERE "+whereSQL+" ORDER BY post_time DESC LIMIT ? OFFSET ?", append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":       page,
			"pageSize":   pageSize,
			"total":      total,
			"totalPages": int64((total + int64(pageSize) - 1) / int64(pageSize)),
		},
	}, nil
}

func (a *Adapter) updateInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	action := stringValue(body["action"])
	ids := stringListValue(body["ids"])
	if len(ids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Bookmark ids are required")
	}

	switch action {
	case "ignore":
		args := make([]any, 0, len(ids))
		for _, id := range ids {
			args = append(args, id)
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'ignored' WHERE id IN ("+placeholders(len(ids))+")", args...); err != nil {
			return nil, err
		}
		return map[string]any{"message": "已忽略选中的书签", "updated": len(ids)}, nil
	case "process":
		category := stringValue(body["category"])
		if category != "news" && category != "article" && category != "auto" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_category", "category must be news, article or auto")
		}
		args := make([]any, 0, len(ids))
		for _, id := range ids {
			args = append(args, id)
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'processing' WHERE id IN ("+placeholders(len(ids))+")", args...); err != nil {
			return nil, err
		}
		return map[string]any{"message": "处理任务已在后台启动", "updated": len(ids), "category": category}, nil
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_action", "Unknown bookmark action")
	}
}

func (a *Adapter) importInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	bookmarks := mapListValue(body["bookmarks"])
	if len(bookmarks) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "bookmarks are required")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	inserted := 0
	updated := 0
	skipped := 0
	for _, bookmark := range bookmarks {
		id := stringValue(bookmark["id"])
		if id == "" {
			skipped++
			continue
		}

		author := firstNonEmpty(stringValue(bookmark["author_handle"]), "unknown")
		content := stringValue(bookmark["content_snippet"])
		fullContent := firstNonEmpty(stringValue(bookmark["full_content"]), content)
		sourceURL := stringValue(bookmark["source_url"])
		articleTitle := stringValue(bookmark["article_title"])
		coverImage := stringValue(bookmark["cover_image"])
		hasExternalLink := boolValue(bookmark["has_external_link"])

		var existingAuthor sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT author_handle FROM info_bookmarks WHERE id = ? LIMIT 1", id).Scan(&existingAuthor)
		if err == sql.ErrNoRows {
			if _, err := tx.ExecContext(ctx, `
          INSERT INTO info_bookmarks
            (id, author_handle, content_snippet, full_content, source_url, has_external_link, article_title, cover_image, status, post_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
				id, author, content, fullContent, sourceURL, normalizeBoolInt(hasExternalLink), articleTitle, coverImage, infoBookmarkPostTime(id)); err != nil {
				return nil, err
			}
			inserted++
			continue
		}
		if err != nil {
			return nil, err
		}

		if strings.EqualFold(existingAuthor.String, "unknown") && !strings.EqualFold(author, "unknown") {
			result, err := tx.ExecContext(ctx, `
          UPDATE info_bookmarks
          SET author_handle = ?, content_snippet = ?, full_content = ?, source_url = ?, has_external_link = ?, article_title = ?, cover_image = ?
          WHERE id = ?`,
				author, content, fullContent, sourceURL, normalizeBoolInt(hasExternalLink), articleTitle, coverImage, id)
			if err != nil {
				return nil, err
			}
			if count, _ := result.RowsAffected(); count > 0 {
				updated++
			}
			continue
		}

		if articleTitle != "" {
			result, err := tx.ExecContext(ctx, `
          UPDATE info_bookmarks
          SET article_title = ?, cover_image = ?
          WHERE id = ? AND (article_title IS NULL OR article_title = '')`,
				articleTitle, coverImage, id)
			if err != nil {
				return nil, err
			}
			if count, _ := result.RowsAffected(); count > 0 {
				updated++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return map[string]any{
		"inserted": inserted,
		"updated":  updated,
		"skipped":  skipped,
	}, nil
}

func (a *Adapter) processingInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	ids := stringListValue(body["ids"])
	if len(ids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Bookmark ids are required")
	}

	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := a.db.QueryContext(ctx, "SELECT * FROM info_bookmarks WHERE id IN ("+placeholders(len(ids))+") AND status = 'processing'", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) createInfoItemFromBookmark(ctx context.Context, body map[string]any) (map[string]any, error) {
	bookmarkID := stringValue(firstNonNil(body["bookmark_id"], body["bookmarkId"]))
	title := stringValue(body["title"])
	category := stringValue(body["category"])
	ossPath := stringValue(firstNonNil(body["oss_path"], body["ossPath"]))
	if bookmarkID == "" || title == "" || ossPath == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "bookmark_id, title and oss_path are required")
	}
	if category != "news" && category != "article" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_category", "category must be news or article")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'processed' WHERE id = ?", bookmarkID); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
      INSERT INTO info_items
        (bookmark_id, title, category, summary, author, oss_path, cover_image)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		bookmarkID,
		title,
		category,
		stringValue(body["summary"]),
		stringValue(body["author"]),
		ossPath,
		stringValue(firstNonNil(body["cover_image"], body["coverImage"])))
	if err != nil {
		return nil, err
	}
	itemID, _ := result.LastInsertId()

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return map[string]any{
		"id":          itemID,
		"bookmark_id": bookmarkID,
		"oss_path":    ossPath,
		"created":     true,
	}, nil
}

func nullableStringFromSQL(value sql.NullString) any {
	if !value.Valid || value.String == "" {
		return nil
	}
	return value.String
}

func infoViewCount(viewers any, fallback any) int {
	parsed := infoViewers(viewers)
	if len(parsed) > 0 {
		return len(parsed)
	}
	return int(int64Value(fallback))
}

func infoViewers(raw any) []map[string]string {
	text := strings.TrimSpace(stringValue(raw))
	if text == "" || text == "null" {
		return []map[string]string{}
	}
	var entries []map[string]string
	if err := json.Unmarshal([]byte(text), &entries); err == nil && entries != nil {
		return entries
	}
	var loose []map[string]any
	if err := json.Unmarshal([]byte(text), &loose); err != nil {
		return []map[string]string{}
	}
	result := make([]map[string]string, 0, len(loose))
	for _, item := range loose {
		uid := stringValue(item["uid"])
		name := stringValue(item["realName"])
		if uid == "" {
			continue
		}
		result = append(result, map[string]string{"uid": uid, "realName": firstNonEmpty(name, uid)})
	}
	return result
}

func infoViewerExists(viewers []map[string]string, uid string) bool {
	for _, viewer := range viewers {
		if viewer["uid"] == uid {
			return true
		}
	}
	return false
}

func validInfoBookmarkStatuses(raw []string) []string {
	allowed := map[string]bool{"pending": true, "processed": true, "ignored": true, "processing": true}
	result := []string{}
	seen := map[string]bool{}
	for _, item := range raw {
		value := strings.TrimSpace(item)
		if value == "" || value == "all" || !allowed[value] || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func infoBookmarkPostTime(id string) any {
	tweetID, err := strconv.ParseInt(strings.TrimSpace(id), 10, 64)
	if err != nil || tweetID <= 0 {
		return nil
	}
	tsMs := (tweetID >> 22) + 1288834974657
	return time.UnixMilli(tsMs).UTC()
}
