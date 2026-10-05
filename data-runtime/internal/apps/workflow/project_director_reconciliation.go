package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) reconcileAimsMilestoneProjectDirector(ctx context.Context, query url.Values) error {
	uid := strings.TrimSpace(query.Get("current_project_director_uid"))
	revisionText := strings.TrimSpace(query.Get("current_project_director_revision"))
	if uid == "" && revisionText == "" {
		return nil
	}
	revision, err := strconv.ParseInt(revisionText, 10, 64)
	if uid == "" || err != nil || revision <= 0 {
		return httperror.New(http.StatusForbidden, "project_director_binding_invalid", "trusted project director binding is invalid")
	}
	displayName := strings.TrimSpace(query.Get("current_project_director_display_name"))
	if displayName == "" {
		displayName = uid
	}

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := queryMaps(ctx, tx, `
		SELECT t.id, t.instance_id, t.assignee_uid, t.actionable_key, t.actionable_version
		FROM flow_tasks t
		JOIN flow_instances i ON i.id = t.instance_id
		WHERE t.status = 'pending'
		  AND i.status = 'running'
		  AND i.app_code = 'aims'
		  AND i.resource_code = 'milestones'
		  AND i.action_code = 'milestone_completion'
		  AND JSON_UNQUOTE(JSON_EXTRACT(i.form_data, '$.projectDirectorRoleCode')) = 'project_director'
		  AND (
		    t.assignee_uid <> ?
		    OR COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(i.form_data, '$.projectDirectorRevision')) AS UNSIGNED), 0) < ?
		  )
		ORDER BY t.id
		FOR UPDATE
	`, uid, revision)
	if err != nil {
		return err
	}
	for _, row := range rows {
		taskID := cleanAnyString(row["id"])
		instanceID := cleanAnyString(row["instance_id"])
		oldVersion := cleanAnyString(row["actionable_version"])
		actionableKey := cleanAnyString(row["actionable_key"])
		nextVersion := fmt.Sprintf("flow_tasks:project_director:%d:task:%s", revision, taskID)
		if _, err := tx.ExecContext(ctx, `
			UPDATE flow_tasks
			SET assignee_uid = ?, actionable_version = ?, updated_at = NOW()
			WHERE id = ? AND status = 'pending'
		`, uid, nextVersion, taskID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE flow_instances
			SET form_data = JSON_SET(
			      COALESCE(form_data, JSON_OBJECT()),
			      '$.projectDirectorUid', ?,
			      '$.projectDirectorRevision', ?
			    ),
			    flow_snapshot = JSON_SET(
			      flow_snapshot,
			      CONCAT('$.nodes[', current_node, '].resolved_assignees[0].uid'), ?,
			      CONCAT('$.nodes[', current_node, '].resolved_assignees[0].name'), ?
			    ),
			    updated_at = NOW()
			WHERE id = ? AND status = 'running'
		`, uid, revision, uid, displayName, instanceID); err != nil {
			return err
		}
		if actionableKey != "" && oldVersion != "" && oldVersion != nextVersion {
			recipients, _ := json.Marshal([]string{uid})
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO flow_actionable_outbox (
				  instance_id, action_id, actionable_key, expected_version, next_version,
				  next_state, recipients, prerequisite_notifications,
				  delivery_status, attempt_count, created_at, updated_at
				) VALUES (?, NULL, ?, ?, ?, 'pending', ?, '[]', 'pending', 0, NOW(), NOW())
			`, instanceID, actionableKey, oldVersion, nextVersion, string(recipients)); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
