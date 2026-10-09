package people

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
	"sort"
	"time"
)

type ProjectCostInputs struct{ Table func(string) (string, error) }

func (a ProjectCostInputs) ReadStandardCostInputs(ctx context.Context, tx *sql.Tx, uids []string, asOf time.Time) ([]projectcost.PersonInput, error) {
	employees, e := a.Table("people_employees")
	if e != nil {
		return nil, e
	}
	assignments, e := a.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	rates, e := a.Table("people_standard_cost_rates")
	if e != nil {
		return nil, e
	}
	ordered := append([]string{}, uids...)
	sort.Strings(ordered)
	out := []projectcost.PersonInput{}
	// Separate phases preserve table order across employees. Lock all candidate
	// rows, including disabled/future rows, so insertion/enablement cannot phantom.
	for _, uid := range ordered {
		v := projectcost.PersonInput{EmployeeUID: uid}
		e = tx.QueryRowContext(ctx, "SELECT CAST(row_version AS CHAR),COALESCE(employment_type,''),COALESCE(cost_center_code,'') FROM "+employees+" WHERE BINARY employee_uid=BINARY ? AND archived_at IS NULL FOR UPDATE", uid).Scan(&v.EmployeeVersion, &v.EmploymentType, &v.CostCenterCode)
		if errors.Is(e, sql.ErrNoRows) {
			v.MissingReason = "missing_people_employee"
		} else if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	// Primary-index scan fixes assignment lock order globally, including gaps
	// and inactive/future candidates. Selection remains limited to frozen UIDs.
	type assignment struct {
		uid, code, version, dept, position, rank, from, to, status string
		primary                                                    int
	}
	ars, e := tx.QueryContext(ctx, "SELECT employee_uid,assignment_code,CAST(row_version AS CHAR),COALESCE(dept_code,''),COALESCE(position_code,''),COALESCE(rank_code,''),CAST(effective_from AS CHAR),COALESCE(CAST(effective_to AS CHAR),''),is_primary,approval_status FROM "+assignments+" FORCE INDEX(PRIMARY) ORDER BY id FOR UPDATE")
	if e != nil {
		return nil, e
	}
	matches := map[string][]assignment{}
	for ars.Next() {
		var v assignment
		if e = ars.Scan(&v.uid, &v.code, &v.version, &v.dept, &v.position, &v.rank, &v.from, &v.to, &v.primary, &v.status); e != nil {
			ars.Close()
			return nil, e
		}
		matches[v.uid] = append(matches[v.uid], v)
	}
	e = ars.Err()
	ars.Close()
	if e != nil {
		return nil, e
	}
	for n := range out {
		v := &out[n]
		found := false
		latest := ""
		date := asOf.Format("2006-01-02")
		for _, r := range matches[v.EmployeeUID] {
			if r.primary == 1 && (r.status == "none" || r.status == "approved") && r.from <= date && (r.to == "" || r.to >= date) && r.from >= latest {
				found = true
				latest = r.from
				v.AssignmentCode = r.code
				v.AssignmentVersion = r.version
				v.DepartmentCode = r.dept
				v.PositionCode = r.position
				v.RankCode = r.rank
			}
		}
		if !found && v.MissingReason == "" {
			v.MissingReason = "missing_effective_primary_assignment"
		}
	}
	// Lock the entire (small configuration) rate set once, globally by id;
	// filtering first would miss inserts/new enabled effective candidates.
	rows, e := tx.QueryContext(ctx, "SELECT id,rate_code,CAST(row_version AS CHAR),rank_code,COALESCE(position_code,''),COALESCE(employment_type,''),COALESCE(cost_center_code,''),CAST(rank_salary AS CHAR),CAST(performance_salary_min AS CHAR),CAST(performance_salary_max AS CHAR),currency,CAST(effective_from AS CHAR),COALESCE(CAST(effective_to AS CHAR),''),sort_order,enabled FROM "+rates+" ORDER BY id FOR UPDATE")
	if e != nil {
		return nil, e
	}
	type rate struct {
		id                                                                                      int64
		code, version, rank, position, employment, center, salary, min, max, currency, from, to string
		order, enabled                                                                          int
	}
	all := []rate{}
	for rows.Next() {
		var r rate
		if e = rows.Scan(&r.id, &r.code, &r.version, &r.rank, &r.position, &r.employment, &r.center, &r.salary, &r.min, &r.max, &r.currency, &r.from, &r.to, &r.order, &r.enabled); e != nil {
			rows.Close()
			return nil, e
		}
		all = append(all, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].from != all[j].from {
			return all[i].from > all[j].from
		}
		if all[i].order != all[j].order {
			return all[i].order < all[j].order
		}
		return all[i].id > all[j].id
	})
	for n := range out {
		v := &out[n]
		if v.MissingReason != "" {
			continue
		}
		date := asOf.Format("2006-01-02")
		matched := false
		for _, r := range all {
			if r.enabled == 1 && r.rank == v.RankCode && (r.position == "" || r.position == v.PositionCode) && (r.employment == "" || r.employment == v.EmploymentType) && (r.center == "" || r.center == v.CostCenterCode) && r.from <= date && (r.to == "" || r.to >= date) {
				v.RateCode = r.code
				v.RateVersion = r.version
				v.RateCurrency = r.currency
				v.RankSalary = r.salary
				v.PerformanceMin = r.min
				v.PerformanceMax = r.max
				matched = true
				break
			}
		}
		if !matched {
			v.MissingReason = "missing_people_standard_cost"
		}
	}
	return out, nil
}
