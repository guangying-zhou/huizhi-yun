package codocs

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"unicode"
	"unicode/utf8"
)

type productDocumentSearchQuery struct {
	Search   string `json:"search"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

// The service boundary must authenticate and bind this actor before calling.
// Product context and department hints never grant document visibility.
func (a *Adapter) searchVisibleProductDocuments(ctx context.Context, actor string, input productDocumentSearchQuery) (map[string]any, error) {
	if actor == "" || strings.TrimSpace(actor) != actor || !utf8.ValidString(actor) || utf8.RuneCountInString(actor) > 64 || input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 || !utf8.ValidString(input.Search) || utf8.RuneCountInString(input.Search) > 200 || strings.TrimSpace(input.Search) != input.Search {
		return nil, httperror.New(400, "product_document_search_invalid", "Invalid document search")
	}
	for _, text := range []string{actor, input.Search} {
		for _, r := range text {
			if unicode.IsControl(r) {
				return nil, httperror.New(400, "product_document_search_invalid", "Invalid document search")
			}
		}
	}
	visibility, args := documentReadVisibilityPredicate(actor, "")
	where := ` FROM documents d WHERE d.status=1 AND ` + visibility
	if input.Search != "" {
		where += ` AND LOCATE(?,d.title)>0`
		args = append(args, input.Search)
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var total int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	listArgs := append(append([]any{}, args...), input.PageSize, (input.Page-1)*input.PageSize)
	rows, err := tx.QueryContext(ctx, `SELECT d.uuid,d.title,d.doc_type,d.updated_at`+where+` ORDER BY d.updated_at DESC,d.id DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var uuid, title, kind string
		var updated string
		if err = rows.Scan(&uuid, &title, &kind, &updated); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, map[string]any{"uuid": uuid, "title": title, "doc_type": kind, "updated_at": updated})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": input.Page, "pageSize": input.PageSize}, nil
}
