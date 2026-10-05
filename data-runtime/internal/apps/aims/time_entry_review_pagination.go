package aims

import (
	"context"
	"database/sql"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

type enterpriseReviewScopeKey struct{}
type enterpriseReviewScopes struct {
	projections []projectscope.Projection
	descendants map[string][]string
}

// Server alone supplies current Console projections after service, actor and
// independent body HMAC verification. Browser query cannot create this context.
func WithEnterpriseTimeEntryReviewScopes(ctx context.Context, projections []projectscope.Projection, descendants map[string][]string) context.Context {
	return context.WithValue(ctx, enterpriseReviewScopeKey{}, enterpriseReviewScopes{projections, descendants})
}
func enterpriseTimeEntryReviewWhere(ctx context.Context, actor string) (string, []any, error) {
	scope, ok := ctx.Value(enterpriseReviewScopeKey{}).(enterpriseReviewScopes)
	if !ok {
		return "1=1", nil, nil
	}
	parts := []string{}
	args := []any{}
	for _, projection := range scope.projections {
		where, values, e := enterpriseProjectReadScopeWherePolicy(WithEnterpriseProjectReadScope(ctx, projection, scope.descendants), actor, false)
		if e != nil {
			return "", nil, e
		}
		parts = append(parts, "("+where+")")
		args = append(args, values...)
	}
	if len(parts) == 0 {
		return "0=1", nil, nil
	}
	return "(" + strings.Join(parts, " OR ") + ")", args, nil
}
func (a *Adapter) listProjectTimeEntryReviewPage(ctx context.Context, projectID int64, actor, periodKey string, q url.Values, p timeEntryPage, paged bool) (map[string]any, error) {
	scope, args, e := enterpriseTimeEntryReviewWhere(ctx, actor)
	if e != nil {
		return nil, e
	}
	from := ` FROM time_entries entry LEFT JOIN work_items work_item ON work_item.id=entry.work_item_id INNER JOIN weekly_reporting_periods period ON period.period_key=? AND entry.entry_date BETWEEN DATE(period.week_start) AND DATE(period.week_end) INNER JOIN aims_projects p ON p.id=entry.project_id WHERE entry.project_id=? AND entry.review_route='project_manager' AND BINARY entry.reviewer_uid_snapshot=BINARY ? AND entry.review_status IN ('submitted','approved','returned') AND ` + scope
	scopeArgs := append([]any{projectID}, args...)
	args = append([]any{periodKey, projectID, actor}, args...)
	tx, e := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if _, scoped := ctx.Value(enterpriseReviewScopeKey{}).(enterpriseReviewScopes); scoped {
		var id int64
		e = tx.QueryRowContext(ctx, "SELECT p.id FROM aims_projects p WHERE p.id=? AND "+scope, scopeArgs...).Scan(&id)
		if e == sql.ErrNoRows {
			return nil, httperror.New(403, "timesheet_review_scope_forbidden", "Review project is outside the current authorization scope")
		}
		if e != nil {
			return nil, e
		}
	}
	var total, submitted, approved, returned int64
	if e = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(entry.review_status='submitted'),0),COALESCE(SUM(entry.review_status='approved'),0),COALESCE(SUM(entry.review_status='returned'),0)`+from, args...).Scan(&total, &submitted, &approved, &returned); e != nil {
		return nil, e
	}
	selectSQL := `SELECT entry.id,entry.uid,DATE_FORMAT(entry.entry_date,'%Y-%m-%d'),CAST(entry.hours AS CHAR),entry.description,work_item.item_key,work_item.title,entry.review_status,entry.review_route,entry.reviewer_uid_snapshot,entry.row_version,DATE_FORMAT(entry.submitted_at,'%Y-%m-%dT%H:%i:%s.%fZ')` + from + ` ORDER BY entry.review_status='submitted' DESC,entry.entry_date,entry.id`
	if paged {
		selectSQL += " LIMIT ? OFFSET ?"
		args = append(args, p.size, (p.page-1)*p.size)
	}
	rows, e := tx.QueryContext(ctx, selectSQL, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, rowVersion int64
		var uid, entryDate, hours, status, route, reviewer string
		var description, itemKey, itemTitle, submittedAt sql.NullString
		if e = rows.Scan(&id, &uid, &entryDate, &hours, &description, &itemKey, &itemTitle, &status, &route, &reviewer, &rowVersion, &submittedAt); e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"id": id, "uid": uid, "entryDate": entryDate, "hours": hours, "description": nullableJSONText(description), "itemKey": nullableJSONText(itemKey), "itemTitle": nullableJSONText(itemTitle), "reviewStatus": status, "reviewRoute": route, "reviewerUid": reviewer, "rowVersion": rowVersion, "submittedAt": nullableJSONText(submittedAt)})
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	result := map[string]any{"periodKey": periodKey, "items": items, "total": total}
	if paged {
		result["page"] = p.page
		result["pageSize"] = p.size
		result["statusCounts"] = map[string]int64{"submitted": submitted, "approved": approved, "returned": returned}
	}
	return result, nil
}
