package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// BasicReader is the owning-domain projection for Enterprise's read-only pages.
// It has no Finance bridge and never invokes the independent app's enriched
// readers. Tables are supplied by the local Registry, never by an HTTP input.
type BasicReader struct{ tables map[string]string }

var BasicReadTables = []string{"customer", "contract", "receivable_plan", "contract_line", "contract_payment_term", "contract_obligation", "contract_billing_schedule"}
var basicTableName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func NewBasicReader(tables map[string]string) (*BasicReader, error) {
	r := &BasicReader{tables: map[string]string{}}
	for _, logical := range BasicReadTables {
		name := tables[logical]
		if !basicTableName.MatchString(name) {
			return nil, fmt.Errorf("invalid Altoc basic table mapping: %s", logical)
		}
		r.tables[logical] = "`" + name + "`"
	}
	return r, nil
}

type BasicReadScope struct {
	Access          string   `json:"access"`
	DepartmentCodes []string `json:"departmentCodes"`
}
type BasicReadQuery struct {
	Page       int    `json:"page"`
	PageSize   int    `json:"pageSize"`
	Search     string `json:"search"`
	Status     string `json:"status"`
	CustomerID string `json:"customerId"`
	ContractID string `json:"contractId"`
}

func (s BasicReadScope) Validate() error {
	switch s.Access {
	case "all", "self", "dept", "self_dept", "none":
	default:
		return basicReadForbidden()
	}
	if len(s.DepartmentCodes) > 1000 {
		return basicReadForbidden()
	}
	if (s.Access == "dept" || s.Access == "self_dept") && len(s.DepartmentCodes) == 0 {
		return basicReadForbidden()
	}
	if (s.Access == "self" || s.Access == "none") && len(s.DepartmentCodes) != 0 {
		return basicReadForbidden()
	}
	seen := map[string]bool{}
	for _, code := range s.DepartmentCodes {
		if strings.TrimSpace(code) != code || code == "" || len(code) > 100 || strings.ContainsAny(code, ",\x00\r\n") || seen[code] {
			return basicReadForbidden()
		}
		seen[code] = true
	}
	return nil
}
func basicReadForbidden() error {
	return httperror.New(http.StatusForbidden, "altoc_basic_scope_invalid", "Altoc read scope is invalid")
}
func (q BasicReadQuery) Validate(resource string) error {
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || len(q.Search) > 200 || len(q.Status) > 40 || strings.ContainsAny(q.Search+q.Status, "\x00\r\n") {
		return httperror.New(400, "altoc_basic_input_invalid", "Invalid Altoc read query")
	}
	for _, id := range []string{q.CustomerID, q.ContractID} {
		if id != "" && !basicPositiveID(id) {
			return httperror.New(400, "altoc_basic_input_invalid", "Invalid Altoc object ID")
		}
	}
	if resource == "customer" && (q.CustomerID != "" || q.ContractID != "") || resource == "contract" && q.ContractID != "" {
		return httperror.New(400, "altoc_basic_input_invalid", "Unsupported Altoc filter")
	}
	return nil
}
func basicPositiveID(id string) bool {
	v, err := strconv.ParseInt(id, 10, 64)
	return err == nil && v > 0 && strconv.FormatInt(v, 10) == id
}

var basicReadColumns = map[string][]string{
	"customer":   {"id", "code", "name", "short_name", "status", "industry_code", "region_code", "telephone", "website", "address", "owner_user_id", "owner_dept_code", "created_at", "updated_at"},
	"contract":   {"id", "code", "name", "customer_id", "parent_contract_id", "status", "legal_status", "fulfillment_status", "activation_status", "direction", "primary_type", "sign_date", "effective_date", "end_date", "amount_tax_inclusive", "currency_code", "owner_user_id", "owner_dept_code", "created_at", "updated_at"},
	"receivable": {"id", "code", "plan_name", "contract_id", "customer_id", "amount", "planned_payment_date", "status", "owner_user_id", "collection_responsible_uid", "updated_at"},
}

// ReadInTransaction must be called with a Registry snapshot transaction after
// authentication and actor-bound permit validation. Relation names are omitted:
// a receivable/contract view grant is not a customer/contract master view grant.
func (r *BasicReader) ReadInTransaction(ctx context.Context, tx *sql.Tx, resource, identifier, actor string, scope BasicReadScope, query BasicReadQuery) (map[string]any, error) {
	if r == nil || tx == nil || actor == "" {
		return nil, basicReadForbidden()
	}
	if err := scope.Validate(); err != nil {
		return nil, err
	}
	if err := query.Validate(resource); err != nil {
		return nil, err
	}
	if identifier != "" && !basicPositiveID(identifier) {
		return nil, httperror.New(400, "altoc_basic_input_invalid", "Invalid Altoc object ID")
	}
	table, alias := "", ""
	switch resource {
	case "customer":
		table, alias = "customer", "cu"
	case "contract":
		table, alias = "contract", "ct"
	case "receivable":
		table, alias = "receivable_plan", "rp"
	default:
		return nil, basicReadForbidden()
	}
	trusted := url.Values{"current_user": {actor}, "current_user_altoc_access": {scope.Access}, "current_user_altoc_dept_codes": {strings.Join(scope.DepartmentCodes, ",")}}
	from := r.tables[table] + " " + alias
	var where []string
	var args []any
	var err error
	if resource == "receivable" {
		// Same current owner/collection-responsible/contract-department rules as
		// the independent owning read; this join never selects contract names.
		from += " LEFT JOIN " + r.tables["contract"] + " ct ON ct.id=rp.contract_id AND ct.deleted_at IS NULL"
		where, args, err = altocReceivablePlanReadScopeWhere(trusted, nil, "rp", "ct")
	} else {
		where, args, err = altocReadScopeWhere(trusted, resource, alias, "owner_user_id", "owner_dept_code")
	}
	if err != nil {
		return nil, err
	}
	where = append(where, alias+".deleted_at IS NULL")
	if identifier != "" {
		where = append(where, alias+".id = ?")
		args = append(args, identifier)
	}
	if query.Search != "" {
		nameColumn := "name"
		if resource == "receivable" {
			nameColumn = "plan_name"
		}
		where = append(where, "("+alias+".code LIKE ? OR "+alias+"."+nameColumn+" LIKE ?)")
		args = append(args, "%"+query.Search+"%", "%"+query.Search+"%")
	}
	if query.Status != "" {
		where = append(where, alias+".status = ?")
		args = append(args, query.Status)
	}
	if query.CustomerID != "" {
		where = append(where, alias+".customer_id = ?")
		args = append(args, query.CustomerID)
	}
	if query.ContractID != "" {
		where = append(where, alias+".contract_id = ?")
		args = append(args, query.ContractID)
	}
	suffix := " FROM " + from + " WHERE " + strings.Join(where, " AND ")
	columns := make([]string, len(basicReadColumns[resource]))
	for i, column := range basicReadColumns[resource] {
		columns[i] = alias + ".`" + column + "`"
	}
	selectSQL := "SELECT " + strings.Join(columns, ",") + suffix
	if identifier == "" {
		var total int64
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+suffix, args...).Scan(&total); err != nil {
			return nil, err
		}
		items, readErr := altocQueryMaps(ctx, tx, selectSQL+" ORDER BY "+alias+".id DESC LIMIT ? OFFSET ?", append(append([]any{}, args...), query.PageSize, (query.Page-1)*query.PageSize)...)
		if readErr != nil {
			return nil, readErr
		}
		if items == nil {
			items = []map[string]any{}
		}
		return map[string]any{"items": items, "total": total, "page": query.Page, "pageSize": query.PageSize}, nil
	}
	row, err := altocQueryOneMap(ctx, tx, selectSQL+" LIMIT 1", args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httperror.New(404, "record_not_found", "Altoc object not found")
	}
	if resource == "contract" {
		for _, child := range basicContractChildren {
			childFilter := " WHERE contract_id = ?"
			if child.table != "contract_payment_term" {
				childFilter += " AND deleted_at IS NULL"
			}
			data, childErr := altocQueryMaps(ctx, tx, "SELECT "+child.columns+" FROM "+r.tables[child.table]+childFilter+" ORDER BY id", identifier)
			if childErr != nil {
				return nil, childErr
			}
			if data == nil {
				data = []map[string]any{}
			}
			row[child.key] = data
		}
	}
	return row, nil
}

var basicContractChildren = []struct{ key, table, columns string }{
	{"lines", "contract_line", "id,code,line_no,line_type,name,quantity,unit_price,amount_tax_inclusive"},
	{"payment_terms", "contract_payment_term", "id,term_name,term_type,amount,ratio,expected_date,sort_no"},
	{"obligations", "contract_obligation", "id,code,contract_line_id,name,obligation_type,status,planned_due_at"},
	{"billing_schedules", "contract_billing_schedule", "id,code,contract_line_id,name,direction,amount,expected_date,status"},
}
