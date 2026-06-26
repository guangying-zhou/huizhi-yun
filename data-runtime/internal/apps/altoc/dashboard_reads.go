package altoc

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (a *Adapter) dashboardKPIs(ctx context.Context, query url.Values) (map[string]any, error) {
	period := dashboardPeriod(query)
	oppWhere := []string{
		"o.deleted_at IS NULL",
		"(" + dashboardPeriodClause("o.created_at", period) + " OR " + dashboardPeriodClause("o.won_at", period) + " OR " + dashboardPeriodClause("o.lost_at", period) + ")",
	}
	oppArgs := make([]any, 0)
	pipelineWhere, pipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "s")
	if err != nil {
		return nil, err
	}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "o", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	oppWhere = append(oppWhere, scopeWhere...)
	oppArgs = append(oppArgs, scopeArgs...)
	oppWhere = append(oppWhere, pipelineWhere...)
	oppArgs = append(oppArgs, pipelineArgs...)

	oppRow, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won_count,
		  SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END) AS lost_count,
		  AVG(CASE WHEN o.status = 'won' AND o.won_at IS NOT NULL THEN DATEDIFF(o.won_at, o.created_at) END) AS avg_cycle_days,
		  SUM(CASE WHEN o.status = 'active' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS pipeline_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON s.id = o.stage_id
		WHERE `+strings.Join(oppWhere, " AND "), oppArgs...)
	if err != nil {
		return nil, err
	}
	wonCount := moneyValue(oppRow["won_count"])
	lostCount := moneyValue(oppRow["lost_count"])
	wonRate := dashboardPercent(wonCount, wonCount+lostCount)
	avgCycle := dashboardNullableRounded(oppRow["avg_cycle_days"])
	pipelineAmount := moneyValue(oppRow["pipeline_amount"])

	weightedWhere := []string{"o.deleted_at IS NULL", "o.status = 'active'"}
	weightedArgs := make([]any, 0)
	weightedWhere = append(weightedWhere, scopeWhere...)
	weightedArgs = append(weightedArgs, scopeArgs...)
	weightedWhere = append(weightedWhere, pipelineWhere...)
	weightedArgs = append(weightedArgs, pipelineArgs...)
	forecastRow, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT SUM(COALESCE(o.amount_tax_inclusive, 0) * COALESCE(s.win_rate, 0) / 100) AS weighted
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON s.id = o.stage_id
		WHERE `+strings.Join(weightedWhere, " AND "), weightedArgs...)
	if err != nil {
		return nil, err
	}
	weightedForecast := moneyValue(forecastRow["weighted"])

	arScopeWhere, arScopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return nil, err
	}
	arWhere := []string{"rp.deleted_at IS NULL"}
	arWhere = append(arWhere, arScopeWhere...)
	arRow, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  SUM(CASE WHEN `+dashboardPeriodClause("rp.planned_payment_date", period)+` THEN COALESCE(rp.amount, 0) ELSE 0 END) AS planned_amount,
		  SUM(CASE WHEN `+dashboardPeriodClause("rp.planned_payment_date", period)+` THEN COALESCE(rp.received_amount, 0) ELSE 0 END) AS received_amount,
		  SUM(CASE WHEN rp.status = 'overdue' THEN COALESCE(rp.amount, 0) - COALESCE(rp.received_amount, 0) ELSE 0 END) AS overdue_amount,
		  SUM(CASE WHEN rp.status NOT IN ('received', 'bad_debt') THEN COALESCE(rp.amount, 0) - COALESCE(rp.received_amount, 0) ELSE 0 END) AS ar_balance
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(arWhere, " AND "), arScopeArgs...)
	if err != nil {
		return nil, err
	}
	plannedAmount := moneyValue(arRow["planned_amount"])
	receivedAmount := moneyValue(arRow["received_amount"])
	paymentRate := dashboardPercent(receivedAmount, plannedAmount)
	overdueAmount := moneyValue(arRow["overdue_amount"])
	arBalance := moneyValue(arRow["ar_balance"])

	contractScopeWhere, contractScopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	revenueWhere := []string{
		"ct.deleted_at IS NULL",
		"ct.status NOT IN ('draft', 'terminated', 'invalid')",
		"YEAR(ct.sign_date) = YEAR(NOW())",
	}
	revenueWhere = append(revenueWhere, contractScopeWhere...)
	revenueRow, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT SUM(COALESCE(ct.amount_tax_inclusive, 0)) AS year_revenue
		FROM contract ct
		WHERE `+strings.Join(revenueWhere, " AND "), contractScopeArgs...)
	if err != nil {
		return nil, err
	}
	yearRevenue := moneyValue(revenueRow["year_revenue"])
	var dso any
	if yearRevenue > 0 {
		dso = math.Round((arBalance * 365) / yearRevenue)
	}

	quoteScopeWhere, quoteScopeArgs, err := altocReadScopeWhere(query, "quotation", "q", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	quoteWhere := []string{
		"q.deleted_at IS NULL",
		"q.status != 'draft'",
		dashboardPeriodClause("q.created_at", period),
	}
	quoteWhere = append(quoteWhere, quoteScopeWhere...)
	quoteRow, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN q.status = 'accepted' THEN 1 ELSE 0 END) AS accepted
		FROM quotation q
		WHERE `+strings.Join(quoteWhere, " AND "), quoteScopeArgs...)
	if err != nil {
		return nil, err
	}
	quoteTotal := moneyValue(quoteRow["total"])
	quoteAccepted := moneyValue(quoteRow["accepted"])
	quoteConvRate := dashboardPercent(quoteAccepted, quoteTotal)

	return map[string]any{
		"period": period,
		"kpis": []map[string]any{
			{
				"key":    "won_rate",
				"label":  "商机赢单率",
				"value":  wonRate,
				"unit":   "percent",
				"health": dashboardHealthGrade(wonRate, 30, 15, false),
				"sub":    "赢 " + dashboardCountText(wonCount) + " / 输 " + dashboardCountText(lostCount),
			},
			{
				"key":    "avg_sales_cycle",
				"label":  "平均销售周期",
				"value":  avgCycle,
				"unit":   "days",
				"health": dashboardHealthGrade(avgCycle, 60, 90, true),
				"sub":    "从创建到赢单",
			},
			{
				"key":    "pipeline_amount",
				"label":  "漏斗金额",
				"value":  pipelineAmount,
				"unit":   "amount",
				"health": nil,
				"sub":    "进行中商机合计",
			},
			{
				"key":    "weighted_forecast",
				"label":  "加权预测",
				"value":  weightedForecast,
				"unit":   "amount",
				"health": nil,
				"sub":    "按阶段赢率加权",
			},
			{
				"key":    "payment_rate",
				"label":  "回款达成率",
				"value":  paymentRate,
				"unit":   "percent",
				"health": dashboardHealthGrade(paymentRate, 80, 60, false),
				"sub":    dashboardPaymentSub(receivedAmount, plannedAmount),
			},
			{
				"key":    "overdue_amount",
				"label":  "逾期应收",
				"value":  overdueAmount,
				"unit":   "amount",
				"health": dashboardOverdueHealth(overdueAmount),
				"sub":    "累计未回款",
			},
			{
				"key":    "dso",
				"label":  "DSO",
				"value":  dso,
				"unit":   "days",
				"health": dashboardHealthGrade(dso, 45, 60, true),
				"sub":    "应收账款周转天数",
			},
			{
				"key":    "quote_conv_rate",
				"label":  "报价转化率",
				"value":  quoteConvRate,
				"unit":   "percent",
				"health": dashboardHealthGrade(quoteConvRate, 40, 20, false),
				"sub":    dashboardCountText(quoteAccepted) + " / " + dashboardCountText(quoteTotal),
			},
		},
	}, nil
}

func (a *Adapter) dashboardFunnel(ctx context.Context, query url.Values) ([]map[string]any, error) {
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "o", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	pipelineWhere, pipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "s")
	if err != nil {
		return nil, err
	}
	joinScope := ""
	if len(scopeWhere) > 0 {
		joinScope = " AND " + strings.Join(scopeWhere, " AND ")
	}
	stageWhere := []string{"s.is_enabled = 1"}
	stageWhere = append(stageWhere, pipelineWhere...)
	return altocQueryMaps(ctx, a.DB(), `
		SELECT
		  s.id,
		  s.name,
		  s.sort_no,
		  s.win_rate,
		  COUNT(o.id) AS opp_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity_stage s
		LEFT JOIN opportunity o
		  ON o.stage_id = s.id
		 AND o.deleted_at IS NULL
		 AND o.status = 'active'
		 `+joinScope+`
		WHERE `+strings.Join(stageWhere, " AND ")+`
		ORDER BY s.sort_no ASC
	`, append(scopeArgs, pipelineArgs...)...)
}

func (a *Adapter) dashboardForecast(ctx context.Context, query url.Values) (map[string]any, error) {
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "o", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	pipelineWhere, pipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "s")
	if err != nil {
		return nil, err
	}
	where := []string{"o.deleted_at IS NULL", "o.status = 'active'"}
	where = append(where, scopeWhere...)
	args := append([]any(nil), scopeArgs...)
	where = append(where, pipelineWhere...)
	args = append(args, pipelineArgs...)
	forecast, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  o.forecast_category,
		  COUNT(*) AS opp_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON o.stage_id = s.id
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY o.forecast_category
	`, args...)
	if err != nil {
		return nil, err
	}
	weighted, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT SUM(COALESCE(o.amount_tax_inclusive, 0) * COALESCE(s.win_rate, 0) / 100) AS weighted_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON o.stage_id = s.id
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	closedWhere := append(append([]string(nil), scopeWhere...), pipelineWhere...)
	closedArgs := append(append([]any(nil), scopeArgs...), pipelineArgs...)
	closed, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(CASE WHEN o.status = 'won' THEN 1 END) AS won,
		  COUNT(CASE WHEN o.status IN ('won', 'lost') THEN 1 END) AS closed
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON o.stage_id = s.id
		WHERE o.deleted_at IS NULL`+dashboardScopeAnd(closedWhere), closedArgs...)
	if err != nil {
		return nil, err
	}
	avgCycle, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT AVG(DATEDIFF(o.won_at, o.created_at)) AS avg_days
		FROM opportunity o
		LEFT JOIN opportunity_stage s ON o.stage_id = s.id
		WHERE o.deleted_at IS NULL
		  AND o.status = 'won'
		  AND o.won_at IS NOT NULL`+dashboardScopeAnd(closedWhere), closedArgs...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"forecast":        forecast,
		"weighted_amount": moneyValue(weighted["weighted_amount"]),
		"win_rate":        dashboardIntPercent(moneyValue(closed["won"]), moneyValue(closed["closed"])),
		"avg_cycle_days":  math.Round(moneyValue(avgCycle["avg_days"])),
	}, nil
}

func (a *Adapter) dashboardReceivables(ctx context.Context, query url.Values) (map[string]any, error) {
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return nil, err
	}

	monthPlanWhere := []string{
		"rp.deleted_at IS NULL",
		"YEAR(rp.planned_payment_date) = YEAR(NOW())",
		"MONTH(rp.planned_payment_date) = MONTH(NOW())",
	}
	monthPlanWhere = append(monthPlanWhere, scopeWhere...)
	monthPlan, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT SUM(COALESCE(rp.amount, 0)) AS plan_amount
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(monthPlanWhere, " AND "), scopeArgs...)
	if err != nil {
		return nil, err
	}
	monthReceived, err := a.dashboardFinanceMonthReceived(ctx, query)
	if err != nil {
		return nil, err
	}
	overdueWhere := []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date < CURDATE()",
		"rp.status NOT IN ('received', 'bad_debt')",
		"rp.unreceived_amount > 0",
	}
	overdueWhere = append(overdueWhere, scopeWhere...)
	overdueBreakdown, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  CASE
		    WHEN DATEDIFF(CURDATE(), rp.planned_payment_date) BETWEEN 1 AND 30 THEN '1-30天'
		    WHEN DATEDIFF(CURDATE(), rp.planned_payment_date) BETWEEN 31 AND 60 THEN '31-60天'
		    WHEN DATEDIFF(CURDATE(), rp.planned_payment_date) BETWEEN 61 AND 90 THEN '61-90天'
		    ELSE '90天以上'
		  END AS aging,
		  COUNT(*) AS count,
		  SUM(COALESCE(rp.unreceived_amount, 0)) AS amount
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(overdueWhere, " AND ")+`
		GROUP BY aging
		ORDER BY aging
	`, scopeArgs...)
	if err != nil {
		return nil, err
	}
	upcomingWhere := []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)",
		"rp.status NOT IN ('received', 'bad_debt')",
	}
	upcomingWhere = append(upcomingWhere, scopeWhere...)
	upcoming, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  rp.id,
		  rp.code,
		  rp.plan_name,
		  rp.amount,
		  rp.unreceived_amount,
		  rp.planned_payment_date,
		  rp.status,
		  c.name AS customer_name,
		  ct.name AS contract_name
		FROM receivable_plan rp
		LEFT JOIN customer c ON rp.customer_id = c.id
		LEFT JOIN contract ct ON rp.contract_id = ct.id
		WHERE `+strings.Join(upcomingWhere, " AND ")+`
		ORDER BY rp.planned_payment_date ASC
		LIMIT 20
	`, scopeArgs...)
	if err != nil {
		return nil, err
	}
	overdueListWhere := []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date < CURDATE()",
		"rp.status NOT IN ('received', 'bad_debt')",
		"rp.unreceived_amount > 0",
	}
	overdueListWhere = append(overdueListWhere, scopeWhere...)
	overdueList, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  rp.id,
		  rp.code,
		  rp.plan_name,
		  rp.amount,
		  rp.unreceived_amount,
		  rp.planned_payment_date,
		  rp.overdue_days,
		  c.name AS customer_name,
		  ct.name AS contract_name
		FROM receivable_plan rp
		LEFT JOIN customer c ON rp.customer_id = c.id
		LEFT JOIN contract ct ON rp.contract_id = ct.id
		WHERE `+strings.Join(overdueListWhere, " AND ")+`
		ORDER BY rp.planned_payment_date ASC
		LIMIT 20
	`, scopeArgs...)
	if err != nil {
		return nil, err
	}
	planAmount := moneyValue(monthPlan["plan_amount"])
	receivedAmount := monthReceived
	return map[string]any{
		"month_achievement": map[string]any{
			"plan":     planAmount,
			"received": receivedAmount,
			"rate":     dashboardIntPercent(receivedAmount, planAmount),
		},
		"overdue_breakdown": overdueBreakdown,
		"upcoming":          upcoming,
		"overdue_list":      overdueList,
	}, nil
}

func (a *Adapter) dashboardSummary(ctx context.Context, query url.Values) (map[string]any, error) {
	customerWhere := []string{"cu.deleted_at IS NULL"}
	customerArgs := make([]any, 0)
	customerScope, customerScopeArgs, err := altocReadScopeWhere(query, "customer", "cu", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	customerWhere = append(customerWhere, customerScope...)
	customerArgs = append(customerArgs, customerScopeArgs...)
	customerStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN cu.status = 'active' THEN 1 ELSE 0 END) AS active_count
		FROM customer cu
		WHERE `+strings.Join(customerWhere, " AND "), customerArgs...)
	if err != nil {
		return nil, err
	}

	leadWhere := []string{"l.deleted_at IS NULL"}
	leadArgs := make([]any, 0)
	leadScope, leadScopeArgs, err := altocReadScopeWhere(query, "lead", "l", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	leadWhere = append(leadWhere, leadScope...)
	leadArgs = append(leadArgs, leadScopeArgs...)
	leadStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN l.status = 'new' OR l.status = 'following' THEN 1 ELSE 0 END) AS active_count,
		  SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) AS converted_count
		FROM `+"`lead`"+` l
		WHERE `+strings.Join(leadWhere, " AND "), leadArgs...)
	if err != nil {
		return nil, err
	}

	oppWhere := []string{"o.deleted_at IS NULL"}
	oppArgs := make([]any, 0)
	oppScope, oppScopeArgs, err := altocReadScopeWhere(query, "opportunity", "o", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	oppWhere = append(oppWhere, oppScope...)
	oppArgs = append(oppArgs, oppScopeArgs...)
	oppPipeline, oppPipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "os")
	if err != nil {
		return nil, err
	}
	oppWhere = append(oppWhere, oppPipeline...)
	oppArgs = append(oppArgs, oppPipelineArgs...)
	oppStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN o.status = 'active' THEN 1 ELSE 0 END) AS active_count,
		  SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won_count,
		  SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END) AS lost_count,
		  SUM(CASE WHEN o.status = 'active' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS pipeline_amount,
		  SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS won_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE `+strings.Join(oppWhere, " AND "), oppArgs...)
	if err != nil {
		return nil, err
	}

	contractWhere := []string{
		"ct.deleted_at IS NULL",
		"ct.status NOT IN ('draft', 'rejected', 'terminated', 'invalid')",
	}
	contractArgs := make([]any, 0)
	contractScope, contractScopeArgs, err := altocReadScopeWhere(query, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	contractWhere = append(contractWhere, contractScope...)
	contractArgs = append(contractArgs, contractScopeArgs...)
	contractStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN ct.status IN ('effective', 'executing', 'delivering', 'accepted', 'service_ended', 'expired') THEN COALESCE(ct.amount_tax_inclusive, 0) ELSE 0 END) AS active_amount,
		  SUM(CASE WHEN YEAR(ct.sign_date) = YEAR(NOW()) AND MONTH(ct.sign_date) = MONTH(NOW()) THEN COALESCE(ct.amount_tax_inclusive, 0) ELSE 0 END) AS month_amount
		FROM contract ct
		WHERE `+strings.Join(contractWhere, " AND "), contractArgs...)
	if err != nil {
		return nil, err
	}

	receivableScope, receivableScopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return nil, err
	}
	receivableWhere := []string{"rp.deleted_at IS NULL"}
	receivableWhere = append(receivableWhere, receivableScope...)
	receivableStats, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  SUM(COALESCE(rp.amount, 0)) AS plan_total,
		  SUM(COALESCE(rp.received_amount, 0)) AS received_total,
		  SUM(CASE WHEN rp.status = 'overdue' THEN COALESCE(rp.unreceived_amount, 0) ELSE 0 END) AS overdue_amount,
		  SUM(CASE WHEN rp.planned_payment_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND rp.status NOT IN ('received', 'bad_debt') THEN COALESCE(rp.unreceived_amount, 0) ELSE 0 END) AS upcoming_30d_amount
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(receivableWhere, " AND "), receivableScopeArgs...)
	if err != nil {
		return nil, err
	}
	monthPayment, err := a.dashboardFinanceMonthReceived(ctx, query)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"customer": map[string]any{
			"total":  moneyValue(customerStats["total"]),
			"active": moneyValue(customerStats["active_count"]),
		},
		"lead": map[string]any{
			"total":     moneyValue(leadStats["total"]),
			"active":    moneyValue(leadStats["active_count"]),
			"converted": moneyValue(leadStats["converted_count"]),
		},
		"opportunity": map[string]any{
			"total":           moneyValue(oppStats["total"]),
			"active":          moneyValue(oppStats["active_count"]),
			"won":             moneyValue(oppStats["won_count"]),
			"lost":            moneyValue(oppStats["lost_count"]),
			"pipeline_amount": moneyValue(oppStats["pipeline_amount"]),
			"won_amount":      moneyValue(oppStats["won_amount"]),
		},
		"contract": map[string]any{
			"total":         moneyValue(contractStats["total"]),
			"active_amount": moneyValue(contractStats["active_amount"]),
			"month_amount":  moneyValue(contractStats["month_amount"]),
		},
		"receivable": map[string]any{
			"plan_total":     moneyValue(receivableStats["plan_total"]),
			"received_total": moneyValue(receivableStats["received_total"]),
			"overdue_amount": moneyValue(receivableStats["overdue_amount"]),
			"upcoming_30d":   moneyValue(receivableStats["upcoming_30d_amount"]),
			"month_received": monthPayment,
		},
	}, nil
}

func (a *Adapter) dashboardFinanceMonthReceived(ctx context.Context, query url.Values) (float64, error) {
	scopeWhere, scopeArgs, err := altocReceivablePlanReadScopeWhere(query, nil, "rp", "ct")
	if err != nil {
		return 0, err
	}
	where := []string{"rp.deleted_at IS NULL", "ct.code IS NOT NULL", "ct.code <> ''"}
	where = append(where, scopeWhere...)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT DISTINCT ct.code AS contract_code
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		WHERE `+strings.Join(where, " AND ")+`
	`, scopeArgs...)
	if err != nil {
		return 0, err
	}
	contractRows, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return 0, err
	}

	codes := make([]string, 0, len(contractRows))
	for _, row := range contractRows {
		code := strings.TrimSpace(fmt.Sprint(row["contract_code"]))
		if code != "" && code != "<nil>" {
			codes = append(codes, code)
		}
	}
	if len(codes) == 0 {
		return 0, nil
	}

	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return 0, err
	}
	dateFrom, dateTo := dashboardCurrentMonthDateRange()
	total := 0.0
	for _, code := range codes {
		page := 1
		for {
			receiptQuery := url.Values{}
			receiptQuery.Set("contract_code", code)
			receiptQuery.Set("dateFrom", dateFrom)
			receiptQuery.Set("dateTo", dateTo)
			receiptQuery.Set("page", strconv.Itoa(page))
			receiptQuery.Set("pageSize", "100")
			receipts, err := financeSvc.Receipts(ctx, receiptQuery)
			if err != nil {
				return 0, err
			}
			for _, item := range receipts.Data {
				total += moneyValue(item["received_amount"])
			}
			if int64(page)*receipts.PageSize >= receipts.Total || len(receipts.Data) == 0 {
				break
			}
			page++
		}
	}
	return total, nil
}

func dashboardCurrentMonthDateRange() (string, string) {
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	end := start.AddDate(0, 1, -1)
	return start.Format("2006-01-02"), end.Format("2006-01-02")
}

func (a *Adapter) dashboardSalesInsights(ctx context.Context, query url.Values) (map[string]any, error) {
	leadScope, leadScopeArgs, err := altocReadScopeWhere(query, "lead", "l", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	leadWhere := []string{"l.deleted_at IS NULL"}
	leadWhere = append(leadWhere, leadScope...)
	sourcePipelineWhere, sourcePipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "los")
	if err != nil {
		return nil, err
	}
	convertedCondition := "l.status = 'converted'"
	sourceArgs := append([]any(nil), leadScopeArgs...)
	if len(sourcePipelineWhere) > 0 {
		convertedCondition += " AND lo.id IS NOT NULL AND " + strings.Join(sourcePipelineWhere, " AND ")
		sourceArgs = append(append([]any(nil), sourcePipelineArgs...), leadScopeArgs...)
	}
	sourceConversion, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  source_type,
		  COUNT(*) AS lead_count,
		  SUM(converted_in_pipeline) AS converted_count,
		  ROUND(SUM(converted_in_pipeline) / NULLIF(COUNT(*), 0) * 100, 1) AS conversion_rate
		FROM (
		  SELECT
		    COALESCE(NULLIF(l.source_type, ''), 'unknown') AS source_type,
		    CASE WHEN `+convertedCondition+` THEN 1 ELSE 0 END AS converted_in_pipeline
		  FROM `+"`lead`"+` l
		  LEFT JOIN opportunity lo ON lo.id = l.converted_opportunity_id AND lo.deleted_at IS NULL
		  LEFT JOIN opportunity_stage los ON los.id = lo.stage_id
		  WHERE `+strings.Join(leadWhere, " AND ")+`
		) source_rows
		GROUP BY source_type
		ORDER BY lead_count DESC, converted_count DESC
		LIMIT 10
	`, sourceArgs...)
	if err != nil {
		return nil, err
	}

	oppScope, oppScopeArgs, err := altocReadScopeWhere(query, "opportunity", "o", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	oppPipeline, oppPipelineArgs, _, _, err := opportunityStagePipelineWhere(ctx, a.DB(), query, "os")
	if err != nil {
		return nil, err
	}
	oppWhere := []string{"o.deleted_at IS NULL"}
	oppWhere = append(oppWhere, oppScope...)
	oppWhere = append(oppWhere, oppPipeline...)
	oppScopedWhere := append([]string(nil), oppScope...)
	oppScopedWhere = append(oppScopedWhere, oppPipeline...)
	oppArgs := append([]any(nil), oppScopeArgs...)
	oppArgs = append(oppArgs, oppPipelineArgs...)
	oppScopeSQL := dashboardScopeAnd(oppScopedWhere)

	stageAging, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  os.id,
		  os.name,
		  os.sort_no,
		  COUNT(o.id) AS opp_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount,
		  ROUND(AVG(DATEDIFF(CURDATE(), COALESCE((
		    SELECT MAX(sl.changed_at)
		    FROM opportunity_stage_log sl
		    WHERE sl.opportunity_id = o.id
		      AND sl.to_stage_id = o.stage_id
		  ), o.last_status_changed_at, o.created_at))), 1) AS avg_days_in_stage
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status = 'active'`+oppScopeSQL+`
		GROUP BY os.id, os.name, os.sort_no
		ORDER BY os.sort_no ASC, os.id ASC
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	signDateSlippage, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS overdue_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS overdue_amount,
		  ROUND(AVG(DATEDIFF(CURDATE(), o.expected_sign_date)), 1) AS avg_overdue_days
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status = 'active'
		  AND o.expected_sign_date IS NOT NULL
		  AND o.expected_sign_date < CURDATE()`+oppScopeSQL, oppArgs...)
	if err != nil {
		return nil, err
	}

	actionRisks, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total_open_count,
		  SUM(CASE WHEN COALESCE(NULLIF(o.next_action, ''), '') = '' OR o.next_action_due_at IS NULL THEN 1 ELSE 0 END) AS no_next_action_count,
		  SUM(CASE WHEN o.next_action_due_at IS NOT NULL AND DATE(o.next_action_due_at) < CURDATE() THEN 1 ELSE 0 END) AS next_action_overdue_count,
		  SUM(CASE WHEN o.last_follow_up_at IS NOT NULL AND o.last_follow_up_at < DATE_SUB(NOW(), INTERVAL 14 DAY) THEN 1 ELSE 0 END) AS follow_up_stale_count,
		  SUM(CASE WHEN o.last_follow_up_at IS NULL AND o.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS never_followed_count
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status IN ('active', 'paused')`+oppScopeSQL, oppArgs...)
	if err != nil {
		return nil, err
	}

	leadActionWhere := []string{
		"l.deleted_at IS NULL",
		"l.status NOT IN ('converted', 'closed_invalid')",
	}
	leadActionWhere = append(leadActionWhere, leadScope...)
	leadActionRisks, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS total_open_count,
		  SUM(CASE WHEN COALESCE(NULLIF(l.next_action, ''), '') = '' OR l.next_action_due_at IS NULL THEN 1 ELSE 0 END) AS no_next_action_count,
		  SUM(CASE WHEN l.next_action_due_at IS NOT NULL AND DATE(l.next_action_due_at) < CURDATE() THEN 1 ELSE 0 END) AS next_action_overdue_count,
		  SUM(CASE WHEN l.last_follow_up_at IS NOT NULL AND l.last_follow_up_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS follow_up_stale_count,
		  SUM(CASE WHEN l.last_follow_up_at IS NULL AND l.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY) THEN 1 ELSE 0 END) AS never_followed_count
		FROM `+"`lead`"+` l
		WHERE `+strings.Join(leadActionWhere, " AND "), leadScopeArgs...)
	if err != nil {
		return nil, err
	}

	salesCycleDayExpr := "GREATEST(DATEDIFF(COALESCE(o.won_at, o.lost_at, o.last_status_changed_at), o.created_at), 0)"
	salesCycleSummary, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  COUNT(*) AS closed_count,
		  ROUND(AVG(`+salesCycleDayExpr+`), 1) AS avg_days,
		  ROUND(AVG(CASE WHEN o.status = 'won' THEN `+salesCycleDayExpr+` END), 1) AS won_avg_days,
		  ROUND(AVG(CASE WHEN o.status = 'lost' THEN `+salesCycleDayExpr+` END), 1) AS lost_avg_days
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status IN ('won', 'lost')
		  AND COALESCE(o.won_at, o.lost_at, o.last_status_changed_at) IS NOT NULL`+oppScopeSQL, oppArgs...)
	if err != nil {
		return nil, err
	}

	salesCycleBySource, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  COALESCE(NULLIF(o.source_type, ''), 'unknown') AS source_type,
		  COUNT(*) AS closed_count,
		  SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won_count,
		  ROUND(SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate,
		  ROUND(AVG(`+salesCycleDayExpr+`), 1) AS avg_days
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status IN ('won', 'lost')
		  AND COALESCE(o.won_at, o.lost_at, o.last_status_changed_at) IS NOT NULL`+oppScopeSQL+`
		GROUP BY COALESCE(NULLIF(o.source_type, ''), 'unknown')
		ORDER BY closed_count DESC, avg_days ASC
		LIMIT 10
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	winLossBySource, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  COALESCE(NULLIF(o.source_type, ''), 'unknown') AS source_type,
		  COUNT(*) AS closed_count,
		  SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won_count,
		  SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END) AS lost_count,
		  ROUND(SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate,
		  SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS won_amount,
		  SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS lost_amount,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status IN ('won', 'lost')`+oppScopeSQL+`
		GROUP BY COALESCE(NULLIF(o.source_type, ''), 'unknown')
		ORDER BY closed_count DESC, won_count DESC, lost_count DESC
		LIMIT 10
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	forecastAccuracy, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  COALESCE(NULLIF(o.forecast_category, ''), 'pipeline') AS forecast_category,
		  COUNT(*) AS closed_count,
		  SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won_count,
		  ROUND(SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS actual_win_rate,
		  SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.amount_tax_inclusive, 0) ELSE 0 END) AS won_amount,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE o.deleted_at IS NULL
		  AND o.status IN ('won', 'lost')`+oppScopeSQL+`
		GROUP BY COALESCE(NULLIF(o.forecast_category, ''), 'pipeline')
		ORDER BY FIELD(COALESCE(NULLIF(o.forecast_category, ''), 'pipeline'), 'commit', 'best_case', 'pipeline'), closed_count DESC
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	lostReasons, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  COALESCE(NULLIF(o.lost_reason_code, ''), 'uncategorized') AS reason_code,
		  COUNT(*) AS opp_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE `+strings.Join(oppWhere, " AND ")+`
		  AND o.status = 'lost'
		GROUP BY COALESCE(NULLIF(o.lost_reason_code, ''), 'uncategorized')
		ORDER BY opp_count DESC, total_amount DESC
		LIMIT 10
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	wonReasons, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  COALESCE(NULLIF(o.won_reason_code, ''), 'uncategorized') AS reason_code,
		  COUNT(*) AS opp_count,
		  SUM(COALESCE(o.amount_tax_inclusive, 0)) AS total_amount
		FROM opportunity o
		LEFT JOIN opportunity_stage os ON os.id = o.stage_id
		WHERE `+strings.Join(oppWhere, " AND ")+`
		  AND o.status = 'won'
		GROUP BY COALESCE(NULLIF(o.won_reason_code, ''), 'uncategorized')
		ORDER BY opp_count DESC, total_amount DESC
		LIMIT 10
	`, oppArgs...)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"source_conversion": sourceConversion,
		"stage_aging":       stageAging,
		"sign_date_slippage": map[string]any{
			"overdue_count":    moneyValue(signDateSlippage["overdue_count"]),
			"overdue_amount":   moneyValue(signDateSlippage["overdue_amount"]),
			"avg_overdue_days": dashboardNullableRounded(signDateSlippage["avg_overdue_days"]),
		},
		"action_risks": map[string]any{
			"total_open_count":          moneyValue(actionRisks["total_open_count"]),
			"no_next_action_count":      moneyValue(actionRisks["no_next_action_count"]),
			"next_action_overdue_count": moneyValue(actionRisks["next_action_overdue_count"]),
			"follow_up_stale_count":     moneyValue(actionRisks["follow_up_stale_count"]),
			"never_followed_count":      moneyValue(actionRisks["never_followed_count"]),
		},
		"lead_action_risks": map[string]any{
			"total_open_count":          moneyValue(leadActionRisks["total_open_count"]),
			"no_next_action_count":      moneyValue(leadActionRisks["no_next_action_count"]),
			"next_action_overdue_count": moneyValue(leadActionRisks["next_action_overdue_count"]),
			"follow_up_stale_count":     moneyValue(leadActionRisks["follow_up_stale_count"]),
			"never_followed_count":      moneyValue(leadActionRisks["never_followed_count"]),
		},
		"sales_cycle": map[string]any{
			"summary": map[string]any{
				"closed_count":  moneyValue(salesCycleSummary["closed_count"]),
				"avg_days":      dashboardNullableRounded(salesCycleSummary["avg_days"]),
				"won_avg_days":  dashboardNullableRounded(salesCycleSummary["won_avg_days"]),
				"lost_avg_days": dashboardNullableRounded(salesCycleSummary["lost_avg_days"]),
			},
			"by_source": salesCycleBySource,
		},
		"win_loss_by_source": winLossBySource,
		"forecast_accuracy":  forecastAccuracy,
		"won_reasons":        wonReasons,
		"lost_reasons":       lostReasons,
	}, nil
}

func dashboardPeriod(query url.Values) string {
	switch strings.TrimSpace(query.Get("period")) {
	case "month", "quarter", "year":
		return query.Get("period")
	default:
		return "year"
	}
}

func dashboardPeriodClause(field string, period string) string {
	switch period {
	case "month":
		return "YEAR(" + field + ") = YEAR(NOW()) AND MONTH(" + field + ") = MONTH(NOW())"
	case "quarter":
		return "YEAR(" + field + ") = YEAR(NOW()) AND QUARTER(" + field + ") = QUARTER(NOW())"
	default:
		return "YEAR(" + field + ") = YEAR(NOW())"
	}
}

func dashboardScopeAnd(scopeWhere []string) string {
	if len(scopeWhere) == 0 {
		return ""
	}
	return " AND " + strings.Join(scopeWhere, " AND ")
}

func dashboardPercent(numerator float64, denominator float64) any {
	if denominator <= 0 {
		return nil
	}
	return math.Round((numerator/denominator)*1000) / 10
}

func dashboardIntPercent(numerator float64, denominator float64) int {
	if denominator <= 0 {
		return 0
	}
	return int(math.Round((numerator / denominator) * 100))
}

func dashboardNullableRounded(value any) any {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		return nil
	}
	return math.Round(moneyValue(value))
}

func dashboardHealthGrade(value any, good float64, warn float64, reverse bool) any {
	if value == nil {
		return nil
	}
	current := moneyValue(value)
	if reverse {
		if current <= good {
			return "good"
		}
		if current <= warn {
			return "warning"
		}
		return "bad"
	}
	if current >= good {
		return "good"
	}
	if current >= warn {
		return "warning"
	}
	return "bad"
}

func dashboardOverdueHealth(value float64) string {
	switch {
	case value <= 0:
		return "good"
	case value > 1000000:
		return "bad"
	default:
		return "warning"
	}
}

func dashboardPaymentSub(received float64, planned float64) string {
	if planned <= 0 {
		return "暂无计划"
	}
	return dashboardWanText(received) + " / " + dashboardWanText(planned)
}

func dashboardWanText(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.1f", value/10000), "0"), ".") + "w"
}

func dashboardCountText(value float64) string {
	return strconv.FormatInt(int64(math.Round(value)), 10)
}
