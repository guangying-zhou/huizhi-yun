package aims

import (
	"context"
	"database/sql"
	"net/url"
	"strings"
)

func (a *Adapter) adminProjects(ctx context.Context, query url.Values) (map[string]any, error) {
	page := memberProjectsPage(query)
	where, args := adminProjectWhere(query)
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			p.id,
			p.project_code,
			p.name,
			p.short_name,
			p.internal_code,
			p.description,
			p.category,
			p.methodology,
			p.lifecycle_status,
			p.portfolio_id,
			pf.name AS portfolio_name,
			p.domain_code,
			p.dept_code,
			p.leader_uid,
			p.security_level,
			p.access_whitelist,
			DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
			p.customer_name,
			p.contract_code,
			ts.name AS template_set_name,
			tv.version_label AS template_version_label,
			p.created_by,
			DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			IFNULL(mc.member_count, 0) AS member_count,
			IFNULL(rc.repo_count, 0) AS repo_count,
			IFNULL(ms.milestone_count, 0) AS milestone_count,
			IFNULL(wi.work_item_count, 0) AS work_item_count,
			IFNULL(ri.requirement_count, 0) AS requirement_count,
			(
				SELECT COUNT(*)
				FROM project_documents pd
				WHERE pd.project_id = p.id
				   OR pd.milestone_id IN (SELECT id FROM milestones WHERE project_id = p.id)
				   OR pd.work_item_id IN (SELECT id FROM work_items WHERE project_id = p.id)
			) AS document_count,
			IFNULL(dl.deliverable_count, 0) AS deliverable_count,
			IFNULL(ap.approval_count, 0) AS approval_count
		FROM aims_projects p
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
		LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
		LEFT JOIN (SELECT project_id, COUNT(*) AS member_count FROM aims_project_members GROUP BY project_id) mc ON mc.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS repo_count FROM aims_project_repos GROUP BY project_id) rc ON rc.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS milestone_count FROM milestones GROUP BY project_id) ms ON ms.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS work_item_count FROM work_items GROUP BY project_id) wi ON wi.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS requirement_count FROM requirement_items GROUP BY project_id) ri ON ri.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS deliverable_count FROM deliverables GROUP BY project_id) dl ON dl.project_id = p.id
		LEFT JOIN (SELECT project_id, COUNT(*) AS approval_count FROM approval_records GROUP BY project_id) ap ON ap.project_id = p.id
		`+whereSQL+`
		ORDER BY p.name ASC, p.id ASC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := scanAdminProjectRows(rows)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func adminProjectWhere(query url.Values) ([]string, []any) {
	where := make([]string, 0)
	args := make([]any, 0)

	if search := strings.TrimSpace(query.Get("search")); search != "" {
		where = append(where, "(p.project_code LIKE ? OR p.name LIKE ? OR p.short_name LIKE ? OR p.leader_uid LIKE ?)")
		keyword := "%" + search + "%"
		args = append(args, keyword, keyword, keyword, keyword)
	}

	if category := strings.TrimSpace(query.Get("category")); category != "" && category != "all" {
		where = append(where, "p.category = ?")
		args = append(args, category)
	}

	if status := strings.TrimSpace(firstNonEmptyProjectParam(query, "lifecycleStatus", "lifecycle_status")); status != "" && status != "all" {
		where = append(where, "p.lifecycle_status = ?")
		args = append(args, status)
	}

	if portfolioID := strings.TrimSpace(firstNonEmptyProjectParam(query, "portfolioId", "portfolio_id")); portfolioID != "" && portfolioID != "all" {
		if portfolioID == "0" {
			where = append(where, "p.portfolio_id IS NULL")
		} else {
			where = append(where, "p.portfolio_id = ?")
			args = append(args, portfolioID)
		}
	}

	return where, args
}

func scanAdminProjectRows(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}

	items := make([]map[string]any, 0)
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns)+1)
		counts := map[string]any{}
		for index, column := range columns {
			value := normalizeAdminSQLValue(values[index])
			switch column {
			case "member_count":
				counts["members"] = value
			case "repo_count":
				counts["repos"] = value
			case "milestone_count":
				counts["milestones"] = value
			case "work_item_count":
				counts["workItems"] = value
			case "requirement_count":
				counts["requirements"] = value
			case "document_count":
				counts["documents"] = value
			case "deliverable_count":
				counts["deliverables"] = value
			case "approval_count":
				counts["approvals"] = value
			}
			item[column] = value
		}
		item["counts"] = counts
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func normalizeAdminSQLValue(value any) any {
	if bytes, ok := value.([]byte); ok {
		return string(bytes)
	}
	return value
}
