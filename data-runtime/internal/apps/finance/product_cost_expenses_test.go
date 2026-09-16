package finance

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductDirectExpensesUsesFinancePeriodBasis(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT code, project_code, expense_amount.*BINARY project_code = BINARY \?.*expense_date >= \? AND expense_date < \?.*deleted_at IS NULL AND status <> 'canceled'`).
		WithArgs("PRJ-1", "2026-12-01", "2027-01-01").
		WillReturnRows(sqlmock.NewRows([]string{"code", "project_code", "expense_amount", "currency_code", "status"}).
			AddRow("E1", "PRJ-1", "123.45", "USD", "confirmed").AddRow("E2", "PRJ-1", "12.00", "", "draft"))
	mock.ExpectRollback()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	facts, err := readProductDirectExpenses(context.Background(), tx, "PRJ-1", "2026-12")
	if err != nil || len(facts) != 2 {
		t.Fatalf("%+v %v", facts, err)
	}
	if facts[0].PeriodMonth != "2026-12" || facts[0].Currency != "USD" || facts[1].Currency != "" || facts[1].Status != "draft" {
		t.Fatalf("lost ledger facts: %+v", facts)
	}
	if _, err := readProductDirectExpenses(context.Background(), tx, "PRJ-1", "2026-13"); err == nil {
		t.Fatal("invalid month accepted")
	}
	tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
