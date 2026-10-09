package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// Narrow Finance owning read, in the caller's Registry snapshot. Contract scope
// has already been verified; return referenced names/codes only, never account
// numbers, credential references or directory rows.
func financeW3ReferenceName(ctx context.Context, tx *sql.Tx, t map[string]string, logical, code string) (string, error) {
	table := t[logical]
	if table == "" || code == "" {
		return "", nil
	}
	column := "name"
	if logical == "finance_bank_account" {
		column = "short_name"
		has, e := financeHasColumn(ctx, tx, table, column)
		if e != nil {
			return "", e
		}
		if !has {
			return "", nil
		}
	}
	var name sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT "+column+" FROM "+table+" WHERE code=?", code).Scan(&name)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return name.String, err
}
func w3ContractNames(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, t map[string]string, item map[string]any) error {
	party, e := r.Table("altoc_contract_party")
	if e != nil {
		return e
	}
	role := "seller"
	if item["direction"] == "purchase" {
		role = "buyer"
	}
	var code, snapshot string
	err := tx.QueryRowContext(ctx, "SELECT party_ref_code,party_name_snapshot FROM "+party+" WHERE contract_id=? AND party_type='legal_entity' AND role_code=? AND is_primary=1 ORDER BY id LIMIT 1", item["id"], role).Scan(&code, &snapshot)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil {
		item["legal_entity_code"], item["legal_entity_name_snapshot"] = code, snapshot
		name, e := financeW3ReferenceName(ctx, tx, t, "finance_legal_entity", code)
		if e != nil {
			return e
		}
		if name != "" {
			item["legal_entity_name"] = name
		}
	}
	if code, ok := item["receiving_bank_account_code"].(string); ok && code != "" {
		name, e := financeW3ReferenceName(ctx, tx, t, "finance_bank_account", code)
		if e != nil {
			return e
		}
		if name != "" {
			item["receiving_bank_account_short_name"] = name
		}
	}
	return nil
}
