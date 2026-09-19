package assets

import (
	"context"
	"net/http"
	"net/url"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseProductAdoptionViewNames lists the compatibility views this read
// needs. It is deliberately separate from the product view list: a unified
// database that has not installed them yet keeps every other Assets service
// working, and this entrypoint alone reports that it is unavailable.
func EnterpriseProductAdoptionViewNames() []string {
	return []string{"customer_delivery_assets", "asset_environments", "customer_delivery_asset_environment_rel"}
}

// EnterpriseProductAdoptionRead serves the product adoption query from the
// unified authority instead of the signed cross-app command. The Host BFF still
// compiles the delivery and environment object scopes for the delegated user;
// this entrypoint never accepts a caller-selected predicate, and it reads both
// totals and rows from one snapshot transaction.
func (a *Adapter) EnterpriseProductAdoptionRead(ctx context.Context, productCode string, deliveryScope, environmentScope url.Values, page, pageSize int) (ProductAdoptionPage, error) {
	if a.enterpriseReads == nil || a.enterpriseReads.registry == nil {
		return ProductAdoptionPage{}, httperror.New(http.StatusServiceUnavailable, "enterprise_product_adoption_reader_unavailable", "Product adoption unified reader unavailable")
	}
	tx, _, err := a.enterpriseReads.registry.BeginSnapshotReadTransaction(ctx, a.enterpriseReads.request)
	if err != nil {
		return ProductAdoptionPage{}, err
	}
	defer tx.Rollback()
	// The snapshot transaction is already bound to the registered generation, so
	// the view check runs inside it and a missing view fails this entrypoint only.
	if err = e.VerifyCompatibilityViewsTx(ctx, tx, a.enterpriseReads.binding, "assets", EnterpriseProductAdoptionViewNames()); err != nil {
		return ProductAdoptionPage{}, httperror.New(http.StatusServiceUnavailable, "enterprise_product_adoption_views_unavailable", "Product adoption compatibility views are not installed")
	}
	result, err := readProductAdoption(ctx, tx, productCode, deliveryScope, environmentScope, page, pageSize)
	if err != nil {
		return ProductAdoptionPage{}, err
	}
	if err = tx.Commit(); err != nil {
		return ProductAdoptionPage{}, err
	}
	return result, nil
}
