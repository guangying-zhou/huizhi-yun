package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
)

func customerWorkspaceFilters(where string, args []any, q altoc.BasicReadQuery) (string, []any) {
	for _, f := range []struct{ column, value string }{{"owner_uid", q.OwnerUID}, {"industry_code", q.IndustryCode}, {"region_code", q.RegionCode}} {
		if f.value != "" {
			where += " AND " + f.column + "=?"
			args = append(args, f.value)
		}
	}
	// Dates are business dates; persisted DATETIME facts use UTC, like signed_at.
	if q.UpdatedDateFrom != "" {
		where += " AND updated_at>=DATE_SUB(CAST(? AS DATETIME),INTERVAL 8 HOUR)"
		args = append(args, q.UpdatedDateFrom)
	}
	if q.UpdatedDateTo != "" {
		where += " AND updated_at<DATE_SUB(DATE_ADD(CAST(? AS DATETIME),INTERVAL 1 DAY),INTERVAL 8 HOUR)"
		args = append(args, q.UpdatedDateTo)
	}
	return where, args
}

// The owning customer must pass the current signed scope before any child count
// or source metadata is read. No contact has an independent widened read scope.
func readCustomerContacts(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, metadata map[string]string, customers, scopeWhere string, scopeArgs []any, id string, q altoc.BasicReadQuery) (any, error) {
	hasPrimary, e := financeHasColumn(ctx, tx, customers, "primary_contact_id")
	if e != nil {
		return nil, e
	}
	primaryColumn := "NULL"
	if hasPrimary {
		primaryColumn = "primary_contact_id"
	}
	var primary sql.NullInt64
	e = tx.QueryRowContext(ctx, "SELECT "+primaryColumn+" FROM "+customers+" WHERE id=? AND deleted_at IS NULL AND ("+scopeWhere+")", append([]any{id}, scopeArgs...)...).Scan(&primary)
	if e == sql.ErrNoRows {
		return nil, httperror.New(404, "altoc_customer_not_found", "Customer unavailable")
	}
	if e != nil {
		return nil, e
	}
	contacts, e := r.Table("altoc_contact")
	if e != nil {
		return nil, e
	}
	hasStar, e := financeHasColumn(ctx, tx, contacts, "star_level")
	if e != nil {
		return nil, e
	}
	if (q.PrimaryOnly && !hasPrimary) || (q.StarredOnly && !hasStar) {
		return nil, httperror.New(503, "altoc_customer_fields_unavailable", "Contact filter fields are not installed")
	}
	where := "customer_id=? AND deleted_at IS NULL"
	args := []any{id}
	if q.Search != "" {
		where += " AND (LOCATE(?,name)>0 OR LOCATE(?,job_title)>0 OR LOCATE(?,dept_name)>0)"
		args = append(args, q.Search, q.Search, q.Search)
	}
	if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	if q.DecisionRole != "" {
		where += " AND decision_role=?"
		args = append(args, q.DecisionRole)
	}
	if q.PrimaryOnly {
		where += " AND id=?"
		args = append(args, primary)
	}
	if q.StarredOnly {
		where += " AND star_level>0"
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+contacts+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	order := ""
	if hasPrimary {
		order = "(id=?) DESC,"
		args = append(args, primary)
	}
	if hasStar {
		order += "COALESCE(star_level,0) DESC,"
	}
	order += "id"
	items, e := customerRows(ctx, tx, contacts, where+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(args, q.PageSize, (q.Page-1)*q.PageSize), "contact")
	if e != nil {
		return nil, e
	}
	for _, item := range items {
		if e = w3ObjectMetadata(ctx, tx, metadata, "contact", item); e != nil {
			return nil, e
		}
	}
	return map[string]any{"id": id, "items": items, "total": total, "page": q.Page, "pageSize": q.PageSize}, nil
}

// One batch for the current authorized page, never a request/query per customer.
func projectCustomerPrimaryContacts(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, items []map[string]any) error {
	ids := []any{}
	byID := map[string]map[string]any{}
	for _, item := range items {
		if item["primary_contact_id"] != nil {
			ids = append(ids, item["id"])
			byID[fmt.Sprint(item["id"])] = item
		}
	}
	if len(ids) == 0 {
		return nil
	}
	contacts, e := r.Table("altoc_contact")
	if e != nil {
		return e
	}
	customers, e := r.Table("altoc_customer")
	if e != nil {
		return e
	}
	rows, e := tx.QueryContext(ctx, "SELECT c.id,c.name,c.customer_id FROM "+contacts+" c JOIN "+customers+" p ON p.id=c.customer_id AND p.primary_contact_id=c.id WHERE c.deleted_at IS NULL AND p.id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+")", ids...)
	if e != nil {
		return e
	}
	values, e := readFinanceRows(rows, []string{"id", "name", "customer_id"})
	if e != nil {
		return e
	}
	for _, v := range values {
		byID[fmt.Sprint(v["customer_id"])]["primary_contact_name"] = v["name"]
	}
	return nil
}
