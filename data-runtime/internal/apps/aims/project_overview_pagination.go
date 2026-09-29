package aims

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strings"
)

type enterprisePortfolioManagementKey struct{}

// Only the verified server permit supplies this fact; query flags cannot grant it.
func WithEnterprisePortfolioManagement(ctx context.Context, allowed bool) context.Context {
	return context.WithValue(ctx, enterprisePortfolioManagementKey{}, allowed)
}
func projectProjectionWhere(ctx context.Context, q url.Values) (string, []any, error) {
	actor := strings.TrimSpace(q.Get("current_user"))
	if actor == "" {
		return "", nil, httperror.New(401, "missing_current_user", "Current user required")
	}
	where, args := memberProjectsWhere(q, actor)
	visibility, va := projectVisibilityWhere(q, "p", actor)
	scope, sa, err := enterpriseProjectReadScopeWhere(ctx, actor)
	if err != nil {
		return "", nil, err
	}
	where = append(where, "("+visibility+")", "("+scope+")")
	// cm is the existing participating filter's authoritative active membership join.
	args = append([]any{actor}, args...)
	args = append(args, va...)
	args = append(args, sa...)
	return " FROM aims_projects p LEFT JOIN aims_project_members cm ON cm.project_id=p.id AND cm.uid=? AND cm.status='active' WHERE " + strings.Join(where, " AND "), args, nil
}
func projectReadSummary(ctx context.Context, db weeklyReportReadDB, q url.Values) (map[string]any, error) {
	from, args, err := projectProjectionWhere(ctx, q)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT p.id, COALESCE(p.portfolio_id,0),p.lifecycle_status,COALESCE(YEAR(p.start_date),0),COALESCE(p.service_line_code,''),COALESCE(p.service_period_seq,0),p.category,COALESCE(p.service_period_label,''),COALESCE(DATE_FORMAT(p.service_period_start,'%Y-%m-%d'),'') `+from, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := map[string]int64{}
	statuses := map[string]int64{}
	years := map[string]int64{}
	latest := map[string]int64{}
	type periodFact struct {
		group, seq                   int64
		category, line, label, start string
	}
	facts := []periodFact{}
	historical := map[string]int64{}
	var total int64
	for rows.Next() {
		var id, group, year, seq int64
		var status, line, category, label, start string
		if err = rows.Scan(&id, &group, &status, &year, &line, &seq, &category, &label, &start); err != nil {
			return nil, err
		}
		facts = append(facts, periodFact{group, seq, category, line, label, start})
		total++
		groups[fmt.Sprint(group)]++
		statuses[status]++
		years[fmt.Sprint(year)]++
		if line != "" && seq > latest[fmt.Sprint(group)+":"+line] {
			latest[fmt.Sprint(group)+":"+line] = seq
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for _, f := range facts {
		key := fmt.Sprint(f.group) + ":current"
		if f.category == "maintenance" && f.line != "" && f.seq > 0 && f.seq < latest[fmt.Sprint(f.group)+":"+f.line] {
			label := f.label
			if label == "" && len(f.start) >= 4 {
				label = f.start[:4]
			}
			if label == "" {
				label = "历史年度"
			}
			key = fmt.Sprint(f.group) + ":history-" + label
		}
		historical[key]++
	}
	return map[string]any{"historicalCounts": historical, "projectCount": total, "portfolioCounts": groups, "statusCounts": statuses, "yearCounts": years, "latestByLine": latest}, nil
}
func projectPortfolioProjection(ctx context.Context, db weeklyReportReadDB, q url.Values, page timeEntryPage) (map[string]any, error) {
	summary, err := projectReadSummary(ctx, db, q)
	if err != nil {
		return nil, err
	}
	// Roots retain the existing active-portfolio visibility, including empty groups.
	where, args := portfolioListWhere(url.Values{"search": {q.Get("rootSearch")}, "status": {q.Get("rootStatus")}, "defaultCategory": {q.Get("rootCategory")}})
	var total int64
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_portfolios pf "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	from, visibleArgs, err := projectProjectionWhere(ctx, q)
	if err != nil {
		return nil, err
	}
	rootArgs := append(append([]any{}, args...), visibleArgs...)
	rows, err := db.QueryContext(ctx, `SELECT pf.id,pf.code,pf.name,pf.description,pf.domain_code,pf.owner_uid,pf.dept_code,pf.git_group,pf.is_product_line,pf.default_category,pf.is_system,pf.display_order,pf.status,pf.created_by,pf.created_at,pf.updated_at,0 FROM project_portfolios pf `+where+` ORDER BY CASE WHEN pf.default_category='routine' THEN 2 WHEN EXISTS(SELECT 1 `+from+` AND p.portfolio_id=pf.id) THEN 0 ELSE 1 END,pf.display_order,pf.id LIMIT ? OFFSET ?`, append(rootArgs, page.size, (page.page-1)*page.size)...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	roots := []portfolioListItem{}
	for rows.Next() {
		item, e := scanPortfolioListItem(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		roots = append(roots, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	counts := summary["portfolioCounts"].(map[string]int64)
	manage, _ := ctx.Value(enterprisePortfolioManagementKey{}).(bool)
	for _, root := range roots {
		root.ProjectCount = counts[fmt.Sprint(root.ID)]
		canDelete := false
		if manage && !root.IsSystem {
			var empty bool
			if err = db.QueryRowContext(ctx, `SELECT NOT EXISTS(SELECT 1 FROM aims_projects WHERE portfolio_id=? AND lifecycle_status!='archived')`, root.ID).Scan(&empty); err != nil {
				return nil, err
			}
			canDelete = empty
		}
		// Reuse the owning root fields; expose only the management boolean, never its count.
		items = append(items, map[string]any{"portfolio": root, "canDelete": canDelete})
	}
	return map[string]any{"items": items, "total": total, "page": page.page, "pageSize": page.size, "summary": summary}, nil
}
