package aims

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const EnterpriseAdminProjectListCapability = "aims:admin-projects:view"

var adminProjectCategories = map[string]bool{"product_dev": true, "custom_dev": true, "delivery": true, "maintenance": true, "sales": true, "presales": true, "improvement": true, "compliance": true, "routine": true}
var adminProjectStates = map[string]bool{"draft": true, "approval_pending": true, "active": true, "paused": true, "completed": true, "archived": true}
var adminProjectID = regexp.MustCompile(`^[1-9][0-9]*$`)

// EnterpriseAdminProjects is deliberately separate from the legacy Aims admin
// reader. Count, page and edit versions are read in one repeatable-read snapshot.
func (a *Adapter) EnterpriseAdminProjects(ctx context.Context, query map[string]string) (map[string]any, error) {
	page, pageSize := 1, 20
	for key, value := range query {
		switch key {
		case "page", "pageSize":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || (key == "pageSize" && n > 100) || (key == "page" && n > 100000) {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid pagination")
			}
			if key == "page" {
				page = n
			} else {
				pageSize = n
			}
		case "tree":
			if value != "true" {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid tree projection")
			}
		case "search":
			if len([]rune(value)) > 100 || strings.TrimSpace(value) != value {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid search")
			}
		case "category":
			if !adminProjectCategories[value] {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid category")
			}
		case "lifecycleStatus":
			if !adminProjectStates[value] {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid status")
			}
		case "sort":
			if !map[string]bool{"code": true, "name": true, "updated": true, "start": true}[value] {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid sort")
			}
		case "portfolioId", "projectId":
			if !(key == "portfolioId" && value == "0") && !adminProjectID.MatchString(value) {
				return nil, httperror.New(400, "admin_projects_query_invalid", "Invalid portfolio")
			}
		default:
			return nil, httperror.New(400, "admin_projects_query_invalid", "Unknown filter")
		}
	}
	where := []string{}
	args := []any{}
	if value := query["search"]; value != "" {
		value = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
		where = append(where, `(p.leader_uid LIKE ? ESCAPE '\\' OR p.project_code LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.short_name LIKE ? ESCAPE '\\')`)
		for i := 0; i < 4; i++ {
			args = append(args, "%"+value+"%")
		}
	}
	for _, item := range []struct{ key, column string }{{"category", "category"}, {"lifecycleStatus", "lifecycle_status"}, {"portfolioId", "portfolio_id"}, {"projectId", "id"}} {
		if value := query[item.key]; value != "" {
			if item.key == "portfolioId" && value == "0" {
				where = append(where, "p.portfolio_id IS NULL")
				continue
			}
			where = append(where, "p."+item.column+"=?")
			args = append(args, value)
		}
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if query["tree"] == "true" {
		return enterpriseAdminProjectRoots(ctx, tx, query, whereSQL, args, page, pageSize)
	}
	var total int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p"+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	pageArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	order := map[string]string{"code": "p.project_code,p.id", "name": "p.name,p.id", "updated": "p.updated_at DESC,p.id DESC", "start": "p.start_date DESC,p.id DESC"}[query["sort"]]
	if order == "" {
		order = "p.project_code,p.id"
	}
	rows, err := tx.QueryContext(ctx, "SELECT p.id,p.project_code,p.category,p.lifecycle_status FROM aims_projects p"+whereSQL+" ORDER BY "+order+" LIMIT ? OFFSET ?", pageArgs...)
	if err != nil {
		return nil, err
	}
	type row struct {
		id                     int64
		code, category, status string
	}
	selected := []row{}
	for rows.Next() {
		var item row
		if err = rows.Scan(&item.id, &item.code, &item.category, &item.status); err != nil {
			rows.Close()
			return nil, err
		}
		selected = append(selected, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	items := make([]map[string]any, 0, len(selected))
	for _, item := range selected {
		snapshot, version, err := enterpriseProjectSnapshot(ctx, tx, fmt.Sprint(item.id), false)
		if err != nil {
			return nil, err
		}
		entry := map[string]any{"id": item.id, "projectCode": item.code, "category": item.category, "lifecycleStatus": item.status, "editVersion": version}
		for key, value := range snapshot {
			entry[key] = value
		}
		var members, milestones, workItems int
		if err = tx.QueryRowContext(ctx, "SELECT (SELECT COUNT(*) FROM aims_project_members WHERE project_id=?),(SELECT COUNT(*) FROM milestones WHERE project_id=?),(SELECT COUNT(*) FROM work_items WHERE project_id=?)", item.id, item.id, item.id).Scan(&members, &milestones, &workItems); err != nil {
			return nil, err
		}
		entry["counts"] = map[string]int{"members": members, "milestones": milestones, "workItems": workItems}
		items = append(items, entry)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

// Root pagination is independent of child pagination. Search/filter matches on
// projects retain their owning portfolio; unassigned matches use root id 0.
func enterpriseAdminProjectRoots(ctx context.Context, tx *sql.Tx, query map[string]string, where string, args []any, page, pageSize int) (map[string]any, error) {
	filtered := query["search"] != "" || query["category"] != "" || query["lifecycleStatus"] != "" || query["portfolioId"] != "" || query["projectId"] != ""
	roots := "SELECT pf.id,pf.code,pf.name FROM project_portfolios pf"
	rootArgs := []any{}
	if query["portfolioId"] != "" && query["portfolioId"] != "0" && query["search"] == "" && query["category"] == "" && query["lifecycleStatus"] == "" {
		roots += " WHERE pf.id=?"
		rootArgs = append(rootArgs, query["portfolioId"])
	} else if filtered {
		roots += " WHERE pf.id IN (SELECT p.portfolio_id FROM aims_projects p" + where + ")"
		rootArgs = append(rootArgs, args...)
	}
	roots += " UNION ALL SELECT 0,'','未分组' WHERE EXISTS (SELECT 1 FROM aims_projects p"
	if where == "" {
		roots += " WHERE p.portfolio_id IS NULL)"
	} else {
		roots += where + " AND p.portfolio_id IS NULL)"
	}
	rootArgs = append(rootArgs, args...)
	var total int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM ("+roots+") roots", rootArgs...).Scan(&total); err != nil {
		return nil, err
	}
	pageArgs := append(append([]any{}, rootArgs...), pageSize, (page-1)*pageSize)
	rows, err := tx.QueryContext(ctx, "SELECT id,code,name FROM ("+roots+") roots ORDER BY id=0,code,id LIMIT ? OFFSET ?", pageArgs...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var code, name string
		if err := rows.Scan(&id, &code, &name); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "code": code, "name": name})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		id := item["id"].(int64)
		countWhere := where
		if countWhere == "" {
			countWhere = " WHERE "
		} else {
			countWhere += " AND "
		}
		countArgs := append([]any{}, args...)
		if id == 0 {
			countWhere += "p.portfolio_id IS NULL"
		} else {
			countWhere += "p.portfolio_id=?"
			countArgs = append(countArgs, id)
		}
		var count int64
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p"+countWhere, countArgs...).Scan(&count); err != nil {
			return nil, err
		}
		item["projectCount"] = count
		if id == 0 {
			continue
		}
		snapshot, version, err := enterprisePortfolioSnapshot(ctx, tx, id, false)
		if err != nil {
			return nil, err
		}
		for key, value := range snapshot {
			item[key] = value
		}
		item["editVersion"] = version
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}
