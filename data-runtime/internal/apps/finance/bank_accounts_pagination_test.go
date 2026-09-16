package finance

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBankAccountsAppliesServerPaginationWithoutChangingFullSummary(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS total.*FROM finance_bank_account`).
		WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(int64(45)))
	mock.ExpectQuery(`(?s)SELECT.*COUNT\(\*\) AS account_count.*FROM finance_bank_account`).
		WillReturnRows(sqlmock.NewRows([]string{"account_count", "cash_balance", "loan_balance", "stock_fund_balance"}).
			AddRow(int64(45), "120.00", "-20.00", "100.00"))
	mock.ExpectQuery(`(?s)SELECT.*ba\.id.*FROM finance_bank_account.*LIMIT \? OFFSET \?`).
		WithArgs(20, 20).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "account_name", "bank_name", "account_no_masked", "account_type",
			"currency_code", "owner_dept_code", "status", "opened_at", "created_at", "deleted_at",
			"latest_balance_amount", "latest_balance_date",
		}))

	result, err := adapter.BankAccounts(context.Background(), url.Values{
		"page":     {"2"},
		"pageSize": {"20"},
		"showAll":  {"1"},
	})
	if err != nil {
		t.Fatalf("BankAccounts: %v", err)
	}
	if result.Page != 2 || result.PageSize != 20 || result.Total != 45 {
		t.Fatalf("unexpected page: page=%d pageSize=%d total=%d", result.Page, result.PageSize, result.Total)
	}
	if result.Summary["account_count"] != int64(45) {
		t.Fatalf("summary must cover the full filtered result: %#v", result.Summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
