package assets

import (
	"context"
	"database/sql"
	"net/http"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseDueNotificationViewNames lists every logical table the Assets due
// notification scan, recipient enrichment and checkpoints read or write.
func EnterpriseDueNotificationViewNames() []string {
	return []string{
		"assets_notification_checkpoint", "asset_items", "asset_resource_details", "ip_assets", "ip_asset_products",
		"product_assets", "customer_delivery_assets", "asset_offboarding_recovery_cases",
	}
}

// EnterpriseDueNotificationCommand runs one Assets due-notification step on the
// unified scheduler path. begin must return a generation-bound transaction and
// every statement of the step runs inside one. The route limits the body.
func EnterpriseDueNotificationCommand(ctx context.Context, begin func(context.Context) (*sql.Tx, error), binding e.Binding, action string, body map[string]any) (map[string]any, error) {
	if begin == nil {
		return nil, e.ErrBindingNotFound
	}
	tx, err := begin(ctx)
	if err != nil {
		return nil, err
	}
	err = e.VerifyCompatibilityViewsTx(ctx, tx, binding, "assets", EnterpriseDueNotificationViewNames())
	_ = tx.Rollback()
	if err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "enterprise_due_notification_views_unavailable", "Due notification compatibility views are not installed")
	}
	store := schedulerAssetsDueStore(begin)
	switch action {
	case "scan-due":
		return store.scanAssetsDueNotifications(ctx, body)
	case "acknowledge":
		return store.acknowledgeAssetsDueNotification(ctx, body)
	case "acknowledge-closure":
		return store.acknowledgeAssetsDueClosure(ctx, body)
	default:
		return nil, httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}
