package altoc

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Fixed owning caller-Tx port. Caller has taken Registry, contract and schedule
// locks in global order; no commits or network effects in this core.
type FinanceBillingSummary struct {
	ContractID, ScheduleID, ExpectedVersion int64
	InvoicedAmount, ReceivedAmount          string
}

func ApplyFinanceBillingSummaryTx(ctx context.Context, tx *sql.Tx, v FinanceBillingSummary) error {
	if tx == nil || v.ContractID < 1 || v.ScheduleID < 1 || v.ExpectedVersion < 1 {
		return httperror.New(400, "altoc_finance_summary_invalid", "Invalid billing summary")
	}
	result, e := tx.ExecContext(ctx, `UPDATE altoc_billing_schedule SET invoiced_amount=?,received_amount=?,status=CASE WHEN status='cancelled' THEN status WHEN ?>=amount THEN 'received' WHEN ?>0 THEN 'partially_received' WHEN ?>=amount THEN 'invoiced' WHEN ?>0 THEN 'invoicing' WHEN billable_at IS NOT NULL THEN 'billable' ELSE 'planned' END,finance_synced_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=? AND contract_id=? AND row_version=? AND deleted_at IS NULL`, v.InvoicedAmount, v.ReceivedAmount, v.ReceivedAmount, v.ReceivedAmount, v.InvoicedAmount, v.InvoicedAmount, v.ScheduleID, v.ContractID, v.ExpectedVersion)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return httperror.New(409, "altoc_finance_summary_version_conflict", "Billing schedule changed")
	}
	return nil
}
func ApplyFinanceContractSummaryTx(ctx context.Context, tx *sql.Tx, id int64, invoiced, received string) error {
	if tx == nil || id < 1 {
		return httperror.New(400, "altoc_finance_summary_invalid", "Invalid contract summary")
	}
	// Finance refuses imported contracts before reaching here; fail closed rather
	// than let a summary overwrite the imported "unplanned" state. SELECT * keeps
	// installations without the W1 columns on the previous behavior.
	contract, e := altocQueryOneMap(ctx, tx, "SELECT * FROM altoc_contract WHERE id = ? AND deleted_at IS NULL FOR UPDATE", id)
	if e != nil {
		return e
	}
	if e = ensureContractNotHistorical(contract); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `UPDATE altoc_contract SET financial_status=CASE WHEN ?>=amount_tax_inclusive THEN 'received' WHEN ?>0 THEN 'partially_received' WHEN ?>0 THEN 'invoicing' ELSE 'planned' END,row_version=row_version+1 WHERE id=? AND deleted_at IS NULL`, received, received, invoiced, id)
	return e
}

// Finance's bounded read-only allocation projection; caller supplies its already
// authorized contract from the Finance object, never a browser-supplied scope.
type FinanceBillingCandidate struct {
	Code     string `json:"code"`
	Currency string `json:"currency_code"`
	Amount   string `json:"amount"`
	Received string `json:"received_amount"`
	Version  int64  `json:"row_version"`
}

func ReadFinanceBillingCandidatesTx(ctx context.Context, tx *sql.Tx, contract string) ([]FinanceBillingCandidate, error) {
	rows, err := tx.QueryContext(ctx, `SELECT bs.code,bs.currency_code,bs.amount,bs.received_amount,bs.row_version FROM altoc_billing_schedule bs JOIN altoc_contract c ON c.id=bs.contract_id WHERE c.code=? AND c.deleted_at IS NULL AND bs.deleted_at IS NULL AND bs.direction='receivable' AND bs.status NOT IN ('cancelled','received') ORDER BY bs.id LIMIT 100`, contract)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FinanceBillingCandidate{}
	for rows.Next() {
		var v FinanceBillingCandidate
		if err = rows.Scan(&v.Code, &v.Currency, &v.Amount, &v.Received, &v.Version); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Snapshot only the profile fields Finance owns; no customer/grant expansion.
func ReadFinanceInvoiceProfileTx(ctx context.Context, tx *sql.Tx, profile, customer string) (string, string, string, error) {
	var name, no, kind string
	err := tx.QueryRowContext(ctx, `SELECT p.taxpayer_name,COALESCE(p.taxpayer_no,''),p.invoice_type FROM altoc_customer_invoice_profile p JOIN altoc_customer c ON c.id=p.customer_id WHERE p.code=? AND c.code=? AND p.status='active' AND p.deleted_at IS NULL AND c.deleted_at IS NULL`, profile, customer).Scan(&name, &no, &kind)
	return name, no, kind, err
}

// Narrow historical continuation port: persisted Finance opening proof is
// mandatory inside the caller transaction. No caller-provided trusted flag.
func ApplyHistoricalFinanceContractSummaryTx(ctx context.Context, tx *sql.Tx, id int64, invoiced, received string) error {
	var opening, adjusted string
	if e := tx.QueryRowContext(ctx, "SELECT CAST(opening_amount AS CHAR) FROM finance_historical_readiness WHERE contract_id=?", id).Scan(&opening); e != nil {
		return httperror.New(409, "finance_historical_contract_not_ready", "Historical contract is not ready")
	}
	if e := tx.QueryRowContext(ctx, "SELECT CAST(COALESCE(SUM(amount),0) AS CHAR) FROM finance_receivable_adjustment WHERE contract_id=? AND status='confirmed'", id).Scan(&adjusted); e != nil {
		return e
	}
	_, e := tx.ExecContext(ctx, "UPDATE altoc_contract SET financial_status=CASE WHEN ?+?>=? THEN 'received' WHEN ?>0 THEN 'partially_received' WHEN ?>0 THEN 'invoicing' ELSE 'planned' END,row_version=row_version+1 WHERE id=? AND origin_type='historical_import' AND deleted_at IS NULL", received, adjusted, opening, received, invoiced, id)
	return e
}
