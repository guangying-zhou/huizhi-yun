package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
)

type actionableLifecycleGroup struct {
	Key        string
	Version    string
	Recipients []string
}

func lifecycleForTask(task map[string]any, nextVersion string, state string, recipient string) WorkflowActionableLifecycle {
	return WorkflowActionableLifecycle{
		ActionableKey:   cleanAnyString(task["actionable_key"]),
		ExpectedVersion: cleanAnyString(task["actionable_version"]),
		NextVersion:     nextVersion,
		State:           state,
		Recipients:      uniqueSortedUIDs([]string{recipient}),
	}
}

func pendingActionableLifecycleEffects(ctx context.Context, tx *sql.Tx, instanceID any, nextVersion string, state string) ([]WorkflowActionableLifecycle, error) {
	tasks, err := queryMaps(ctx, tx, `
		SELECT id, assignee_uid, actionable_key, actionable_version
		FROM flow_tasks
		WHERE instance_id = ? AND status = 'pending'
		ORDER BY id
		FOR UPDATE
	`, instanceID)
	if err != nil {
		return nil, err
	}
	return actionableLifecycleEffectsForTasks(tasks, nextVersion, state), nil
}

func pendingActionableLifecycleEffectsForNode(ctx context.Context, tx *sql.Tx, instanceID any, nodeIndex any, nextVersion string, state string) ([]WorkflowActionableLifecycle, error) {
	tasks, err := queryMaps(ctx, tx, `
		SELECT id, assignee_uid, actionable_key, actionable_version
		FROM flow_tasks
		WHERE instance_id = ? AND node_index = ? AND status = 'pending'
		ORDER BY id
		FOR UPDATE
	`, instanceID, nodeIndex)
	if err != nil {
		return nil, err
	}
	return actionableLifecycleEffectsForTasks(tasks, nextVersion, state), nil
}

func pendingActionableLifecycleEffectsForGeneration(ctx context.Context, tx *sql.Tx, instanceID any, generationKey string, nextVersion string, state string) ([]WorkflowActionableLifecycle, error) {
	tasks, err := queryMaps(ctx, tx, `
		SELECT id, assignee_uid, actionable_key, actionable_version
		FROM flow_tasks
		WHERE instance_id = ? AND generation_key = ? AND status = 'pending'
		ORDER BY id
		FOR UPDATE
	`, instanceID, generationKey)
	if err != nil {
		return nil, err
	}
	return actionableLifecycleEffectsForTasks(tasks, nextVersion, state), nil
}

func pendingTasksOnly(tasks []map[string]any) []map[string]any {
	result := make([]map[string]any, 0)
	for _, task := range tasks {
		if cleanAnyString(task["status"]) == "pending" {
			result = append(result, task)
		}
	}
	return result
}

func actionableLifecycleEffectsForTasks(tasks []map[string]any, nextVersion string, state string) []WorkflowActionableLifecycle {
	groups := map[string]*actionableLifecycleGroup{}
	for _, task := range tasks {
		key := cleanAnyString(task["actionable_key"])
		version := cleanAnyString(task["actionable_version"])
		uid := cleanAnyString(task["assignee_uid"])
		if key == "" || version == "" || uid == "" {
			continue
		}
		groupKey := key + "\x00" + version
		group := groups[groupKey]
		if group == nil {
			group = &actionableLifecycleGroup{Key: key, Version: version}
			groups[groupKey] = group
		}
		group.Recipients = append(group.Recipients, uid)
	}

	ordered := make([]string, 0, len(groups))
	for key := range groups {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	result := make([]WorkflowActionableLifecycle, 0, len(ordered))
	for _, key := range ordered {
		group := groups[key]
		result = append(result, WorkflowActionableLifecycle{
			ActionableKey:   group.Key,
			ExpectedVersion: group.Version,
			NextVersion:     nextVersion,
			State:           state,
			Recipients:      uniqueSortedUIDs(group.Recipients),
		})
	}
	return result
}

func uniqueSortedUIDs(values []string) []string {
	seen := map[string]struct{}{}
	for _, value := range values {
		uid := cleanAnyString(value)
		if uid != "" {
			seen[uid] = struct{}{}
		}
	}
	result := make([]string, 0, len(seen))
	for uid := range seen {
		result = append(result, uid)
	}
	sort.Strings(result)
	return result
}

func persistActionableLifecycleEffects(ctx context.Context, tx *sql.Tx, instanceID any, actionID int64, effects *WorkflowEffects) error {
	if effects == nil {
		return nil
	}
	dependencies, err := persistWorkflowNotificationEffects(ctx, tx, instanceID, actionID, effects)
	if err != nil {
		return err
	}
	for index := range effects.ActionableLifecycles {
		effect := &effects.ActionableLifecycles[index]
		if effect.ActionableKey == "" || effect.ExpectedVersion == "" || effect.NextVersion == "" || effect.ExpectedVersion == effect.NextVersion || len(effect.Recipients) == 0 {
			return fmt.Errorf("invalid actionable lifecycle effect for instance %v", instanceID)
		}
		recipientsJSON, err := json.Marshal(uniqueSortedUIDs(effect.Recipients))
		if err != nil {
			return err
		}
		prerequisiteNotificationsJSON, err := json.Marshal(actionablePrerequisiteNotifications(effects.Notifications))
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO flow_actionable_outbox (
				instance_id, action_id, actionable_key, expected_version, next_version,
				next_state, recipients, prerequisite_notifications, depends_on_notification_outbox_id,
				delivery_status, attempt_count, created_at, updated_at
			) VALUES (?, NULLIF(?, 0), ?, ?, ?, ?, ?, ?, NULLIF(?, 0), 'pending', 0, NOW(), NOW())
		`, instanceID, actionID, effect.ActionableKey, effect.ExpectedVersion, effect.NextVersion, effect.State, string(recipientsJSON), string(prerequisiteNotificationsJSON), dependencies[effect.ActionableKey])
		if err != nil {
			return err
		}
		effect.EffectID, err = result.LastInsertId()
		if err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, "SELECT version_no FROM flow_actionable_outbox WHERE id=? FOR UPDATE", effect.EffectID).Scan(&effect.VersionNo); err != nil {
			return err
		}
	}
	return persistWorkflowCallbacks(ctx, tx, instanceID, effects)
}

func actionablePrerequisiteNotifications(notifications []WorkflowNotification) []WorkflowNotification {
	result := make([]WorkflowNotification, 0)
	for _, notification := range notifications {
		pending := notification.EventType == "workflow.task.created" ||
			notification.EventType == "workflow.task.delegated" ||
			notification.EventType == "workflow.instance.resubmitted" ||
			(notification.EventType == "workflow.instance.rejected" && cleanAnyString(notification.Metadata["rejectStrategy"]) == "to_previous")
		if pending {
			result = append(result, notification)
		}
	}
	return result
}

func (a *Adapter) pendingActionableLifecycleOutbox(ctx context.Context, limit int) (InstanceAPIResponse, string, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, version_no, actionable_key, expected_version, next_version, next_state, recipients, prerequisite_notifications
		FROM flow_actionable_outbox o
		WHERE o.delivery_status = 'pending'
		  AND o.attempt_count < 12
		  AND (o.depends_on_notification_outbox_id IS NULL OR EXISTS (
		    SELECT 1 FROM flow_notification_outbox dependency
		    WHERE dependency.id = o.depends_on_notification_outbox_id
		      AND dependency.instance_id = o.instance_id
		      AND dependency.delivery_status = 'delivered'
		  ))
		  -- A lifecycle CAS needs its projection; a non-NULL action also waits
		  -- for new-key notifications created by that same action.
		  AND NOT EXISTS (
		    SELECT 1 FROM flow_notification_outbox n
		    WHERE n.instance_id = o.instance_id
		      AND (n.actionable_key = o.actionable_key OR (o.action_id IS NOT NULL AND n.action_id = o.action_id))
		      AND n.delivery_status <> 'delivered'
		  )
		  AND (attempt_count = 0 OR last_attempt_at IS NULL OR
		       TIMESTAMPDIFF(SECOND, last_attempt_at, NOW()) >= CASE
		         WHEN attempt_count = 1 THEN 600
		         WHEN attempt_count = 2 THEN 1200
		         WHEN attempt_count = 3 THEN 2400
		         ELSE 3600
		       END)
		ORDER BY id
		LIMIT ?
	`, limit)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	effects := make([]WorkflowActionableLifecycle, 0, len(rows))
	for _, row := range rows {
		var recipients []string
		if err := json.Unmarshal([]byte(cleanAnyString(row["recipients"])), &recipients); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		var prerequisiteNotifications []WorkflowNotification
		if raw := cleanAnyString(row["prerequisite_notifications"]); raw != "" {
			if err := json.Unmarshal([]byte(raw), &prerequisiteNotifications); err != nil {
				return InstanceAPIResponse{}, "", err
			}
		}
		effects = append(effects, WorkflowActionableLifecycle{
			EffectID:                  anyInt64(row["id"]),
			VersionNo:                 anyInt64(row["version_no"]),
			ActionableKey:             cleanAnyString(row["actionable_key"]),
			ExpectedVersion:           cleanAnyString(row["expected_version"]),
			NextVersion:               cleanAnyString(row["next_version"]),
			State:                     cleanAnyString(row["next_state"]),
			Recipients:                uniqueSortedUIDs(recipients),
			PrerequisiteNotifications: prerequisiteNotifications,
		})
	}
	return InstanceAPIResponse{Code: 0, Data: effects}, "workflow.actionable_lifecycle.pending", nil
}

func (a *Adapter) acknowledgeActionableLifecycleOutbox(ctx context.Context, effectID string, body map[string]any) (InstanceAPIResponse, string, error) {
	return a.acknowledgeWorkflowDelivery(ctx, workflowActionableDelivery, effectID, body)
}

func (a *Adapter) failActionableLifecycleOutbox(ctx context.Context, effectID string, body map[string]any) (InstanceAPIResponse, string, error) {
	return a.failWorkflowDelivery(ctx, workflowActionableDelivery, effectID, body)
}
