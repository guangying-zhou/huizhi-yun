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

type requirementExportContent struct {
	ID            int64   `json:"id"`
	ParentID      *int64  `json:"parentId"`
	HeadingDepth  int64   `json:"headingDepth"`
	Title         string  `json:"title"`
	ContentMd     *string `json:"contentMd"`
	SortOrder     int64   `json:"sortOrder"`
	Status        string  `json:"status"`
	RequirementID *int64  `json:"requirementId"`
}

type requirementExportItem struct {
	ID      int64  `json:"id"`
	ReqCode string `json:"reqCode"`
	Status  string `json:"status"`
}

func (a *Adapter) projectCodocsCandidateCodes(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	var id int64
	var gitGroup sql.NullString
	row := a.DB().QueryRowContext(ctx, `
		SELECT p.id, pf.git_group
		FROM aims_projects p
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		WHERE p.id = ?
	`, projectID)
	if err := row.Scan(&id, &gitGroup); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return nil, fmt.Errorf("query project codocs candidates: %w", err)
	}

	codes, err := a.decomposeSourceProjectCodes(ctx, id, nullableString(gitGroup))
	if err != nil {
		return nil, err
	}
	return map[string]any{"sourceProjectCodes": codes}, nil
}

func (a *Adapter) projectRequirementsExportData(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	var projectName string
	row := a.DB().QueryRowContext(ctx, `
		SELECT name
		FROM aims_projects
		WHERE id = ?
	`, projectID)
	if err := row.Scan(&projectName); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return nil, fmt.Errorf("query requirement export project: %w", err)
	}

	contents, err := a.requirementExportContents(ctx, projectID)
	if err != nil {
		return nil, err
	}
	requirements, err := a.requirementExportItems(ctx, contents)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"projectName":  projectName,
		"contents":     contents,
		"requirements": requirements,
	}, nil
}

func (a *Adapter) requirementContentRelations(ctx context.Context, contentID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	contentID, err := normalizeRequiredID(contentID, "content_id")
	if err != nil {
		return nil, err
	}

	var projectID string
	err = a.DB().QueryRowContext(ctx, `
		SELECT project_id
		FROM requirement_contents
		WHERE id = ?
		LIMIT 1
	`, contentID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_content_not_found", "requirement content not found")
	}
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}

	where := []string{"content_id = ?"}
	args := []any{contentID}
	if relationType := strings.TrimSpace(query.Get("relation_type")); relationType != "" {
		where = append(where, "relation_type = ?")
		args = append(args, relationType)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, requirement_id, content_id, relation_type, sort_order, created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM requirement_item_contents
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY sort_order ASC, id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    len(items),
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func (a *Adapter) requirementExportContents(ctx context.Context, projectID string) ([]requirementExportContent, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT c.id, c.parent_id, c.heading_depth, c.title, c.content_md, c.sort_order, c.status,
		       ric.requirement_id
		FROM requirement_contents c
		LEFT JOIN requirement_item_contents ric
		  ON ric.content_id = c.id
		 AND ric.relation_type = 'baseline'
		WHERE c.project_id = ?
		ORDER BY c.parent_id IS NULL DESC, c.parent_id, c.sort_order
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query requirement export contents: %w", err)
	}
	defer rows.Close()

	contents := make([]requirementExportContent, 0)
	for rows.Next() {
		var content requirementExportContent
		var parentID, requirementID sql.NullInt64
		var contentMd sql.NullString
		if err := rows.Scan(
			&content.ID,
			&parentID,
			&content.HeadingDepth,
			&content.Title,
			&contentMd,
			&content.SortOrder,
			&content.Status,
			&requirementID,
		); err != nil {
			return nil, fmt.Errorf("scan requirement export content: %w", err)
		}
		content.ParentID = nullableInt64(parentID)
		content.ContentMd = nullableString(contentMd)
		content.RequirementID = nullableInt64(requirementID)
		contents = append(contents, content)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return contents, nil
}

func (a *Adapter) requirementExportItems(ctx context.Context, contents []requirementExportContent) ([]requirementExportItem, error) {
	seen := make(map[int64]bool)
	ids := make([]int64, 0)
	for _, content := range contents {
		if content.RequirementID == nil || seen[*content.RequirementID] {
			continue
		}
		seen[*content.RequirementID] = true
		ids = append(ids, *content.RequirementID)
	}
	if len(ids) == 0 {
		return []requirementExportItem{}, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, req_code, status
		FROM requirement_items
		WHERE id IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query requirement export items: %w", err)
	}
	defer rows.Close()

	items := make([]requirementExportItem, 0)
	for rows.Next() {
		var item requirementExportItem
		if err := rows.Scan(&item.ID, &item.ReqCode, &item.Status); err != nil {
			return nil, fmt.Errorf("scan requirement export item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
