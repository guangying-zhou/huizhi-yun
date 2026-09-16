package finance

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func newFinanceSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return &Adapter{db: db}, mock, func() { _ = db.Close() }
}

func readyProjectLaborBody() jsonBody {
	return jsonBody{
		"projectCode":       "PRJ-1",
		"periodMonth":       "2026-07",
		"expectedInputHash": nil,
		"readinessStatus":   "ready",
		"missingInputs":     []any{},
		"calculationRule":   managedLaborRuleCode,
		"calculatedBy":      "tester",
		"laborItems": []any{map[string]any{
			"employeeUid":         "u-1",
			"employeeName":        "Alice",
			"deptCode":            "D1",
			"positionCode":        "DEV",
			"rankCode":            "P6",
			"standardCostAmount":  "14360.00",
			"projectHours":        "80.0000",
			"standardWorkHours":   "160.0000",
			"allocationRatio":     "0.5000",
			"allocatedCostAmount": "7180.00",
			"employeeSourceRefs":  map[string]any{"rate": "RATE-P6"},
			"allocationSourceRefs": map[string]any{
				"projectHours": 80,
			},
		}},
	}
}

func expectSummaryEnsureAndLock(mock sqlmock.Sqlmock, currentHash any) {
	mock.ExpectExec(`(?s)INSERT INTO project_finance_summary.*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT cost_input_hash.*FROM project_finance_summary.*FOR UPDATE`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnRows(sqlmock.NewRows([]string{"cost_input_hash"}).AddRow(currentHash))
}

func expectFinanceAggregate(mock sqlmock.Sqlmock, laborCost string) {
	args := make([]driver.Value, 0, 24)
	for index := 0; index < 12; index++ {
		args = append(args, "PRJ-1", "2026-07")
	}
	mock.ExpectQuery(`(?s)SELECT.*FROM project_finance_summary summary.*FOR UPDATE`).
		WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{
			"customer_code", "contract_code", "contract_amount", "invoice_amount",
			"received_amount", "direct_expense_amount", "labor_cost_amount", "allocated_cost_amount",
		}).AddRow("CUST-1", "CON-1", "0.00", "0.00", "10000.00", "1000.00", laborCost, "500.00"))
}

func expectFinalSummaryRead(mock sqlmock.Sqlmock, status string, gross any) {
	mock.ExpectQuery(`(?s)SELECT project_code, period_month.*FROM project_finance_summary.*WHERE project_code = \? AND period_month = \?`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnRows(sqlmock.NewRows([]string{
			"project_code", "period_month", "invoice_amount", "received_amount", "direct_expense_amount",
			"labor_cost_amount", "allocated_cost_amount", "gross_profit_amount", "gross_margin_rate",
			"cost_readiness_status", "cost_readiness_reasons_json", "cost_input_hash", "cost_readiness_checked_at",
		}).AddRow("PRJ-1", "2026-07", "0.00", "10000.00", "1000.00", "7180.00", "500.00",
			gross, nil, status, "[]", "hash", "2026-07-31 18:00:00"))
}

func TestSyncProjectLaborCostsReadyCommitsOneAtomicSet(t *testing.T) {
	for _, evidence := range []string{"missing", "verified", "conflicting"} {
		t.Run(evidence, func(t *testing.T) {
			body := readyProjectLaborBody()
			var expectedCurrency driver.Value
			if evidence != "missing" {
				refs := strings.ReplaceAll(string(productLaborCurrencyFact().SourceRefs), "2026-09", "2026-07")
				refs = strings.ReplaceAll(refs, "U1", "u-1")
				if evidence == "conflicting" {
					refs = strings.Replace(refs, "CNY", "USD", 1)
				} else {
					expectedCurrency = "CNY"
				}
				body["laborItems"].([]any)[0].(map[string]any)["allocationSourceRefs"] = refs
			}
			adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
			defer closeDB()

			mock.ExpectBegin()
			expectSummaryEnsureAndLock(mock, nil)
			mock.ExpectExec(`(?s)INSERT INTO employee_cost_snapshot.*ON DUPLICATE KEY UPDATE`).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`(?s)INSERT INTO project_cost_allocation.*source_refs_json, currency_code.*ON DUPLICATE KEY UPDATE.*currency_code = VALUES\(currency_code\)`).
				WithArgs(sqlmock.AnyArg(), "PRJ-1", "2026-07", managedLaborSourceTable, "u-1", "7180.00", "0.5000", managedLaborRuleCode, sqlmock.AnyArg(), expectedCurrency, "tester").
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`(?s)UPDATE project_cost_allocation.*source_table = \?.*code NOT IN \(\?\)`).
				WillReturnResult(sqlmock.NewResult(0, 0))
			expectFinanceAggregate(mock, "7180.00")
			mock.ExpectExec(`(?s)UPDATE project_finance_summary.*gross_profit_amount = \?.*cost_readiness_status = \?`).
				WillReturnResult(sqlmock.NewResult(0, 1))
			expectFinalSummaryRead(mock, "ready", "1320.00")
			mock.ExpectCommit()

			result, err := adapter.SyncProjectLaborCosts(context.Background(), body)
			if err != nil {
				t.Fatalf("SyncProjectLaborCosts: %v", err)
			}
			if result.Data["readinessStatus"] != "ready" || result.Data["laborAllocationsUpserted"] != 1 {
				t.Fatalf("unexpected result: %#v", result.Data)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSyncProjectLaborCostsNotReadyReversesManagedSetAndClearsGross(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	body := jsonBody{
		"projectCode":       "PRJ-1",
		"periodMonth":       "2026-07",
		"expectedInputHash": nil,
		"readinessStatus":   "not_ready",
		"missingInputs":     []any{map[string]any{"code": "missing_work_calendar"}},
		"laborItems":        []any{},
	}

	mock.ExpectBegin()
	expectSummaryEnsureAndLock(mock, nil)
	mock.ExpectExec(`(?s)UPDATE project_cost_allocation.*source_table = \?.*COALESCE\(status, 'active'\) = 'active'`).
		WillReturnResult(sqlmock.NewResult(0, 2))
	expectFinanceAggregate(mock, "0.00")
	mock.ExpectExec(`(?s)UPDATE project_finance_summary.*gross_profit_amount = \?.*gross_margin_rate = \?.*cost_readiness_status = \?`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			nil, nil, "not_ready", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			"PRJ-1", "2026-07",
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectFinalSummaryRead(mock, "not_ready", nil)
	mock.ExpectCommit()

	result, err := adapter.SyncProjectLaborCosts(context.Background(), body)
	if err != nil {
		t.Fatalf("SyncProjectLaborCosts: %v", err)
	}
	if result.Data["laborAllocationsReversed"] != int64(2) {
		t.Fatalf("expected two reversed allocations, got %#v", result.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncProjectLaborCostsConflictRollsBackBeforeManagedWrites(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectSummaryEnsureAndLock(mock, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	mock.ExpectRollback()

	_, err := adapter.SyncProjectLaborCosts(context.Background(), readyProjectLaborBody())
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusConflict || httpErr.Code != "project_labor_sync_conflict" {
		t.Fatalf("expected project labor conflict, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncProjectLaborCostsSummaryFailureRollsBackAllWrites(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectSummaryEnsureAndLock(mock, nil)
	mock.ExpectExec(`(?s)INSERT INTO employee_cost_snapshot.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO project_cost_allocation.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE project_cost_allocation.*code NOT IN`).
		WillReturnResult(sqlmock.NewResult(0, 0))
	expectFinanceAggregate(mock, "7180.00")
	mock.ExpectExec(`(?s)UPDATE project_finance_summary.*cost_readiness_status = \?`).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	_, err := adapter.SyncProjectLaborCosts(context.Background(), readyProjectLaborBody())
	if !errors.Is(err, sql.ErrConnDone) {
		t.Fatalf("expected summary failure, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectLaborInputHashAndAllocationCodeAreOrderStable(t *testing.T) {
	body := readyProjectLaborBody()
	second := map[string]any{
		"employeeUid":         "u-2",
		"standardCostAmount":  "100.00",
		"projectHours":        "8",
		"standardWorkHours":   "160",
		"allocationRatio":     "0.05",
		"allocatedCostAmount": "5",
	}
	body["laborItems"] = append(body["laborItems"].([]any), second)
	command, err := parseProjectLaborSyncCommand(body)
	if err != nil {
		t.Fatal(err)
	}
	firstHash, err := projectLaborInputHash(command)
	if err != nil {
		t.Fatal(err)
	}
	raw := body["laborItems"].([]any)
	body["laborItems"] = []any{raw[1], raw[0]}
	reordered, err := parseProjectLaborSyncCommand(body)
	if err != nil {
		t.Fatal(err)
	}
	secondHash, _ := projectLaborInputHash(reordered)
	if firstHash != secondHash {
		t.Fatalf("hash changed after item reorder: %s != %s", firstHash, secondHash)
	}
	code := managedLaborAllocationCode("PRJ-1", "2026-07", "u-1", managedLaborRuleCode)
	if len(code) != 49 || code != managedLaborAllocationCode("PRJ-1", "2026-07", "u-1", managedLaborRuleCode) {
		t.Fatalf("unexpected allocation code %q", code)
	}
}

func TestRecalculateProjectFinancePreservesNotReadyAndNeverRevivesGross(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT.*metric.project_code.*FROM \(.*project_cost_allocation.*\) metric`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnRows(sqlmock.NewRows([]string{
			"project_code", "period_month", "customer_code", "contract_code", "contract_amount",
			"invoice_amount", "received_amount", "direct_expense_amount", "labor_cost_amount", "allocated_cost_amount",
		}).AddRow("PRJ-1", "2026-07", "CUST-1", "CON-1", "0.00", "0.00", "10000.00", "1000.00", "7180.00", "500.00"))
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO project_finance_summary.*cost_readiness_status.*ON DUPLICATE KEY UPDATE`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT cost_readiness_status.*FOR UPDATE`).
		WithArgs("PRJ-1", "2026-07").
		WillReturnRows(sqlmock.NewRows([]string{"cost_readiness_status"}).AddRow("not_ready"))
	mock.ExpectExec(`(?s)INSERT INTO project_finance_summary.*gross_profit_amount.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			"PRJ-1", "CUST-1", "CON-1", "2026-07", "0.00", "0.00", "10000.00",
			"1000.00", "7180.00", "500.00", nil, nil, sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.RecalculateProjectFinance(context.Background(), jsonBody{
		"projectCode": "PRJ-1",
		"periodMonth": "2026-07",
	})
	if err != nil {
		t.Fatalf("RecalculateProjectFinance: %v", err)
	}
	if result.Data["recalculated"] != 1 {
		t.Fatalf("unexpected result: %#v", result.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
