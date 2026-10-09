package altoc

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestW1ContractRecalculationHeaderAndLegacy(t *testing.T) {
	for _, kind := range []string{"legacy", "lines", "header"} {
		t.Run(kind, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectBegin()
			tx, e := db.Begin()
			if e != nil {
				t.Fatal(e)
			}
			columns := []string{"id", "tax_rate"}
			r := sqlmock.NewRows(columns).AddRow(1, nil)
			if kind != "legacy" {
				r = sqlmock.NewRows([]string{"id", "tax_rate", "amount_basis"}).AddRow(1, nil, kind)
			}
			m.ExpectQuery(`SELECT \* FROM contract WHERE id = \? FOR UPDATE`).WithArgs(int64(1)).WillReturnRows(r)
			if kind != "header" {
				m.ExpectQuery(`SELECT.*COALESCE\(SUM\(amount_tax_inclusive\)`).WithArgs(int64(1)).WillReturnRows(sqlmock.NewRows([]string{"amount_tax_inclusive", "amount_tax_exclusive"}).AddRow("106.00", "100.00"))
				m.ExpectExec(`UPDATE contract`).WithArgs("106.00", "100.00", "actor", int64(1)).WillReturnResult(sqlmock.NewResult(0, 1))
			}
			a := &Adapter{}
			if e = a.recalculateContractLineTotalsTx(context.Background(), tx, 1, "actor"); e != nil {
				t.Fatal(e)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func w1Refused(e error, code string) bool {
	var he httperror.Error
	return errors.As(e, &he) && he.Status == 409 && he.Code == code
}

func TestW1ContractGuardsLegacyAndInstalled(t *testing.T) {
	legacy := map[string]any{"id": int64(1), "status": "draft"}
	native := map[string]any{"id": int64(1), "status": "draft", "amount_basis": "lines", "origin_type": "native"}
	for _, c := range []map[string]any{legacy, native} {
		if e := ensureContractDraftEditable(c); e != nil {
			t.Fatal(e)
		}
		if e := ensureContractNotHistorical(c); e != nil {
			t.Fatal(e)
		}
	}
	header := map[string]any{"id": int64(1), "status": "draft", "amount_basis": "header", "origin_type": "native"}
	if e := ensureContractDraftEditable(header); !w1Refused(e, "altoc_contract_header_lines_locked") {
		t.Fatal("header lines not locked", e)
	}
	if e := ensureContractNotHistorical(header); e != nil {
		t.Fatal(e)
	}
	imported := map[string]any{"id": int64(1), "status": "effective", "amount_basis": "header", "origin_type": "historical_import"}
	if e := ensureContractDraftEditable(imported); !w1Refused(e, "altoc_contract_header_lines_locked") {
		t.Fatal("imported lines not locked", e)
	}
	if e := ensureContractNotHistorical(imported); !w1Refused(e, "altoc_contract_historical_operation_denied") {
		t.Fatal("imported contract not refused", e)
	}
}

func TestW1FinanceContractSummaryHistoricalAndLegacy(t *testing.T) {
	for _, kind := range []string{"legacy", "native", "historical_import"} {
		t.Run(kind, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectBegin()
			tx, e := db.Begin()
			if e != nil {
				t.Fatal(e)
			}
			r := sqlmock.NewRows([]string{"id"}).AddRow(1)
			if kind != "legacy" {
				r = sqlmock.NewRows([]string{"id", "origin_type"}).AddRow(1, kind)
			}
			m.ExpectQuery(`SELECT \* FROM altoc_contract WHERE id = \? AND deleted_at IS NULL FOR UPDATE`).WithArgs(int64(1)).WillReturnRows(r)
			if kind != "historical_import" {
				m.ExpectExec(`UPDATE altoc_contract SET financial_status`).WillReturnResult(sqlmock.NewResult(0, 1))
			}
			e = ApplyFinanceContractSummaryTx(context.Background(), tx, 1, "10.00", "0.00")
			if kind == "historical_import" && !w1Refused(e, "altoc_contract_historical_operation_denied") {
				t.Fatal("imported contract summary applied", e)
			}
			if kind != "historical_import" && e != nil {
				t.Fatal(e)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestBasicReadQueryIncludeDescendants(t *testing.T) {
	ok := BasicReadQuery{Page: 1, PageSize: 20, CustomerID: "7", IncludeDescendants: true}
	if e := ok.Validate("contract"); e != nil {
		t.Fatal(e)
	}
	for name, q := range map[string]BasicReadQuery{
		"no customer": {Page: 1, PageSize: 20, IncludeDescendants: true},
	} {
		if q.Validate("contract") == nil {
			t.Fatal(name)
		}
	}
	for _, resource := range []string{"customer", "receivable"} {
		if (BasicReadQuery{Page: 1, PageSize: 20, CustomerID: "7", IncludeDescendants: true}).Validate(resource) == nil {
			t.Fatal(resource)
		}
	}
}
