package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// SalesReader is the upstream basic projection. Its table closure is separate
// from G1 so installing it cannot add dependencies to existing basic reads.
type SalesReader struct {
	tables map[string]string
	apf    bool
}

var SalesReadTables = []string{"lead", "opportunity", "opportunity_stage", "quotation", "quotation_item"}

func NewSalesReader(tables map[string]string) (*SalesReader, error) {
	r := &SalesReader{tables: map[string]string{}}
	for _, logical := range SalesReadTables {
		if !basicTableName.MatchString(tables[logical]) {
			return nil, fmt.Errorf("invalid Altoc sales table mapping: %s", logical)
		}
		r.tables[logical] = tables[logical]
	}
	return r, nil
}

// NewEnterpriseSalesReader accepts only the fixed B2 mapping supplied by Registry.
func NewEnterpriseSalesReader(tables map[string]string) (*SalesReader, error) {
	r, e := NewSalesReader(tables)
	if e != nil {
		return nil, e
	}
	r.apf = true
	return r, nil
}
func (r *SalesReader) table(logical string) string { return "`" + r.tables[logical] + "`" }

type SalesReadQuery struct {
	Page          int    `json:"page"`
	PageSize      int    `json:"pageSize"`
	Search        string `json:"search"`
	Status        string `json:"status"`
	CustomerID    string `json:"customerId"`
	OpportunityID string `json:"opportunityId"`
}

func (q SalesReadQuery) Validate(resource string) error {
	if err := (BasicReadQuery{Page: q.Page, PageSize: q.PageSize, Search: q.Search, Status: q.Status}).Validate("customer"); err != nil {
		return err
	}
	if resource != "lead" && resource != "opportunity" && resource != "quotation" {
		return basicReadForbidden()
	}
	for _, id := range []string{q.CustomerID, q.OpportunityID} {
		if id != "" && !salesPositiveID(id) {
			return httperror.New(400, "altoc_sales_input_invalid", "Invalid Altoc sales filter")
		}
	}
	if resource == "lead" && (q.CustomerID != "" || q.OpportunityID != "") || resource == "opportunity" && q.OpportunityID != "" {
		return httperror.New(400, "altoc_sales_input_invalid", "Unsupported Altoc sales filter")
	}
	return nil
}

var salesReadColumns = map[string][]string{
	"lead":        {"id", "code", "name", "org_name", "source_type", "score", "status", "owner_user_id", "owner_dept_code", "last_follow_up_at", "converted_customer_id", "converted_opportunity_id", "created_at", "updated_at"},
	"opportunity": {"id", "code", "name", "status", "customer_id", "lead_id", "stage_id", "amount_tax_inclusive", "currency_code", "forecast_category", "win_rate", "expected_sign_date", "expected_payment_date", "version_no", "owner_user_id", "owner_dept_code", "created_at", "updated_at"},
	"quotation":   {"id", "code", "quotation_no", "version_no", "status", "customer_id", "opportunity_id", "amount_tax_inclusive", "currency_code", "valid_until", "discount_rate", "tax_rate", "owner_user_id", "owner_dept_code", "created_at", "updated_at"},
}

// ReadInTransaction requires a Registry snapshot transaction and a trusted actor
// permit. Each resource uses its own current owner/dept, never a linked master.
func (r *SalesReader) ReadInTransaction(ctx context.Context, tx *sql.Tx, resource, id, actor string, scope BasicReadScope, q SalesReadQuery) (map[string]any, error) {
	if r == nil || tx == nil || actor == "" {
		return nil, basicReadForbidden()
	}
	if err := scope.Validate(); err != nil {
		return nil, err
	}
	if err := q.Validate(resource); err != nil {
		return nil, err
	}
	if id != "" && !salesPositiveID(id) {
		return nil, httperror.New(400, "altoc_sales_input_invalid", "Invalid Altoc object ID")
	}
	alias := "s"
	trusted := url.Values{"current_user": {actor}, "current_user_altoc_access": {scope.Access}, "current_user_altoc_dept_codes": {strings.Join(scope.DepartmentCodes, ",")}}
	ownerColumn := "owner_user_id"
	if r.apf {
		ownerColumn = "owner_uid"
	}
	where, args, err := altocReadScopeWhere(trusted, resource, alias, ownerColumn, "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, "s.deleted_at IS NULL")
	from := r.table(resource) + " s"
	columns := []string{}
	cols := append([]string{}, salesReadColumns[resource]...)
	if r.apf {
		cols = append(cols, "row_version")
		if resource == "lead" {
			cols = append(cols, "source_detail", "need_summary", "project_type", "estimated_budget", "budget_status", "expected_procurement_date", "procurement_mode", "source_evidence_url", "contact_name", "contact_mobile", "contact_email", "remark", "next_action", "next_action_due_at")
		} else if resource == "opportunity" {
			cols = append(cols, "source_type", "source_detail", "next_action", "next_action_due_at", "risk_level", "risk_reason", "competitor_info", "remark", "won_reason_code", "won_reason", "lost_reason_code", "lost_reason", "pause_reason_code", "pause_reason")
		}
	}
	for _, c := range cols {
		if r.apf && c == "owner_user_id" {
			c = "owner_uid"
		}
		columns = append(columns, "s.`"+c+"`")
	}
	if resource == "opportunity" {
		from += " LEFT JOIN " + r.table("opportunity_stage") + " os ON os.id=s.stage_id"
		columns = append(columns, "os.name AS stage_name", "os.win_rate AS stage_win_rate")
		// The independent list defaults to the default pipeline if that column
		// exists, while detail reads do not filter pipeline. Inspect only the mapped
		// local stage table; no schema fallback or arbitrary browser pipeline.
		if id == "" {
			stageColumns, e := altocTableColumns(ctx, tx, r.tables["opportunity_stage"])
			if e != nil {
				return nil, e
			}
			if len(stageColumns) == 0 {
				return nil, fmt.Errorf("Altoc stage schema unavailable")
			}
			if stageColumns["pipeline_code"] {
				where = append(where, "os.pipeline_code = ?")
				args = append(args, "default")
			}
		}
	}
	if id != "" {
		where = append(where, "s.id = ?")
		args = append(args, id)
	}
	if q.Search != "" {
		name := "name"
		if resource == "quotation" {
			name = "quotation_no"
		}
		where = append(where, "(s.code LIKE ? ESCAPE '\\\\' OR s."+name+" LIKE ? ESCAPE '\\\\')")
		keyword := altocLikeKeyword(q.Search)
		args = append(args, keyword, keyword)
	}
	if q.Status != "" {
		where = append(where, "s.status = ?")
		args = append(args, q.Status)
	}
	if q.CustomerID != "" {
		where = append(where, "s.customer_id = ?")
		args = append(args, q.CustomerID)
	}
	if q.OpportunityID != "" {
		where = append(where, "s.opportunity_id = ?")
		args = append(args, q.OpportunityID)
	}
	suffix := " FROM " + from + " WHERE " + strings.Join(where, " AND ")
	selectSQL := "SELECT " + strings.Join(columns, ",") + suffix
	if id == "" {
		var total int64
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+suffix, args...).Scan(&total); err != nil {
			return nil, err
		}
		rows, e := altocQueryMaps(ctx, tx, selectSQL+" ORDER BY s.updated_at DESC,s.id DESC LIMIT ? OFFSET ?", append(append([]any{}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
		if e != nil {
			return nil, e
		}
		if rows == nil {
			rows = []map[string]any{}
		}
		return map[string]any{"items": rows, "total": total, "page": q.Page, "pageSize": q.PageSize}, nil
	}
	row, err := altocQueryOneMap(ctx, tx, selectSQL+" LIMIT 1", args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httperror.New(404, "record_not_found", "Altoc object not found")
	}
	if r.apf && resource == "opportunity" {
		stages, e := altocQueryMaps(ctx, tx, "SELECT id,code,name,stage_kind FROM "+r.table("opportunity_stage")+" WHERE is_enabled=1 AND pipeline_code=(SELECT pipeline_code FROM "+r.table("opportunity_stage")+" WHERE id=?) ORDER BY sort_no,id LIMIT 101", row["stage_id"])
		if e != nil {
			return nil, e
		}
		if len(stages) > 100 {
			return nil, httperror.New(503, "altoc_sales_stage_limit", "Stage configuration unavailable")
		}
		if stages == nil {
			stages = []map[string]any{}
		}
		row["stages"] = stages
	}
	if resource == "quotation" {
		// This canonical child has no deleted_at. Parent authorization precedes
		// the query. Read one sentinel row beyond the limit, never silently truncate.
		items, e := altocQueryMaps(ctx, tx, "SELECT id,quotation_id,item_name,specification,unit,quantity,unit_price,amount_tax_inclusive,sort_no FROM "+r.table("quotation_item")+" WHERE quotation_id = ? ORDER BY sort_no,id LIMIT 1001", id)
		if e != nil {
			return nil, e
		}
		if len(items) > 1000 {
			return nil, httperror.New(503, "altoc_sales_children_limit", "Quotation detail is unavailable")
		}
		if items == nil {
			items = []map[string]any{}
		}
		row["items"] = items
	}
	return row, nil
}

func salesPositiveID(id string) bool {
	v, err := strconv.ParseInt(id, 10, 64)
	return err == nil && v <= 9007199254740991 && basicPositiveID(id)
}
