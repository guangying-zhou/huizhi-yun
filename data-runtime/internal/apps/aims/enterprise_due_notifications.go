package aims

import (
	"context"
	"database/sql"
	"net/http"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseDueNotificationViewNames lists every logical table the due
// notification scan and checkpoints read or write.
func EnterpriseDueNotificationViewNames() []string {
	return []string{"aims_notification_checkpoint", "work_items", "aims_projects", "work_item_service_ext", "aims_project_members"}
}

// EnterpriseDueNotificationCommand runs one due-notification step on the
// unified scheduler path. begin must return a generation-bound transaction;
// every statement of the step runs inside one, so a generation change fences
// the remaining work. The body has already been limited by the route.
func EnterpriseDueNotificationCommand(ctx context.Context, begin func(context.Context) (*sql.Tx, error), binding e.Binding, action string, body map[string]any) (map[string]any, error) {
	if begin == nil {
		return nil, e.ErrBindingNotFound
	}
	tx, err := begin(ctx)
	if err != nil {
		return nil, err
	}
	err = e.VerifyCompatibilityViewsTx(ctx, tx, binding, "aims", EnterpriseDueNotificationViewNames())
	_ = tx.Rollback()
	if err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "enterprise_due_notification_views_unavailable", "Due notification compatibility views are not installed")
	}
	store := schedulerDueStore(begin)
	switch action {
	case "scan-due":
		return store.scanDueNotifications(ctx, body)
	case "acknowledge":
		return store.acknowledgeDueNotification(ctx, body)
	case "acknowledge-closure":
		return store.acknowledgeDueNotificationClosure(ctx, body)
	default:
		return nil, httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}
