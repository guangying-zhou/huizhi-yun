package productcenter

import (
	"context"
	"database/sql"
)

func nullableRequestComponent(value *int64) any {
	if value == nil || *value == 0 {
		return nil
	}
	return *value
}

func validateRequestComponentTx(ctx context.Context, tx *sql.Tx, code string, value *int64) error {
	if value == nil || *value == 0 {
		return nil
	}
	if *value < 0 {
		return invalid("product_request_component_invalid", "需求模块标识无效")
	}
	var found int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM product_components WHERE id=? AND BINARY product_code=BINARY ?`, *value, code).Scan(&found); err != nil {
		if err == sql.ErrNoRows {
			return invalid("product_request_component_invalid", "模块不属于当前产品")
		}
		return err
	}
	return nil
}
