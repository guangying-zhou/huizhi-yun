package altoc

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestValidateContractLineCostAllocationsRequiresRatioTotal(t *testing.T) {
	r60 := float64(60)
	r30 := float64(30)
	err := validateContractLineCostAllocations([]contractLineCostAllocationInput{
		{ProjectCode: "PRJ-1", AllocationType: "ratio", AllocationRatio: &r60},
		{ProjectCode: "PRJ-2", AllocationType: "ratio", AllocationRatio: &r30},
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_cost_allocation_ratio_total" {
		t.Fatalf("error = %#v, want invalid_cost_allocation_ratio_total", err)
	}

	r40 := float64(40)
	if err := validateContractLineCostAllocations([]contractLineCostAllocationInput{
		{ProjectCode: "PRJ-1", AllocationType: "ratio", AllocationRatio: &r60},
		{ProjectCode: "PRJ-2", AllocationType: "ratio", AllocationRatio: &r40},
	}); err != nil {
		t.Fatalf("valid ratio allocations rejected: %v", err)
	}
}

func TestAllocatedContractLineCostSupportsRatioAmountAndWorkdays(t *testing.T) {
	total, details := allocatedContractLineCost(
		[]map[string]any{
			{"project_code": "PRJ-RATIO", "allocation_type": "ratio", "allocation_ratio": float64(60)},
			{"project_code": "PRJ-AMOUNT", "allocation_type": "amount", "allocated_amount": float64(150)},
			{"project_code": "PRJ-WORK", "allocation_type": "workdays", "allocated_workdays": float64(2)},
		},
		map[string]float64{
			"PRJ-RATIO": 1000,
			"PRJ-WORK":  900,
		},
		map[string]float64{"PRJ-WORK": 3},
	)
	if total != 1350 {
		t.Fatalf("total = %.2f, want 1350", total)
	}
	if len(details) != 3 {
		t.Fatalf("details = %#v, want 3 allocations", details)
	}
}

func TestProjectCostsCanAllocateAcrossMultipleContractLines(t *testing.T) {
	allocations := map[string][]map[string]any{
		"CL-1": {
			{"project_code": "PRJ-SHARED", "allocation_type": "ratio", "allocation_ratio": float64(60)},
			{"project_code": "PRJ-FIXED", "allocation_type": "amount", "allocated_amount": float64(100)},
		},
		"CL-2": {
			{"project_code": "PRJ-SHARED", "allocation_type": "ratio", "allocation_ratio": float64(40)},
			{"project_code": "PRJ-WORK", "allocation_type": "workdays", "allocated_workdays": float64(2)},
		},
	}
	projectCosts := map[string]float64{
		"PRJ-SHARED": 1000,
		"PRJ-FIXED":  0,
		"PRJ-WORK":   300,
	}
	workdayTotals := projectWorkdayTotals(allocations)

	line1Cost, _ := allocatedContractLineCost(allocations["CL-1"], projectCosts, workdayTotals)
	line2Cost, _ := allocatedContractLineCost(allocations["CL-2"], projectCosts, workdayTotals)

	if line1Cost != 700 || line2Cost != 700 {
		t.Fatalf("line costs = %.2f/%.2f, want 700/700", line1Cost, line2Cost)
	}
}

func TestEnsureProjectCostsAllocatedRejectsUnallocatedCosts(t *testing.T) {
	err := ensureProjectCostsAllocated(
		map[string]float64{"PRJ-1": 100, "PRJ-MISSING": 50},
		map[string][]map[string]any{
			"CL-1": {{"project_code": "PRJ-1"}},
		},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "unallocated_project_cost" {
		t.Fatalf("error = %#v, want unallocated_project_cost", err)
	}
}

func TestParseAltocFloatRejectsNaNAndInf(t *testing.T) {
	if _, err := parseAltocFloat(math.NaN()); err == nil {
		t.Fatal("expected NaN to be rejected")
	}
	if _, err := parseAltocFloat(math.Inf(1)); err == nil {
		t.Fatal("expected Inf to be rejected")
	}
}

func TestContractLineRevenueUsesPaidAmountWhenPresent(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT COALESCE\(SUM\(.*WHEN paid_amount IS NOT NULL AND paid_amount > 0 THEN paid_amount.*ELSE amount.*\), 0\) AS revenue\s+FROM contract_billing_schedule`).
		WithArgs(int64(10), "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"revenue"}).AddRow(float64(700)))

	revenue, err := contractLineRevenue(context.Background(), adapter.DB(), int64(10), "2026-06-01", "2026-06-30")
	if err != nil {
		t.Fatalf("contractLineRevenue: %v", err)
	}
	if revenue != 700 {
		t.Fatalf("revenue = %.2f, want 700", revenue)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRecalculateContractProfitSummaryWritesLineProfitSummary(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT c\.\*, cu\.code AS customer_code\s+FROM contract c`).
		WithArgs("CON-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "customer_code"}).
			AddRow(int64(10), "CON-1", "CUS-1"))
	mock.ExpectQuery(`(?s)SELECT cl\.\*, c\.code AS contract_code, cu\.code AS customer_code\s+FROM contract_line cl`).
		WithArgs("CON-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "contract_id", "contract_code", "customer_code", "sort_no"}).
			AddRow(int64(20), "CL-1", int64(10), "CON-1", "CUS-1", int64(1)))
	mock.ExpectQuery(`(?s)SELECT a\.\*\s+FROM contract_line_cost_allocation a\s+INNER JOIN contract_line cl`).
		WithArgs(int64(10), "2026-06-30", "2026-06-01").
		WillReturnRows(sqlmock.NewRows([]string{"id", "contract_line_code", "project_code", "allocation_type", "allocation_ratio", "allocated_amount", "allocated_workdays"}).
			AddRow(int64(30), "CL-1", "PRJ-1", "ratio", float64(60), nil, nil))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(SUM\(.*WHEN paid_amount IS NOT NULL AND paid_amount > 0 THEN paid_amount.*ELSE amount.*\), 0\) AS revenue\s+FROM contract_billing_schedule`).
		WithArgs(int64(20), "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"revenue"}).AddRow(float64(1200)))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM contract_line_profit_summary\s+WHERE contract_line_code = \?`).
		WithArgs("CL-1", "2026-06-01", "2026-06-30", "profit-calc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`(?s)UPDATE contract_line_profit_summary\s+SET is_current = 0`).
		WithArgs("tester", "CL-1", "2026-06-01", "2026-06-30").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(MAX\(version\), 0\) \+ 1\s+FROM contract_line_profit_summary`).
		WithArgs("CL-1", "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(int64(1)))
	mock.ExpectExec(`(?s)INSERT INTO contract_line_profit_summary`).
		WithArgs("CL-1", "CON-1", "CUS-1", "2026-06-01", "2026-06-30", float64(1200), float64(600), float64(600), float64(0.5), 1, "profit-calc-1", nil, int64(1), sqlmock.AnyArg(), "tester", "tester").
		WillReturnResult(sqlmock.NewResult(66, 1))
	mock.ExpectQuery(`SELECT \* FROM contract_line_profit_summary WHERE id = \? LIMIT 1`).
		WithArgs(int64(66)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "contract_line_code", "total_revenue", "total_cost", "gross_profit", "gross_margin", "calculation_key"}).
			AddRow(int64(66), "CL-1", float64(1200), float64(600), float64(600), float64(0.5), "profit-calc-1"))
	mock.ExpectCommit()

	result, err := adapter.recalculateContractProfitSummary(context.Background(), "CON-1", map[string]any{
		"periodStart":    "2026-06-01",
		"periodEnd":      "2026-06-30",
		"calculationKey": "profit-calc-1",
		"projectCosts": map[string]any{
			"PRJ-1": float64(1000),
		},
		"operator_uid": "tester",
	})
	if err != nil {
		t.Fatalf("recalculateContractProfitSummary: %v", err)
	}
	if result["idempotent"] != false || result["total"] != 1 {
		t.Fatalf("result = %#v, want one non-idempotent summary", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRecalculateServiceCostSummaryCountsTicketsAndWritesSummary(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT\s+sa\.\*,.*FROM service_agreement sa\s+INNER JOIN contract ct`).
		WithArgs("SA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "contract_id", "contract_code", "customer_code"}).
			AddRow(int64(20), "SA-1", int64(10), "CON-1", "CUS-1"))
	mock.ExpectQuery(`(?s)SELECT\s+COUNT\(\*\) AS ticket_count,.*FROM service_ticket`).
		WithArgs(int64(20), "SA-1", "PRJ-OPS", "PRJ-OPS", "PRJ-OPS", "ENV-1", "ENV-1", "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"ticket_count", "sla_ticket_count"}).AddRow(int64(2), int64(1)))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM service_cost_summary\s+WHERE service_agreement_code = \?`).
		WithArgs("SA-1", "PRJ-OPS", "2026-06-01", "2026-06-30", "svc-calc-1", "ENV-1", "ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`(?s)UPDATE service_cost_summary\s+SET is_current = 0`).
		WithArgs("tester", "SA-1", "PRJ-OPS", "2026-06-01", "2026-06-30", "ENV-1", "ENV-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(MAX\(version\), 0\) \+ 1\s+FROM service_cost_summary`).
		WithArgs("SA-1", "PRJ-OPS", "2026-06-01", "2026-06-30", "ENV-1", "ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(int64(1)))
	mock.ExpectExec(`(?s)INSERT INTO service_cost_summary`).
		WithArgs("SA-1", "PRJ-OPS", "ENV-1", "2026-06-01", "2026-06-30", int64(2), int64(1), float64(12.5), float64(1500), "svc-calc-1", int64(1), sqlmock.AnyArg(), "tester", "tester").
		WillReturnResult(sqlmock.NewResult(55, 1))
	mock.ExpectQuery(`SELECT \* FROM service_cost_summary WHERE id = \? LIMIT 1`).
		WithArgs(int64(55)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "service_agreement_code", "project_code", "environment_code", "ticket_count", "sla_ticket_count", "total_hours", "total_cost", "calculation_key"}).
			AddRow(int64(55), "SA-1", "PRJ-OPS", "ENV-1", int64(2), int64(1), float64(12.5), float64(1500), "svc-calc-1"))
	mock.ExpectCommit()

	result, err := adapter.recalculateServiceCostSummary(context.Background(), "SA-1", map[string]any{
		"periodStart":    "2026-06-01",
		"periodEnd":      "2026-06-30",
		"calculationKey": "svc-calc-1",
		"serviceCosts": []any{
			map[string]any{
				"projectCode":     "PRJ-OPS",
				"environmentCode": "ENV-1",
				"totalHours":      float64(12.5),
				"totalCost":       float64(1500),
			},
		},
		"operator_uid": "tester",
	})
	if err != nil {
		t.Fatalf("recalculateServiceCostSummary: %v", err)
	}
	if result["idempotent"] != false || result["total"] != 1 {
		t.Fatalf("result = %#v, want one non-idempotent summary", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestContractAnalyticsIncludesServiceCostInTotalCost(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT c\.\*, cu\.code AS customer_code\s+FROM contract c`).
		WithArgs("CON-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "customer_code"}).
			AddRow(int64(10), "CON-1", "CUS-1"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM contract_line_profit_summary\s+WHERE contract_code = \?`).
		WithArgs("CON-1").
		WillReturnRows(sqlmock.NewRows([]string{"contract_line_code", "total_revenue", "total_cost", "gross_profit", "deleted_at", "is_current"}).
			AddRow("CL-1", float64(1000), float64(600), float64(400), nil, int64(1)))
	mock.ExpectQuery(`(?s)SELECT scs\.\*, sa\.contract_id, sa\.contract_line_id, ct\.code AS contract_code, sa\.customer_code\s+FROM service_cost_summary scs`).
		WithArgs("CON-1").
		WillReturnRows(sqlmock.NewRows([]string{"service_agreement_code", "project_code", "total_cost", "is_current"}).
			AddRow("SA-1", "PRJ-OPS", float64(150), int64(1)))

	result, err := adapter.contractAnalytics(context.Background(), "CON-1", url.Values{})
	if err != nil {
		t.Fatalf("contractAnalytics: %v", err)
	}
	if result["cost"] != float64(750) || result["profit"] != float64(250) || result["serviceCost"] != float64(150) {
		t.Fatalf("result = %#v, want cost 750, profit 250, serviceCost 150", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
