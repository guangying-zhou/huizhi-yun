package aims

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
)

var errProductCostReferenceMissing = errors.New("product cost rule references an unknown product workspace")

// Archived workspaces remain valid for historical cost attribution. This checks
// registered product identity, not current product lifecycle or user membership.
func validateProductCostReferences(ctx context.Context, tx *sql.Tx, command map[string]any) error {
	if !validProductCostRulesOperation(command) {
		return errors.New("invalid product cost command")
	}
	rows := command["shares"].([]any)
	if len(rows) == 0 {
		return nil
	}
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		codes = append(codes, row.(map[string]any)["productCode"].(string))
	}
	sort.Strings(codes)
	args := make([]any, len(codes))
	for i, code := range codes {
		args[i] = code
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(codes)), ",")
	result, err := tx.QueryContext(ctx, "SELECT product_code FROM product_workspaces WHERE product_code IN ("+placeholders+") ORDER BY product_code FOR SHARE", args...)
	if err != nil {
		return err
	}
	defer result.Close()
	found := map[string]bool{}
	for result.Next() {
		var code string
		if err := result.Scan(&code); err != nil {
			return err
		}
		found[code] = true
	}
	if err := result.Err(); err != nil {
		return err
	}
	for _, code := range codes {
		if !found[code] {
			return errProductCostReferenceMissing
		}
	}
	return nil
}
