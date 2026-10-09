package altoc

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// LockFinanceExpenseContractTx is an owning, caller-Tx reference validator. It
// does not grant Altoc write access or consume a receivable billing schedule.
func LockFinanceExpenseContractTx(ctx context.Context, tx *sql.Tx, code, customer, currency string) error {
	var cid int64
	if e := tx.QueryRowContext(ctx, "SELECT customer_id FROM altoc_contract WHERE BINARY code=BINARY ? AND deleted_at IS NULL", code).Scan(&cid); e != nil {
		if e == sql.ErrNoRows {
			return httperror.New(400, "finance_contract_reference_invalid", "Invalid contract reference")
		}
		return e
	}
	var cc string
	if e := tx.QueryRowContext(ctx, "SELECT code FROM altoc_customer WHERE id=? AND deleted_at IS NULL FOR UPDATE", cid).Scan(&cc); e != nil {
		return e
	}
	var actualID int64
	var unit, status string
	if e := tx.QueryRowContext(ctx, "SELECT customer_id,currency_code,legal_status FROM altoc_contract WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", code).Scan(&actualID, &unit, &status); e != nil {
		return e
	}
	if actualID != cid || customer != "" && customer != cc || currency != unit || status != "effective" {
		return httperror.New(409, "finance_contract_reference_changed", "Contract reference changed")
	}
	return nil
}
