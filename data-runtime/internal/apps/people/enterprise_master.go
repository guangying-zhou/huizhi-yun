package people

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseMasterInput is closed: no employee or Directory mutation is exposed.
type EnterpriseMasterInput struct {
	ID          string                `json:"id"`
	Page        int                   `json:"page"`
	PageSize    int                   `json:"pageSize"`
	Search      string                `json:"search"`
	Payload     map[string]any        `json:"payload"`
	CostAllowed bool                  `json:"costAllowed"`
	CostScope   EnterpriseMasterScope `json:"costScope"`
}
type EnterpriseMasterScope struct {
	Access          string   `json:"access"`
	DepartmentCodes []string `json:"departmentCodes"`
}

func EnterpriseMasterPermission(op string) (string, string, bool) {
	switch op {
	case "employees-private-view", "employees-private-update":
		return "employees", "edit", true
	case "positions-create", "positions-update", "positions-delete":
		return "positions", "admin", true
	case "ranks-list", "ranks-view":
		return "ranks", "view", true
	case "ranks-create", "ranks-update", "ranks-delete":
		return "ranks", "admin", true
	case "standard-costs-list", "standard-costs-view":
		return "standard_costs", "view", true
	case "standard-costs-create", "standard-costs-update":
		return "standard_costs", "admin", true
	case "employees-search", "employees-profile":
		return "employees", "view", true
	case "assignments-list", "assignments-view":
		return "assignments", "view", true
	}
	return "", "", false
}
func EnterpriseMasterIntent(i EnterpriseMasterInput) []any {
	keys := []string{}
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := []any{}
	for _, k := range keys {
		pairs = append(pairs, []any{k, i.Payload[k]})
	}
	deps := i.CostScope.DepartmentCodes
	if deps == nil {
		deps = []string{}
	}
	return []any{i.ID, i.Page, i.PageSize, i.Search, pairs, i.CostAllowed, i.CostScope.Access, deps}
}
func masterInvalid() error {
	return httperror.New(400, "people_master_input_invalid", "Invalid People input")
}
func masterText(v any, max int, empty bool) bool {
	if v == nil {
		return empty
	}
	s, ok := v.(string)
	if !ok || len([]rune(s)) > max || strings.TrimSpace(s) != s || (!empty && s == "") {
		return false
	}
	for _, c := range s {
		if c < 32 || c == 127 {
			return false
		}
	}
	return true
}

var masterCode = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func MasterScopeValid(s EnterpriseMasterScope) bool {
	switch s.Access {
	case "all", "self", "none":
		return len(s.DepartmentCodes) == 0
	case "dept", "self_dept":
		if len(s.DepartmentCodes) == 0 || len(s.DepartmentCodes) > 1000 {
			return false
		}
		for _, d := range s.DepartmentCodes {
			if !masterText(d, 64, false) {
				return false
			}
		}
		return true
	}
	return false
}
func ValidateEnterpriseMasterInput(op string, i EnterpriseMasterInput) error {
	if IsEnterprisePrivateOperation(op) {
		return ValidateEnterprisePrivateInput(op, i)
	}
	resource, action, ok := EnterpriseMasterPermission(op)
	if !ok {
		return masterInvalid()
	}
	list := strings.HasSuffix(op, "-list") || op == "employees-search"
	if !MasterScopeValid(i.CostScope) || (!i.CostAllowed && i.CostScope.Access != "none") {
		return masterInvalid()
	}
	if list {
		if i.ID != "" || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || !masterText(i.Search, 200, true) {
			return masterInvalid()
		}
	} else {
		if i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return masterInvalid()
		}
		if !strings.HasSuffix(op, "-create") {
			if resource == "employees" {
				if !masterText(i.ID, 64, false) {
					return masterInvalid()
				}
			} else {
				n, e := strconv.ParseUint(i.ID, 10, 53)
				if e != nil || n == 0 || strconv.FormatUint(n, 10) != i.ID {
					return masterInvalid()
				}
			}
		} else if i.ID != "" {
			return masterInvalid()
		}
	}
	if resource != "employees" && resource != "assignments" && (i.CostAllowed || i.CostScope.Access != "none") {
		return masterInvalid()
	}
	if action == "view" {
		if len(i.Payload) != 0 {
			return masterInvalid()
		}
		return nil
	}
	fields := map[string]int{"position_code": 64, "position_name": 100, "job_family": 64, "description": 255, "enabled": 0, "sort_order": 0}
	if resource == "ranks" {
		fields = map[string]int{"rank_code": 32, "rank_name": 100, "rank_series": 1, "rank_level": 0, "description": 255, "enabled": 0, "sort_order": 0}
	}
	if resource == "standard_costs" {
		fields = map[string]int{"rate_code": 64, "rate_name": 120, "rank_code": 32, "rank_series": 1, "rank_level": 0, "position_code": 64, "employment_type": 20, "cost_center_code": 64, "rank_salary": -1, "performance_salary_min": -1, "performance_salary_max": -1, "currency": 3, "effective_from": 10, "effective_to": 10, "enabled": 0, "sort_order": 0, "remarks": 500}
	}
	create := strings.HasSuffix(op, "-create")
	del := strings.HasSuffix(op, "-delete")
	if !create {
		fields["expectedVersion"] = 0
	}
	for k, v := range i.Payload {
		max, ok := fields[k]
		if !ok || (del && k != "expectedVersion") {
			return masterInvalid()
		}
		if max == 0 {
			n, ok := v.(float64)
			if !ok || n != float64(int64(n)) || n < 0 || n > 2147483647 || k == "expectedVersion" && n < 1 || k == "enabled" && n > 1 {
				return masterInvalid()
			}
		} else if max == -1 {
			s, ok := v.(string)
			if !ok || !regexp.MustCompile(`^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$`).MatchString(s) {
				return masterInvalid()
			}
		} else if !masterText(v, max, true) {
			return masterInvalid()
		}
	}
	if !create {
		if _, ok := i.Payload["expectedVersion"]; !ok {
			return masterInvalid()
		}
	}
	if del {
		return nil
	}
	// Full editable snapshots keep version and interval checks explicit.
	required := []string{"position_code", "position_name"}
	if resource == "ranks" {
		required = []string{"rank_code", "rank_name", "rank_series", "rank_level"}
	}
	if resource == "standard_costs" {
		required = []string{"rate_code", "rate_name", "rank_code", "rank_series", "rank_level", "rank_salary", "performance_salary_min", "performance_salary_max", "currency", "effective_from"}
	}
	for _, k := range required {
		v, ok := i.Payload[k]
		if !ok || v == nil || v == "" {
			return masterInvalid()
		}
	}
	for _, k := range []string{"position_code", "rank_code", "rate_code"} {
		v := i.Payload[k]
		if v != nil && v != "" {
			s, ok := v.(string)
			if !ok || !masterCode.MatchString(s) {
				return masterInvalid()
			}
		}
	}
	if resource != "positions" {
		if i.Payload["rank_series"] != "M" && i.Payload["rank_series"] != "P" {
			return masterInvalid()
		}
	}
	if resource == "standard_costs" {
		for _, k := range []string{"effective_from", "effective_to"} {
			v := i.Payload[k]
			if v != nil && v != "" {
				s := v.(string)
				d, e := time.Parse("2006-01-02", s)
				if e != nil || d.Format("2006-01-02") != s {
					return masterInvalid()
				}
			}
		}
		if to, ok := i.Payload["effective_to"].(string); ok && to != "" && to < i.Payload["effective_from"].(string) {
			return masterInvalid()
		}
		if !regexp.MustCompile(`^[A-Z]{3}$`).MatchString(fmt.Sprint(i.Payload["currency"])) {
			return masterInvalid()
		}
		if v := i.Payload["employment_type"]; v != nil && v != "" && v != "full_time" && v != "part_time" && v != "outsourced" && v != "intern" && v != "agent" {
			return masterInvalid()
		}
		cents := func(v any) int64 {
			s := v.(string)
			parts := strings.Split(s, ".")
			n, _ := strconv.ParseInt(parts[0], 10, 64)
			fraction := "00"
			if len(parts) > 1 {
				fraction = (parts[1] + "0")[:2]
			}
			f, _ := strconv.ParseInt(fraction, 10, 64)
			return n*100 + f
		}
		if cents(i.Payload["performance_salary_min"]) > cents(i.Payload["performance_salary_max"]) {
			return masterInvalid()
		}
	}
	return nil
}
func masterKind(op string) (table, code string, cols []string) {
	switch {
	case strings.HasPrefix(op, "positions-"):
		return "people_positions", "position_code", []string{"id", "position_code", "position_name", "job_family", "description", "enabled", "sort_order", "row_version"}
	case strings.HasPrefix(op, "ranks-"):
		return "people_ranks", "rank_code", []string{"id", "rank_code", "rank_name", "rank_series", "rank_level", "description", "enabled", "sort_order", "row_version"}
	default:
		return "people_standard_cost_rates", "rate_code", []string{"id", "rate_code", "rate_name", "rank_code", "rank_series", "rank_level", "position_code", "employment_type", "cost_center_code", "rank_salary", "performance_salary_min", "performance_salary_max", "currency", "effective_from", "effective_to", "enabled", "sort_order", "remarks", "row_version"}
	}
}
func MasterColumns(op string) (string, []string) { t, _, c := masterKind(op); return t, c }

// MasterWriteTx owns the business mutation, never starts or commits a transaction.
// Receipt replay is handled by caller only after permission and lock checks.
func MasterWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), op string, i EnterpriseMasterInput, actor string) (map[string]any, error) {
	if e := ValidateEnterpriseMasterInput(op, i); e != nil {
		return nil, e
	}
	logical, code, cols := masterKind(op)
	t, e := table(logical)
	if e != nil {
		return nil, e
	}
	create := strings.HasSuffix(op, "-create")
	del := strings.HasSuffix(op, "-delete")
	if !create {
		var version int64
		var currentCode string
		if e = tx.QueryRowContext(ctx, "SELECT row_version,"+code+" FROM "+t+" WHERE id=? FOR UPDATE", i.ID).Scan(&version, &currentCode); e == sql.ErrNoRows {
			return nil, httperror.New(404, "people_object_not_found", "Object unavailable")
		} else if e != nil {
			return nil, e
		}
		if !del && i.Payload[code] != currentCode {
			return nil, httperror.New(409, "people_code_immutable", "Business code cannot change")
		}
		if float64(version) != i.Payload["expectedVersion"] {
			return nil, httperror.New(409, "people_version_conflict", "Object version changed")
		}
	}
	if del {
		// Serialize dictionaries and references through the caller's registry lock.
		for _, ref := range []string{"people_employees", "people_assignments", "people_standard_cost_rates"} {
			rt, e := table(ref)
			if e != nil {
				return nil, e
			}
			var n int
			q := "SELECT COUNT(*) FROM " + rt + " WHERE BINARY " + code + "=BINARY (SELECT " + code + " FROM " + t + " WHERE id=?)"
			if e = tx.QueryRowContext(ctx, q, i.ID).Scan(&n); e != nil {
				return nil, e
			}
			if n > 0 {
				return nil, httperror.New(409, "people_dictionary_in_use", "Dictionary is referenced")
			}
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM "+t+" WHERE id=?", i.ID); e != nil {
			return nil, e
		}
		return map[string]any{"id": i.ID, "deleted": true}, nil
	}
	if logical == "people_standard_cost_rates" {
		rank, e := table("people_ranks")
		if e != nil {
			return nil, e
		}
		var series string
		var level int
		if e = tx.QueryRowContext(ctx, "SELECT rank_series,rank_level FROM "+rank+" WHERE BINARY rank_code=BINARY ? AND enabled=1 FOR UPDATE", i.Payload["rank_code"]).Scan(&series, &level); e == sql.ErrNoRows {
			return nil, masterInvalid()
		} else if e != nil {
			return nil, e
		}
		if series != i.Payload["rank_series"] || float64(level) != i.Payload["rank_level"] {
			return nil, masterInvalid()
		}
		if p := i.Payload["position_code"]; p != nil && p != "" {
			pt, e := table("people_positions")
			if e != nil {
				return nil, e
			}
			var id int
			if e = tx.QueryRowContext(ctx, "SELECT id FROM "+pt+" WHERE BINARY position_code=BINARY ? AND enabled=1 FOR UPDATE", p).Scan(&id); e != nil {
				return nil, masterInvalid()
			}
		}
	}
	keys := []string{}
	for k := range i.Payload {
		if k != "expectedVersion" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	names, marks, values := []string{}, []string{}, []any{}
	for _, k := range keys {
		names = append(names, k)
		marks = append(marks, "?")
		v := i.Payload[k]
		if (k == "effective_to" || k == "position_code" || k == "employment_type" || k == "cost_center_code") && v == "" {
			v = nil
		}
		values = append(values, v)
	}
	id := i.ID
	if create {
		names = append(names, "created_by", "updated_by")
		marks = append(marks, "?", "?")
		values = append(values, actor, actor)
		res, e := tx.ExecContext(ctx, "INSERT INTO "+t+" ("+strings.Join(names, ",")+") VALUES ("+strings.Join(marks, ",")+")", values...)
		if e != nil {
			return nil, e
		}
		n, e := res.LastInsertId()
		if e != nil {
			return nil, e
		}
		id = strconv.FormatInt(n, 10)
	} else {
		sets := []string{}
		for _, k := range names {
			sets = append(sets, k+"=?")
		}
		values = append(values, actor, id, i.Payload["expectedVersion"])
		res, e := tx.ExecContext(ctx, "UPDATE "+t+" SET "+strings.Join(sets, ",")+",updated_by=?,row_version=row_version+1 WHERE id=? AND row_version=?", values...)
		if e != nil {
			return nil, e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return nil, httperror.New(409, "people_version_conflict", "Object version changed")
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+MasterSelect(cols)+" FROM "+t+" WHERE id=?", id)
	if e != nil {
		return nil, e
	}
	items, e := MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	return items[0], nil
}
func MasterSelect(cols []string) string {
	out := []string{}
	for _, c := range cols {
		if c == "has_reservation" {
			out = append(out, "(reservation_id IS NOT NULL) AS has_reservation")
			continue
		}
		if strings.Contains(c, "salary") || strings.HasPrefix(c, "effective_") || c == "onboard_date" || c == "leave_date" {
			out = append(out, "CAST("+c+" AS CHAR) AS "+c)
		} else {
			out = append(out, c)
		}
	}
	return strings.Join(out, ",")
}
func MasterRows(rows *sql.Rows, cols []string) ([]map[string]any, error) {
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for n := range vals {
			ptr[n] = &vals[n]
		}
		if e := rows.Scan(ptr...); e != nil {
			return nil, e
		}
		item := map[string]any{}
		for n, c := range cols {
			v := vals[n]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			item[c] = v
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
