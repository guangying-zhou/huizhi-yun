package finance

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) PeopleCostParameters(ctx context.Context, query url.Values) (DataResult[map[string]any], error) {
	effectiveDate := strings.TrimSpace(firstNonEmpty(query.Get("effectiveDate"), query.Get("effective_date")))
	if effectiveDate == "" {
		effectiveDate = todayDate()
	}
	if _, err := time.Parse("2006-01-02", effectiveDate); err != nil {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "invalid_effective_date", "effective_date must be YYYY-MM-DD")
	}

	row, err := queryOneMap(ctx, a.db, `
		SELECT
		  id,
		  code,
		  code AS parameter_code,
		  name,
		  name AS parameter_name,
		  effective_from,
		  effective_to,
		  base_salary,
		  welfare_cost_rate,
		  management_allocation_rate,
		  resource_allocation_cost,
		  currency_code,
		  status,
		  remark,
		  updated_at
		FROM finance_people_cost_parameter
		WHERE status = 'active'
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY effective_from DESC, id DESC
		LIMIT 1
	`, effectiveDate, effectiveDate)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if row == nil {
		return DataResult[map[string]any]{}, httperror.New(http.StatusNotFound, "people_cost_parameters_not_found", "People cost parameters are not configured in Finance")
	}
	row["effective_date"] = effectiveDate
	return resultData(row), nil
}
