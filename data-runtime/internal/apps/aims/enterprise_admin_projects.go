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
		case "portfolioId":
			if !adminProjectID.MatchString(value) {
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
		where = append(where, `(p.project_code LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.short_name LIKE ? ESCAPE '\\')`)
		for i := 0; i < 3; i++ {
			args = append(args, "%"+value+"%")
		}
	}
	for _, item := range []struct{ key, column string }{{"category", "category"}, {"lifecycleStatus", "lifecycle_status"}, {"portfolioId", "portfolio_id"}} {
		if value := query[item.key]; value != "" {
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
	var total int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p"+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	pageArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := tx.QueryContext(ctx, "SELECT p.id,p.project_code,p.category,p.lifecycle_status FROM aims_projects p"+whereSQL+" ORDER BY p.project_code,p.id LIMIT ? OFFSET ?", pageArgs...)
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
		items = append(items, entry)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}
