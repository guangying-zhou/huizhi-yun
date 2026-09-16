package people

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestFormatEmployeeNumberStartsAtThreeDigitsWithoutTruncating(t *testing.T) {
	tests := map[int64]string{0: "000", 1: "001", 999: "999", 1000: "1000"}
	for input, expected := range tests {
		if actual := formatEmployeeNumber(input); actual != expected {
			t.Fatalf("formatEmployeeNumber(%d)=%q, want %q", input, actual, expected)
		}
	}
}

func TestAllocateEmployeeNumberSkipsExistingNumbersAndAdvancesSequence(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT next_value FROM people_employee_number_sequences`).
		WithArgs(employeeNumberSequenceCode).
		WillReturnRows(sqlmock.NewRows([]string{"next_value"}).AddRow(0))
	mock.ExpectQuery(`SELECT EXISTS.*people_employees.*EXISTS.*people_onboarding_cases`).
		WithArgs("000", "000").
		WillReturnRows(sqlmock.NewRows([]string{"employee_exists", "onboarding_exists"}).AddRow(1, 0))
	mock.ExpectQuery(`SELECT EXISTS.*people_employees.*EXISTS.*people_onboarding_cases`).
		WithArgs("001", "001").
		WillReturnRows(sqlmock.NewRows([]string{"employee_exists", "onboarding_exists"}).AddRow(0, 0))
	mock.ExpectExec(`UPDATE people_employee_number_sequences SET next_value=\?`).
		WithArgs(int64(2), employeeNumberSequenceCode).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()

	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := allocateEmployeeNumberTx(context.Background(), tx)
	if err != nil || actual != "001" {
		t.Fatalf("employee number=%q err=%v", actual, err)
	}
	if err = tx.Rollback(); err != nil && err != sql.ErrTxDone {
		t.Fatal(err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkSyncPreservesExistingEmployeeNumber(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}).AddRow("007"))
	mock.ExpectRollback()

	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := employeeNumberForDingTalkSyncTx(context.Background(), tx, "u1")
	if err != nil || actual != "007" {
		t.Fatalf("employee number=%q err=%v", actual, err)
	}
	_ = tx.Rollback()
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
