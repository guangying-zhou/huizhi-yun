package enterpriseapf

import (
	"context"
	"database/sql"
	"strings"
)

// Column discovery makes optional W1 reads inert before installation. Only the
// caller's closed projection is selected; SELECT * is never returned as data.
func w3ExistingColumns(ctx context.Context, tx *sql.Tx, table string, base, optional []string) ([]string, error) {
	rows, e := tx.QueryContext(ctx, "SELECT * FROM "+table+" LIMIT 0")
	if e != nil {
		return nil, e
	}
	columns, e := rows.Columns()
	rows.Close()
	if e != nil {
		return nil, e
	}
	available := map[string]bool{}
	for _, c := range columns {
		available[c] = true
	}
	out := append([]string{}, base...)
	for _, c := range optional {
		if available[c] {
			out = append(out, c)
		}
	}
	return out, nil
}
func w3Select(columns []string) string {
	out := append([]string{}, columns...)
	for i, c := range out {
		if strings.HasSuffix(c, "_at") || strings.HasSuffix(c, "_date") {
			out[i] = "CAST(" + c + " AS CHAR) AS " + c
		}
	}
	return strings.Join(out, ",")
}

var contractW3Columns = []string{"parent_contract_id", "contact_id", "signed_amount", "effective_amount", "contract_category", "amount_basis", "origin_type", "signed_at", "receiving_bank_account_code", "imported_batch_code", "imported_at"}
