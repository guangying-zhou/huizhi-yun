package assets

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// CheckServiceCoverageTx exposes only customer-bound identity qualification,
// never a general Assets list/read proxy. All facts come from current rows.
func CheckServiceCoverageTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, customer, asset, environment string) error {
	if tx == nil || r.Domain != "assets" || customer == "" || asset == "" && environment == "" {
		return enterprise.ErrBindingMismatch
	}
	var assetID, envID int64
	if asset != "" {
		table, e := r.Table("customer_delivery_assets")
		if e != nil {
			return e
		}
		var owner string
		e = tx.QueryRowContext(ctx, "SELECT id,COALESCE(customer_code,'') FROM "+table+" WHERE BINARY delivery_asset_code=BINARY ? AND deleted_at IS NULL FOR UPDATE", asset).Scan(&assetID, &owner)
		if e == sql.ErrNoRows {
			return httperror.New(404, "service_coverage_target_not_found", "覆盖资产不存在")
		}
		if e != nil {
			return e
		}
		if owner != customer {
			return httperror.New(403, "service_coverage_customer_mismatch", "覆盖对象不属于该客户")
		}
	}
	if environment != "" {
		table, e := r.Table("asset_environments")
		if e != nil {
			return e
		}
		var owner string
		e = tx.QueryRowContext(ctx, "SELECT id,COALESCE(customer_code,'') FROM "+table+" WHERE BINARY environment_code=BINARY ? FOR UPDATE", environment).Scan(&envID, &owner)
		if e == sql.ErrNoRows {
			return httperror.New(404, "service_coverage_target_not_found", "覆盖环境不存在")
		}
		if e != nil {
			return e
		}
		if owner != customer {
			return httperror.New(403, "service_coverage_customer_mismatch", "覆盖对象不属于该客户")
		}
	}
	if asset != "" && environment != "" {
		table, e := r.Table("customer_delivery_asset_environment_rel")
		if e != nil {
			return e
		}
		var n int
		e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE delivery_asset_id=? AND environment_id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", assetID, envID).Scan(&n)
		if e != nil {
			return e
		}
		if n != 1 {
			return httperror.New(409, "service_coverage_pair_invalid", "资产与环境关系无效")
		}
	}
	return nil
}
