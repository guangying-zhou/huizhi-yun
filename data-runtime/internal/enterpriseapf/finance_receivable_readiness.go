package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	wizbiztool "github.com/huizhi-yun/data-runtime/internal/openingproof"
	"strings"
	"time"
)

type openingEvidence struct {
	Plan         wizbiztool.OpeningPlan         `json:"plan"`
	Confirmation wizbiztool.OpeningConfirmation `json:"confirmation"`
	Seals        map[string]struct {
		Table     string `json:"table"`
		KeyColumn string `json:"keyColumn"`
		Key       string `json:"key"`
		SHA256    string `json:"sha256"`
	} `json:"seals"`
	Deleted map[string]bool `json:"deleted"`
}

// Registry-resolved migration tables are mandatory. No source DB, caller
// assertion, arbitrary table, or raw source body is accepted as verification.
func inspectOpeningEvidence(ctx context.Context, tx *sql.Tx, tables map[string]string, contract string) (map[string]any, error) {
	var raw, hash, status string
	var batchID int64
	e := tx.QueryRowContext(ctx, "SELECT b.id,b.scope_json,b.plan_sha256,b.status FROM "+tables["mig_batch"]+" b JOIN "+tables["mig_object_map"]+" m ON m.batch_id=b.id WHERE m.source_table='wb_contract' AND m.target_domain='altoc' AND m.target_table='altoc_billing_schedule' AND m.map_role='opening' AND m.target_key IN (SELECT bs.code FROM altoc_billing_schedule bs JOIN altoc_contract c ON c.id=bs.contract_id WHERE c.code=?)", contract).Scan(&batchID, &raw, &hash, &status)
	if e != nil {
		return nil, ledgerError(409, "opening_evidence_missing")
	}
	var evidence openingEvidence
	if status != "applied" || json.Unmarshal([]byte(raw), &evidence) != nil || wizbiztool.ReviewOpeningPlan(evidence.Plan, hash) != nil {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	c := evidence.Confirmation
	if len(evidence.Plan.ConfirmationSHA256) != 64 || c.BatchCode != evidence.Plan.BatchCode || c.MainReviewHash != evidence.Plan.MainReviewHash || c.SnapshotSHA256 != evidence.Plan.SnapshotSHA256 || c.Approver == "" {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	if _, e = time.Parse("2006-01-02", c.Date); e != nil {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	if _, e = time.Parse("2006-01-02", c.AsOfDate); e != nil {
		return nil, ledgerError(409, "opening_cutoff_missing")
	}
	var done, planned int
	var stepStatus string
	if e = tx.QueryRowContext(ctx, "SELECT done_rows,planned_rows,status FROM "+tables["mig_batch_step"]+" WHERE batch_id=? AND step='opening-balance'", batchID).Scan(&done, &planned, &stepStatus); e != nil || stepStatus != "completed" || done != planned || done != len(evidence.Plan.Rows) {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	var candidate *wizbiztool.OpeningRow
	for n := range evidence.Plan.Rows {
		if evidence.Plan.Rows[n].ContractCode == contract {
			candidate = &evidence.Plan.Rows[n]
			break
		}
	}
	if candidate == nil || evidence.Deleted[candidate.Code] {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	confirmed := 0
	for _, r := range c.Contracts {
		if r.SourcePK == candidate.SourcePK {
			confirmed++
			if r.Amount != candidate.Amount || (r.DueDate == nil) != (candidate.DueDate == nil) || r.DueDate != nil && *r.DueDate != *candidate.DueDate {
				return nil, ledgerError(409, "opening_evidence_invalid")
			}
		}
	}
	if confirmed != 1 {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	seal, ok := evidence.Seals[candidate.Code]
	if !ok || seal.Table != "altoc_billing_schedule" || seal.KeyColumn != "code" || seal.Key != candidate.Code {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	// Cast temporal values on the server: Runtime parses dates into time.Time,
	// while the migration sealer records MySQL text, including fractional precision.
	metadata, e := tx.QueryContext(ctx, "SELECT * FROM altoc_billing_schedule LIMIT 0")
	if e != nil {
		return nil, e
	}
	types, e := metadata.ColumnTypes()
	metadata.Close()
	if e != nil {
		return nil, e
	}
	selects := make([]string, len(types))
	for n, column := range types {
		name := "`" + strings.ReplaceAll(column.Name(), "`", "``") + "`"
		selects[n] = name
		switch column.DatabaseTypeName() {
		case "DATE", "DATETIME", "TIMESTAMP":
			selects[n] = "CAST(" + name + " AS CHAR) AS " + name
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+strings.Join(selects, ",")+" FROM altoc_billing_schedule WHERE BINARY code=BINARY ? FOR UPDATE", candidate.Code)
	if e != nil {
		return nil, e
	}
	cols, e := rows.Columns()
	if e != nil {
		rows.Close()
		return nil, e
	}
	values := make([]sql.RawBytes, len(cols))
	ptr := make([]any, len(cols))
	for n := range values {
		ptr[n] = &values[n]
	}
	if !rows.Next() {
		rows.Close()
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	if e = rows.Scan(ptr...); e != nil {
		rows.Close()
		return nil, e
	}
	row := map[string]any{}
	for n, k := range cols {
		if values[n] == nil {
			row[k] = nil
		} else {
			row[k] = string(values[n])
		}
	}
	more := rows.Next()
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	sealed, e := wizbiztool.CanonicalRow(row)
	if e != nil || more || wizbiztool.Digest(sealed) != seal.SHA256 || ledgerText(row["amount"]) != candidate.Amount || ledgerText(row["received_amount"]) != "0.00" || row["plan_type"] != "opening_balance" || row["source_type"] != "historical_import" {
		return nil, ledgerError(409, "opening_evidence_changed")
	}
	var contractID int64
	var origin string
	if e = tx.QueryRowContext(ctx, "SELECT id,origin_type FROM altoc_contract WHERE code=? AND deleted_at IS NULL", contract).Scan(&contractID, &origin); e != nil {
		return nil, e
	}
	if origin != "historical_import" || ledgerVersion(row["contract_id"]) != contractID {
		return nil, ledgerError(409, "opening_evidence_invalid")
	}
	for _, f := range []string{"finance_invoice_request", "finance_invoice", "finance_receipt", "finance_reconciliation"} {
		var n int
		where := "contract_code=?"
		if f == "finance_reconciliation" {
			where += " AND status='active'"
		} else {
			where += " AND deleted_at IS NULL"
		}
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+f+" WHERE "+where, contract).Scan(&n); e != nil {
			return nil, e
		}
		if n != 0 {
			return nil, ledgerError(409, "opening_already_used")
		}
	}
	return map[string]any{"contract_id": contractID, "contract_code": contract, "billing_schedule_id": row["id"], "billing_schedule_code": candidate.Code, "opening_batch_id": batchID, "opening_amount": candidate.Amount, "currency_code": row["currency_code"], "cutoff_date": c.AsOfDate, "review_hash": hash, "confirmation_sha256": evidence.Plan.ConfirmationSHA256, "evidence_sha256": wizbiztool.Digest([]byte(raw)), "row_version": ledgerVersion(row["row_version"]), "ready": false, "calculation_basis": "net_opening", "historical_details": "read_only_excluded"}, nil
}
func historicalContinuation(ctx context.Context, tx *sql.Tx, contract, schedule string) (map[string]any, error) {
	rows, e := tx.QueryContext(ctx, "SELECT code,contract_code,billing_schedule_code,opening_amount,currency_code,CAST(cutoff_date AS CHAR),review_hash,activated_by,CAST(activated_at AS CHAR),row_version FROM finance_historical_readiness WHERE BINARY contract_code=BINARY ?", contract)
	if e != nil {
		return nil, e
	}
	items, e := readFinanceRows(rows, []string{"code", "contract_code", "billing_schedule_code", "opening_amount", "currency_code", "cutoff_date", "review_hash", "activated_by", "activated_at", "row_version"})
	if e != nil {
		return nil, e
	}
	if len(items) != 1 || schedule != "" && items[0]["billing_schedule_code"] != schedule {
		return nil, ledgerError(409, "historical_contract_not_ready")
	}
	items[0]["ready"] = true
	items[0]["status"] = "active"
	return items[0], nil
}
