package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const lifecycleNotificationRecipientsSetting = "notification.authorizationLifecycleRecipients"

type lifecycleActionableCandidate struct {
	OperationID      string   `json:"operationId"`
	UID              string   `json:"uid"`
	OperationCode    string   `json:"operationCode"`
	OriginalActorUID *string  `json:"originalActorUid"`
	Recipients       []string `json:"recipients"`
	Generation       uint64   `json:"generation"`
	ActionableKey    string   `json:"actionableKey"`
	ObjectVersion    string   `json:"objectVersion"`
	IdempotencyKey   string   `json:"idempotencyKey"`
}

type lifecycleActionableClosure struct {
	OperationID   string `json:"operationId"`
	UID           string `json:"uid"`
	OperationCode string `json:"operationCode"`
	Status        string `json:"status"`
	Generation    uint64 `json:"generation"`
	ActionableKey string `json:"actionableKey"`
	ObjectVersion string `json:"objectVersion"`
}

func (a *Adapter) PreparePlatformLifecycleActionables(
	ctx context.Context,
	tenant string,
	deployment string,
	limit int,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 10 {
		limit = 10
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO console_platform_lifecycle_actionables
			(operation_id,generation,actionable_key,object_version,created_at,updated_at)
		SELECT operation_id,1,'','',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
		FROM integration_operation
		WHERE tenant_code=? AND deployment_code=? AND source_app='console' AND target_app='platform'
			AND status='dead_letter' AND operation_code IN (?,?)
		ORDER BY updated_at,operation_id LIMIT ?`,
		tenant, deployment, platformEmploymentSyncCode, platformOffboardingCode, limit)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT operation.operation_id,operation.source_biz_code,operation.operation_code,actionable.generation
		FROM integration_operation operation
		INNER JOIN console_platform_lifecycle_actionables actionable
			ON actionable.operation_id=operation.operation_id
		WHERE operation.tenant_code=? AND operation.deployment_code=?
			AND operation.source_app='console' AND operation.target_app='platform'
			AND operation.status='dead_letter'
			AND (actionable.actionable_key='' OR actionable.object_version='')
		ORDER BY operation.updated_at,operation.operation_id LIMIT ?`,
		tenant, deployment, limit)
	if err != nil {
		return nil, err
	}
	type incomplete struct {
		operationID   string
		uid           string
		operationCode string
		generation    uint64
	}
	incompleteRows := make([]incomplete, 0)
	for rows.Next() {
		var row incomplete
		if err := rows.Scan(&row.operationID, &row.uid, &row.operationCode, &row.generation); err != nil {
			rows.Close()
			return nil, err
		}
		incompleteRows = append(incompleteRows, row)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, row := range incompleteRows {
		actionableKey, objectVersion, _, identityErr := platformLifecycleActionableIdentity(
			row.operationID, row.uid, row.operationCode, row.generation,
		)
		if identityErr != nil {
			return nil, identityErr
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE console_platform_lifecycle_actionables
			SET actionable_key=?,object_version=?,updated_at=UTC_TIMESTAMP(3)
			WHERE operation_id=? AND generation=? AND actionable_key='' AND object_version=''`,
			actionableKey, objectVersion, row.operationID, row.generation)
		if err != nil {
			return nil, err
		}
	}
	candidateRows, err := tx.QueryContext(ctx, `
		SELECT operation.operation_id,operation.source_biz_code,operation.operation_code,
			operation.original_actor_uid,actionable.recipient_uids_json,actionable.generation,
			actionable.actionable_key,actionable.object_version
		FROM integration_operation operation
		INNER JOIN console_platform_lifecycle_actionables actionable
			ON actionable.operation_id=operation.operation_id
		WHERE operation.tenant_code=? AND operation.deployment_code=?
			AND operation.source_app='console' AND operation.target_app='platform'
			AND operation.status='dead_letter' AND actionable.notification_id IS NULL
		ORDER BY operation.updated_at,operation.operation_id LIMIT ?`,
		tenant, deployment, limit)
	if err != nil {
		return nil, err
	}
	type scannedCandidate struct {
		item           lifecycleActionableCandidate
		actor          sql.NullString
		recipientsJSON []byte
	}
	scannedCandidates := make([]scannedCandidate, 0)
	for candidateRows.Next() {
		var row scannedCandidate
		if err := candidateRows.Scan(
			&row.item.OperationID, &row.item.UID, &row.item.OperationCode, &row.actor, &row.recipientsJSON,
			&row.item.Generation, &row.item.ActionableKey, &row.item.ObjectVersion,
		); err != nil {
			candidateRows.Close()
			return nil, err
		}
		scannedCandidates = append(scannedCandidates, row)
	}
	if err := candidateRows.Close(); err != nil {
		return nil, err
	}
	candidates := make([]lifecycleActionableCandidate, 0, len(scannedCandidates))
	for _, row := range scannedCandidates {
		item := row.item
		if row.actor.Valid {
			value := row.actor.String
			item.OriginalActorUID = &value
		}
		item.Recipients = parseLifecycleRecipientsJSON(row.recipientsJSON)
		if len(item.Recipients) == 0 {
			item.Recipients, err = a.resolveLifecycleActionableRecipientsTx(ctx, tx, item.UID, row.actor)
			if err != nil {
				return nil, err
			}
			if len(item.Recipients) > 0 {
				encoded, _ := json.Marshal(item.Recipients)
				if _, err := tx.ExecContext(ctx, `
					UPDATE console_platform_lifecycle_actionables
					SET recipient_uids_json=CAST(? AS JSON),updated_at=UTC_TIMESTAMP(3)
					WHERE operation_id=? AND generation=? AND recipient_uids_json IS NULL`,
					string(encoded), item.OperationID, item.Generation); err != nil {
					return nil, err
				}
			}
		}
		_, _, item.IdempotencyKey, err = platformLifecycleActionableIdentity(
			item.OperationID, item.UID, item.OperationCode, item.Generation,
		)
		if err != nil {
			return nil, err
		}
		if len(item.Recipients) > 0 {
			candidates = append(candidates, item)
		}
	}
	closureRows, err := tx.QueryContext(ctx, `
		SELECT operation.operation_id,operation.source_biz_code,operation.operation_code,
			operation.status,actionable.generation,actionable.actionable_key,actionable.object_version
		FROM integration_operation operation
		INNER JOIN console_platform_lifecycle_actionables actionable
			ON actionable.operation_id=operation.operation_id
		WHERE operation.tenant_code=? AND operation.deployment_code=?
			AND operation.source_app='console' AND operation.target_app='platform'
			AND actionable.notification_id IS NOT NULL AND actionable.closure_acknowledged_at IS NULL
			AND operation.status<>'dead_letter'
		ORDER BY operation.updated_at,operation.operation_id LIMIT ?`,
		tenant, deployment, limit)
	if err != nil {
		return nil, err
	}
	closures := make([]lifecycleActionableClosure, 0)
	for closureRows.Next() {
		var item lifecycleActionableClosure
		if err := closureRows.Scan(
			&item.OperationID, &item.UID, &item.OperationCode, &item.Status,
			&item.Generation, &item.ActionableKey, &item.ObjectVersion,
		); err != nil {
			closureRows.Close()
			return nil, err
		}
		closures = append(closures, item)
	}
	if err := closureRows.Close(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"candidates": candidates, "closures": closures,
	}}, nil
}

func (a *Adapter) CheckpointPlatformLifecycleActionable(
	ctx context.Context,
	tenant string,
	deployment string,
	body map[string]any,
) (map[string]any, error) {
	tenant, deployment, err := validLifecycleBinding(a.tenant, tenant, deployment)
	if err != nil {
		return nil, err
	}
	operationID := strings.TrimSpace(stringField(body["operationId"]))
	generation := numberField(body["generation"])
	if !lifecycleOperationIDPattern.MatchString(operationID) || generation < 1 {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_actionable_identity_invalid", "actionable identity is invalid")
	}
	checkpoint := strings.TrimSpace(stringField(body["checkpoint"]))
	var result sql.Result
	if checkpoint == "published" {
		notificationID := validNotificationField(body["notificationId"], 128)
		if notificationID == "" {
			return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_notification_id_invalid", "notificationId is invalid")
		}
		result, err = a.db.ExecContext(ctx, `
			UPDATE console_platform_lifecycle_actionables actionable
			INNER JOIN integration_operation operation ON operation.operation_id=actionable.operation_id
			SET actionable.notification_id=?,actionable.published_at=UTC_TIMESTAMP(3),
				actionable.updated_at=UTC_TIMESTAMP(3)
			WHERE operation.tenant_code=? AND operation.deployment_code=?
				AND actionable.operation_id=? AND actionable.generation=?
				AND actionable.notification_id IS NULL`,
			notificationID, tenant, deployment, operationID, generation)
	} else if checkpoint == "closed" {
		state := strings.TrimSpace(stringField(body["state"]))
		if state != "resolved" && state != "cancelled" {
			return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_closure_state_invalid", "closure state is invalid")
		}
		result, err = a.db.ExecContext(ctx, `
			UPDATE console_platform_lifecycle_actionables actionable
			INNER JOIN integration_operation operation ON operation.operation_id=actionable.operation_id
			SET actionable.closure_state=?,actionable.closure_acknowledged_at=UTC_TIMESTAMP(3),
				actionable.updated_at=UTC_TIMESTAMP(3)
			WHERE operation.tenant_code=? AND operation.deployment_code=?
				AND actionable.operation_id=? AND actionable.generation=?
				AND actionable.closure_acknowledged_at IS NULL`,
			state, tenant, deployment, operationID, generation)
	} else {
		return nil, httperror.New(http.StatusBadRequest, "platform_lifecycle_actionable_checkpoint_invalid", "actionable checkpoint is invalid")
	}
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "platform_lifecycle_actionable_checkpoint_stale", "actionable checkpoint is stale")
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"operationId": operationID, "generation": generation, "checkpoint": checkpoint,
	}}, nil
}

func (a *Adapter) resolveLifecycleActionableRecipientsTx(
	ctx context.Context,
	tx *sql.Tx,
	targetUID string,
	actor sql.NullString,
) ([]string, error) {
	if actor.Valid && strings.TrimSpace(actor.String) != "" && strings.TrimSpace(actor.String) != targetUID {
		active, err := activeLifecycleRecipientsTx(ctx, tx, []string{actor.String}, targetUID)
		if err != nil || len(active) > 0 {
			return active, err
		}
	}
	var defaultJSON, valueJSON []byte
	err := tx.QueryRowContext(ctx, `
		SELECT c.default_value_json,v.value_json
		FROM setting_catalogs c
		LEFT JOIN setting_values v ON v.setting_key=c.setting_key AND v.scope_key=?
		WHERE c.setting_key=? AND c.status='active' LIMIT 1`,
		tenantSettingScope, lifecycleNotificationRecipientsSetting).Scan(&defaultJSON, &valueJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	raw := defaultJSON
	if len(valueJSON) > 0 {
		raw = valueJSON
	}
	return activeLifecycleRecipientsTx(ctx, tx, parseLifecycleRecipientsValue(raw), targetUID)
}

func activeLifecycleRecipientsTx(
	ctx context.Context,
	tx *sql.Tx,
	recipients []string,
	targetUID string,
) ([]string, error) {
	safe := make([]string, 0, len(recipients))
	seen := map[string]bool{}
	for _, recipient := range recipients {
		recipient = strings.TrimSpace(recipient)
		if recipient == "" || recipient == targetUID || len(recipient) > 128 || strings.EqualFold(recipient, "@all") || seen[recipient] {
			continue
		}
		seen[recipient] = true
		safe = append(safe, recipient)
	}
	if len(safe) == 0 {
		return nil, nil
	}
	if len(safe) > 100 {
		safe = safe[:100]
	}
	args := make([]any, 0, len(safe))
	for _, recipient := range safe {
		args = append(args, recipient)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT uid FROM directory_users
		WHERE status='active' AND uid IN (`+strings.TrimSuffix(strings.Repeat("?,", len(safe)), ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	active := map[string]bool{}
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		active[uid] = true
	}
	result := make([]string, 0, len(active))
	for _, recipient := range safe {
		if active[recipient] {
			result = append(result, recipient)
		}
	}
	return result, rows.Err()
}

func platformLifecycleActionableIdentity(
	operationID string,
	uid string,
	operationCode string,
	generation uint64,
) (string, string, string, error) {
	if !lifecycleOperationIDPattern.MatchString(operationID) || strings.TrimSpace(uid) == "" || len(uid) > 128 || generation < 1 {
		return "", "", "", httperror.New(http.StatusConflict, "platform_lifecycle_actionable_identity_invalid", "stored actionable identity is invalid")
	}
	if operationCode != platformEmploymentSyncCode && operationCode != platformOffboardingCode {
		return "", "", "", httperror.New(http.StatusConflict, "platform_lifecycle_operation_code_invalid", "stored lifecycle operation code is invalid")
	}
	stable := sha256.Sum256([]byte(strings.Join([]string{
		"console", "platform-lifecycle", strings.ToLower(operationID), strconv.FormatUint(generation, 10),
	}, "\n")))
	digest := hex.EncodeToString(stable[:])
	return "console:platform-lifecycle:" + digest[:48] + ":g" + strconv.FormatUint(generation, 10),
		"dead-letter:g" + strconv.FormatUint(generation, 10),
		"console:platform-lifecycle-dead-letter:" + digest, nil
}

func parseLifecycleRecipientsJSON(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var values []string
	if json.Unmarshal(raw, &values) != nil {
		return nil
	}
	return values
}

func parseLifecycleRecipientsValue(raw []byte) []string {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return nil
	}
	switch typed := value.(type) {
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, stringField(item))
		}
		return result
	case string:
		return strings.Split(typed, ",")
	default:
		return nil
	}
}
