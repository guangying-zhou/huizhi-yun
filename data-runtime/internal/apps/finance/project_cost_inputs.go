package finance

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
	"time"
)

type ProjectCostInputs struct{ Table func(string) (string, error) }

func (a ProjectCostInputs) ReadCostParameterInput(ctx context.Context, tx *sql.Tx, asOf time.Time) (projectcost.ParameterInput, error) {
	table, e := a.Table("finance_people_cost_parameter")
	if e != nil {
		return projectcost.ParameterInput{}, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT code,CAST(row_version AS CHAR),currency_code,CAST(effective_from AS CHAR),COALESCE(CAST(effective_to AS CHAR),''),CAST(base_salary AS CHAR),CAST(welfare_cost_rate AS CHAR),CAST(management_allocation_rate AS CHAR),CAST(resource_allocation_cost AS CHAR),status FROM "+table+" ORDER BY id FOR UPDATE")
	if e != nil {
		return projectcost.ParameterInput{}, e
	}
	defer rows.Close()
	out := projectcost.ParameterInput{}
	date := asOf.Format("2006-01-02")
	for rows.Next() {
		var v projectcost.ParameterInput
		var to, status string
		if e = rows.Scan(&v.Code, &v.Version, &v.Currency, &v.EffectiveDate, &to, &v.BaseSalary, &v.WelfareRate, &v.ManagementRate, &v.ResourceCost, &status); e != nil {
			return out, e
		}
		if status == "active" && v.EffectiveDate <= date && (to == "" || to >= date) && v.EffectiveDate >= out.EffectiveDate {
			out = v
		}
	}
	return out, rows.Err()
}
