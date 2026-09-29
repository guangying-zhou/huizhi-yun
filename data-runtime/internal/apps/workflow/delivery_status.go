package workflow

import (
	"context"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workflowDeliveryStatus struct {
	Pending          int64 `json:"pending"`
	Abandoned        int64 `json:"abandoned"`
	OldestPendingSec int64 `json:"oldestPendingSeconds"`
}

func (a *Adapter) workflowDeliveryStatus(ctx context.Context, tenant string, deployment string) (InstanceAPIResponse, string, error) {
	if tenant == "" || deployment == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "workflow_delivery_context_required", "trusted delivery context required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer tx.Rollback()
	counts := map[string]workflowDeliveryStatus{}
	for _, kind := range []workflowDeliveryKind{workflowNotificationDelivery, workflowActionableDelivery, workflowCallbackDelivery} {
		pendingCondition := "delivery_status = 'pending'"
		abandonedCondition := "delivery_status = 'abandoned'"
		if kind.label == "callback" {
			pendingCondition = "status IN ('pending','failed')"
			abandonedCondition = "status = 'abandoned'"
		}
		query := "SELECT COUNT(CASE WHEN " + pendingCondition + " THEN 1 END), " +
			"COUNT(CASE WHEN " + abandonedCondition + " THEN 1 END), " +
			"COALESCE(TIMESTAMPDIFF(SECOND, MIN(CASE WHEN " + pendingCondition + " THEN created_at END), NOW()), 0) " +
			"FROM " + kind.table
		var item workflowDeliveryStatus
		if err := tx.QueryRowContext(ctx, query).Scan(&item.Pending, &item.Abandoned, &item.OldestPendingSec); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		counts[kind.label] = item
	}
	var blocked, abandonedDependency int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(CASE WHEN dependency.instance_id = o.instance_id
			AND dependency.delivery_status = 'abandoned' THEN 1 ELSE 0 END), 0)
		FROM flow_actionable_outbox o
		LEFT JOIN flow_notification_outbox dependency ON dependency.id = o.depends_on_notification_outbox_id
		WHERE o.delivery_status = 'pending'
		  AND ((o.depends_on_notification_outbox_id IS NOT NULL
			AND (dependency.id IS NULL OR dependency.instance_id <> o.instance_id OR dependency.delivery_status <> 'delivered'))
			OR EXISTS (SELECT 1 FROM flow_notification_outbox n WHERE n.instance_id = o.instance_id
				AND (n.actionable_key = o.actionable_key OR (o.action_id IS NOT NULL AND n.action_id = o.action_id))
				AND n.delivery_status <> 'delivered'))
	`).Scan(&blocked, &abandonedDependency); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{
		"tenantCode": tenant, "deploymentCode": deployment,
		"notification": counts["notification"], "actionable": counts["actionable"], "callback": counts["callback"],
		"dependencyBlocked": blocked, "abandonedDependencyBlocked": abandonedDependency,
	}}, "workflow.delivery_effects.status", nil
}
