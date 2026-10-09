package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The opt-in board contract pages one status column. Legacy view=board keeps
// its original status-to-array response for callers that have not migrated.
func (a *Adapter) projectWorkItemsBoardPage(ctx context.Context, projectID int64, query url.Values) (map[string]any, error) {
	page, pageSize, err := myWorkItemPage(query)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(query.Get("status"))
	switch status {
	case "planning", "todo", "in_progress", "in_review", "completed":
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_status", "board column status is required")
	}
	baseQuery := cloneURLValues(query)
	baseQuery.Del("status")
	baseWhere, baseArgs, err := projectWorkItemsWhere(projectID, baseQuery)
	if err != nil {
		return nil, err
	}
	where, args, err := projectWorkItemsWhere(projectID, query)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("begin project board page: %w", err)
	}
	defer tx.Rollback()
	summaryRows, err := tx.QueryContext(ctx, `SELECT wi.status, wi.type, COALESCE(wi.severity, ''), COUNT(*)
		FROM work_items wi LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		WHERE `+strings.Join(baseWhere, " AND ")+` GROUP BY wi.status, wi.type, wi.severity`, baseArgs...)
	if err != nil {
		return nil, fmt.Errorf("summarize project board: %w", err)
	}
	statusCounts := map[string]int64{}
	typeCounts := map[string]int64{}
	severityCounts := map[string]int64{}
	var total int64
	for summaryRows.Next() {
		var state, itemType, severity string
		var count int64
		if err := summaryRows.Scan(&state, &itemType, &severity, &count); err != nil {
			summaryRows.Close()
			return nil, err
		}
		statusCounts[state] += count
		typeCounts[itemType] += count
		if severity != "" {
			severityCounts[severity] += count
		}
		total += count
	}
	if err := summaryRows.Err(); err != nil {
		summaryRows.Close()
		return nil, err
	}
	summaryRows.Close()
	wipStatusCounts := statusCounts
	if quickFilter := strings.TrimSpace(baseQuery.Get("quickFilter")); quickFilter != "" && quickFilter != "all" {
		wipQuery := cloneURLValues(baseQuery)
		wipQuery.Del("quickFilter")
		wipWhere, wipArgs, err := projectWorkItemsWhere(projectID, wipQuery)
		if err != nil {
			return nil, err
		}
		wipRows, err := tx.QueryContext(ctx, `SELECT wi.status, COUNT(*) FROM work_items wi
			LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
			WHERE `+strings.Join(wipWhere, " AND ")+` GROUP BY wi.status`, wipArgs...)
		if err != nil {
			return nil, fmt.Errorf("count board WIP columns: %w", err)
		}
		wipStatusCounts = map[string]int64{}
		for wipRows.Next() {
			var state string
			var count int64
			if err := wipRows.Scan(&state, &count); err != nil {
				wipRows.Close()
				return nil, err
			}
			wipStatusCounts[state] = count
		}
		if err := wipRows.Err(); err != nil {
			wipRows.Close()
			return nil, err
		}
		wipRows.Close()
	}
	items, err := queryProjectWorkItemRowsFrom(ctx, tx, "WHERE "+strings.Join(where, " AND "), args, pageSize, (page-1)*pageSize, "wi.sort_order ASC, wi.created_at ASC, wi.id ASC")
	if err != nil {
		return nil, err
	}
	ancestors, err := projectWorkItemAncestors(ctx, tx, projectID, items)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit project board page: %w", err)
	}
	mapped := make([]map[string]any, 0, len(items))
	for _, item := range items {
		mappedItem := item.mapProjectWorkItem()
		mappedItem["versionId"] = item.VersionID
		mapped = append(mapped, mappedItem)
	}
	return map[string]any{
		"items": mapped, "total": statusCounts[status], "page": page, "pageSize": pageSize,
		"summary":   map[string]any{"total": total, "status": statusCounts, "type": typeCounts, "severity": severityCounts, "wipStatus": wipStatusCounts},
		"ancestors": ancestors,
	}, nil
}

// Ancestors are a minimal, same-project closure for rows on this page. The
// closure never grants visibility to another project and never treats a page
// as the complete tree. A broken/cyclic chain fails rather than truncating.
func projectWorkItemAncestors(ctx context.Context, tx *sql.Tx, projectID int64, items []projectWorkItemRow) ([]map[string]any, error) {
	type ancestor struct {
		id         int64
		parent     *int64
		key, title string
	}
	found := map[int64]ancestor{}
	pending := map[int64]bool{}
	for _, item := range items {
		if item.ParentID != nil {
			pending[*item.ParentID] = true
		}
	}
	for depth := 0; len(pending) > 0 && depth < 64; depth++ {
		ids := make([]int64, 0, len(pending))
		for id := range pending {
			if _, ok := found[id]; !ok {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			break
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, 0, len(ids)+1)
		args = append(args, projectID)
		for _, id := range ids {
			args = append(args, id)
		}
		rows, err := tx.QueryContext(ctx, "SELECT id,parent_id,item_key,title FROM work_items WHERE project_id=? AND id IN ("+placeholders+")", args...)
		if err != nil {
			return nil, fmt.Errorf("query project work item ancestors: %w", err)
		}
		next := map[int64]bool{}
		for rows.Next() {
			var node ancestor
			var parent sql.NullInt64
			if err := rows.Scan(&node.id, &parent, &node.key, &node.title); err != nil {
				rows.Close()
				return nil, err
			}
			if parent.Valid {
				node.parent = &parent.Int64
				next[parent.Int64] = true
			}
			found[node.id] = node
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		pending = next
	}
	for _, item := range items {
		seen := map[int64]bool{item.ID: true}
		parent := item.ParentID
		for depth := 0; parent != nil; depth++ {
			if depth >= 64 || seen[*parent] {
				return nil, httperror.New(http.StatusConflict, "invalid_work_item_tree", "work item ancestry is invalid")
			}
			seen[*parent] = true
			node, ok := found[*parent]
			if !ok {
				return nil, httperror.New(http.StatusConflict, "invalid_work_item_tree", "work item ancestry is incomplete")
			}
			parent = node.parent
		}
	}
	result := make([]map[string]any, 0, len(found))
	for _, node := range found {
		var parent any
		if node.parent != nil {
			parent = *node.parent
		}
		result = append(result, map[string]any{"id": node.id, "parentId": parent, "itemKey": node.key, "title": node.title})
	}
	return result, nil
}
