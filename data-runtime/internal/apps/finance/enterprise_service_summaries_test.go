package finance

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestServiceSummaryDenialDoesNotResolveOrCount(t *testing.T) {
	out, e := ReadCustomerServiceSummaryTx(context.Background(), nil, func(string) (string, error) { t.Fatal("denied table resolved"); return "", nil }, "C", "actor", []string{"CT"}, ServiceSummaryDisclosure{"none", "none", "none"})
	if e != nil || len(out) != 1 || out["access"] != "denied" {
		t.Fatal(out, e)
	}
}
func TestServiceSummaryResponsibilityBeforeCurrencyGrouping(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	m.ExpectBegin()
	tx, _ := db.Begin()
	defer tx.Rollback()
	m.ExpectQuery("SELECT currency_code.*BINARY customer_code=BINARY.*BINARY contract_code IN.*BINARY issued_by=BINARY").WithArgs("C", "CT", "actor").WillReturnRows(sqlmock.NewRows([]string{"currency", "amount", "count"}).AddRow("CNY", "12.00", 1))
	out, e := ReadCustomerServiceSummaryTx(context.Background(), tx, func(s string) (string, error) { return s, nil }, "C", "actor", []string{"CT"}, ServiceSummaryDisclosure{"self", "none", "none"})
	if e != nil || out["receipts"].(map[string]any)["access"] != "denied" {
		t.Fatal(out, e)
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
func TestServiceSummaryDependencyFailureIsNotZero(t *testing.T) {
	_, e := ReadCustomerServiceSummaryTx(context.Background(), nil, func(string) (string, error) { return "", errors.New("dependency") }, "C", "actor", []string{"CT"}, ServiceSummaryDisclosure{"all", "none", "none"})
	if e == nil {
		t.Fatal("dependency swallowed")
	}
}
