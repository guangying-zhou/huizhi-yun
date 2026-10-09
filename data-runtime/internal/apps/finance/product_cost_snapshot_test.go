package finance

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductCostSnapshotMissingEvidenceAndReadFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectBegin()
		mock.ExpectQuery(`(?s)SELECT r.revision.*JOIN product_cost_attribution_revision`).WithArgs("PRJ-1", "2026-09").WillReturnError(sql.ErrNoRows)
		mock.ExpectQuery(`(?s)SELECT cost_readiness_status.*BINARY project_code = BINARY \?`).WithArgs("PRJ-1", "2026-09").WillReturnError(sql.ErrNoRows)
		query := mock.ExpectQuery(`(?s)SELECT code.*BINARY project_code = BINARY \?.*AND status = 'active' ORDER BY BINARY code`).WithArgs("PRJ-1", "2026-09")
		if fail {
			query.WillReturnError(errors.New("database unavailable"))
			mock.ExpectRollback()
		} else {
			query.WillReturnRows(sqlmock.NewRows([]string{"code", "project_code", "period_month", "employee_uid", "allocation_type", "source_table", "rule_code", "status", "amount", "source_refs_json", "currency_code"}))
			mock.ExpectQuery(`(?s)SELECT code, project_code, expense_amount.*FROM finance_expense`).WithArgs("PRJ-1", "2026-09-01", "2026-10-01").WillReturnRows(sqlmock.NewRows([]string{"code", "project_code", "expense_amount", "currency_code", "status"}))
			mock.ExpectCommit()
		}
		got, err := readProductCostSnapshot(context.Background(), db, "PRJ-1", "2026-09")
		if (err != nil) != fail {
			t.Fatalf("error=%v fail=%v", err, fail)
		}
		if !fail && (got.Rules != nil || got.SummaryExists || got.ReadinessStatus != "" || got.LaborCostAmount != "") {
			t.Fatalf("invented readiness: %+v", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestProductCostSnapshotReadsSourceEvidence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT r.revision.*JOIN product_cost_attribution_revision`).WithArgs("PRJ-1", "2026-09").
		WillReturnRows(sqlmock.NewRows([]string{"revision", "evidence_ref", "shares_json", "total_basis_points"}).AddRow(2, "APPROVAL-2", `[{"ProductCode":"PRODUCT-1","BasisPoints":10000}]`, 10000))
	checked := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)SELECT cost_readiness_status.*BINARY project_code`).WithArgs("PRJ-1", "2026-09").
		WillReturnRows(sqlmock.NewRows([]string{"status", "hash", "checked", "direct", "labor", "allocated"}).AddRow("ready", "source-hash", checked, "0.00", "100.00", "0.00"))
	fact := productLaborCurrencyFact()
	mock.ExpectQuery(`(?s)SELECT code.*AND status = 'active'`).WithArgs("PRJ-1", "2026-09").
		WillReturnRows(sqlmock.NewRows([]string{"code", "project_code", "period_month", "employee_uid", "allocation_type", "source_table", "rule_code", "status", "amount", "source_refs_json", "currency_code"}).
			AddRow(fact.Code, fact.ProjectCode, fact.PeriodMonth, fact.EmployeeUID, fact.AllocationType, fact.SourceTable, fact.RuleCode, fact.Status, fact.Amount, []byte(fact.SourceRefs), ""))
	mock.ExpectQuery(`(?s)SELECT code, project_code, expense_amount.*FROM finance_expense`).WithArgs("PRJ-1", "2026-09-01", "2026-10-01").WillReturnRows(sqlmock.NewRows([]string{"code", "project_code", "expense_amount", "currency_code", "status"}))
	mock.ExpectCommit()
	got, err := readProductCostSnapshot(context.Background(), db, "PRJ-1", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if !got.SummaryExists || got.Rules.Revision != 2 || got.CheckedAt != "2026-09-09T12:00:00Z" || len(got.Allocations) != 1 {
		t.Fatalf("bad snapshot: %+v", got)
	}
	if currency, reason := productCostAllocationCurrency(got.Allocations[0]); currency != "CNY" || reason != "" {
		t.Fatalf("lost source evidence: %s %s", currency, reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
