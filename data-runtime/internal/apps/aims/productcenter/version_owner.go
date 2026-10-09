package productcenter

import (
	"context"
	"database/sql"
)

func validateVersionOwnerTx(ctx context.Context, tx *sql.Tx, code, uid string) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_members WHERE BINARY product_code=BINARY ? AND BINARY uid=BINARY ? AND status='active' AND valid_from<=UTC_TIMESTAMP(3) AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP(3))`, code, uid).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return invalid("product_version_owner_unavailable", "请选择当前有效的产品成员作为版本负责人")
	}
	return nil
}
