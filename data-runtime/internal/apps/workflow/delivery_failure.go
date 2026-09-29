package workflow

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workflowDeliveryKind struct {
	table         string
	statusColumn  string
	attemptColumn string
	maxAttempts   int
	backoffColumn string
	backoffValue  string
	label         string
}

var (
	workflowNotificationDelivery = workflowDeliveryKind{"flow_notification_outbox", "delivery_status", "attempt_count", 12, "last_attempt_at", "NOW()", "notification"}
	workflowActionableDelivery   = workflowDeliveryKind{"flow_actionable_outbox", "delivery_status", "attempt_count", 12, "last_attempt_at", "NOW()", "actionable"}
	workflowCallbackDelivery     = workflowDeliveryKind{"flow_callback_logs", "status", "attempts", 20, "next_attempt_at", "DATE_ADD(NOW(), INTERVAL 60 SECOND)", "callback"}
)

func workflowDeliveryFailureCode(body map[string]any) string {
	code := cleanAnyString(body["code"])
	switch code {
	case "actionable_not_found", "console_actionable_lifecycle_failed", "notification_publish_incomplete",
		"notification_delivery_failed", "invalid_callback_target", "local_callback_target_unavailable",
		"callback_app_url_unavailable", "callback_delivery_failed":
		return code
	}
	return "delivery_failed"
}

func workflowDeliveryHTTPStatus(body map[string]any) any {
	status := anyInt64(body["http_status"])
	if status >= 100 && status <= 599 {
		return status
	}
	return nil
}

func (a *Adapter) failWorkflowDelivery(ctx context.Context, kind workflowDeliveryKind, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_delivery_effect_id", "invalid delivery effect id")
	}
	tenant := cleanAnyString(body["hzy_runtime_tenant_code"])
	deployment := cleanAnyString(body["hzy_runtime_deployment_code"])
	actor := cleanAnyString(body["hzy_runtime_service_client_id"])
	if tenant == "" || deployment == "" || actor == "" || len(actor) > 191 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "workflow_delivery_context_required", "trusted delivery context required")
	}
	expectedVersion := anyInt64(body["expectedEffectVersion"])
	if expectedVersion <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "delivery_effect_version_required", "observed delivery effect version required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer tx.Rollback()
	var status string
	var attempts, version int64
	selectSQL := fmt.Sprintf("SELECT %s, %s, version_no FROM %s WHERE id = ? FOR UPDATE", kind.statusColumn, kind.attemptColumn, kind.table)
	if err := tx.QueryRowContext(ctx, selectSQL, id).Scan(&status, &attempts, &version); err != nil {
		if err == sql.ErrNoRows {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "delivery_effect_not_found", "delivery effect not found")
		}
		return InstanceAPIResponse{}, "", err
	}
	if status == "delivered" || status == "success" {
		return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "pending": false, "failed": false, "abandoned": false}}, "workflow." + kind.label + ".fail", tx.Commit()
	}
	if version != expectedVersion {
		return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "versionConflict": true, "pending": status == "pending" || status == "failed", "abandoned": status == "abandoned"}}, "workflow." + kind.label + ".fail", tx.Commit()
	}
	if status == "abandoned" {
		return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "pending": false, "failed": false, "abandoned": true}}, "workflow." + kind.label + ".fail", tx.Commit()
	}
	if status != "pending" && !(kind.label == "callback" && status == "failed") {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusConflict, "invalid_delivery_status", "delivery effect status conflict")
	}
	newAttempts := attempts + 1
	newStatus := status
	eventCode := "retry"
	if newAttempts >= int64(kind.maxAttempts) {
		newStatus = "abandoned"
		eventCode = "abandon"
	} else if kind.label == "callback" {
		newStatus = "failed"
	}
	code := workflowDeliveryFailureCode(body)
	legacyErrorReset := ""
	if kind.label == "callback" {
		legacyErrorReset = "last_error = NULL,"
	}
	updateSQL := fmt.Sprintf(`UPDATE %s SET %s = ?, %s = ?, version_no = version_no + 1,
		last_error_code = ?, last_http_status = ?, %s = %s,
		abandoned_at = CASE WHEN ? = 'abandoned' THEN NOW() ELSE abandoned_at END,
		%s updated_at = NOW()
		WHERE id = ? AND %s = ? AND version_no = ?`, kind.table, kind.statusColumn, kind.attemptColumn, kind.backoffColumn, kind.backoffValue, legacyErrorReset, kind.statusColumn)
	result, err := tx.ExecContext(ctx, updateSQL, newStatus, newAttempts, code, workflowDeliveryHTTPStatus(body), newStatus, id, status, version)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return InstanceAPIResponse{}, "", fmt.Errorf("workflow delivery version conflict: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO flow_delivery_audit
		(delivery_kind,effect_id,event_code,prior_status,next_status,prior_version_no,next_version_no,
		 attempt_count,actor_code,reason_code,tenant_code,deployment_code)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, kind.label, id, eventCode, status, newStatus, version, version+1,
		newAttempts, actor, code, tenant, deployment); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "pending": newStatus == "pending" || newStatus == "failed", "failed": kind.label == "callback" && newStatus == "failed", "abandoned": newStatus == "abandoned"}}, "workflow." + kind.label + ".fail", nil
}

func (a *Adapter) recoverWorkflowDelivery(ctx context.Context, kind workflowDeliveryKind, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_delivery_effect_id", "invalid delivery effect id")
	}
	tenant := cleanAnyString(body["hzy_runtime_tenant_code"])
	deployment := cleanAnyString(body["hzy_runtime_deployment_code"])
	actor := cleanAnyString(body["hzy_runtime_service_client_id"])
	credentialID := anyInt64(body["hzy_runtime_credential_id"])
	requestID := cleanAnyString(body["hzy_runtime_request_id"])
	reason := strings.TrimSpace(cleanAnyString(body["reason"]))
	expectedVersion := anyInt64(body["expectedVersion"])
	if tenant == "" || deployment == "" || actor != "workflow.maintenance" || credentialID <= 0 ||
		requestID == "" || len(requestID) > 191 || reason == "" || len([]rune(reason)) > 200 || expectedVersion <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "workflow_delivery_context_required", "trusted delivery context required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer tx.Rollback()
	var status string
	var attempts, version int64
	selectSQL := fmt.Sprintf("SELECT %s, %s, version_no FROM %s WHERE id = ? FOR UPDATE", kind.statusColumn, kind.attemptColumn, kind.table)
	if err := tx.QueryRowContext(ctx, selectSQL, id).Scan(&status, &attempts, &version); err != nil {
		if err == sql.ErrNoRows {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "delivery_effect_not_found", "delivery effect not found")
		}
		return InstanceAPIResponse{}, "", err
	}
	if status != "abandoned" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusConflict, "delivery_effect_not_abandoned", "delivery effect is not abandoned")
	}
	if version != expectedVersion {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusConflict, "delivery_effect_version_conflict", "delivery effect version changed")
	}
	updateSQL := fmt.Sprintf(`UPDATE %s SET %s = 'pending', %s = 0, version_no = version_no + 1,
		%s = NULL, abandoned_at = NULL, updated_at = NOW()
		WHERE id = ? AND %s = 'abandoned' AND version_no = ?`, kind.table, kind.statusColumn,
		kind.attemptColumn, kind.backoffColumn, kind.statusColumn)
	result, err := tx.ExecContext(ctx, updateSQL, id, version)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return InstanceAPIResponse{}, "", fmt.Errorf("workflow recovery version conflict: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO flow_delivery_audit
		(delivery_kind,effect_id,event_code,prior_status,next_status,prior_version_no,next_version_no,
		 attempt_count,actor_code,reason_code,tenant_code,deployment_code,credential_id,request_id,recovery_reason)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, kind.label, id, "recover", "abandoned", "pending", version, version+1,
		attempts, actor, "manual_recovery", tenant, deployment, credentialID, requestID, reason); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"effect_id": id, "status": "pending", "version_no": version + 1}}, "workflow." + kind.label + ".recover", nil
}

func (a *Adapter) acknowledgeWorkflowDelivery(ctx context.Context, kind workflowDeliveryKind, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_delivery_effect_id", "invalid delivery effect id")
	}
	tenant := cleanAnyString(body["hzy_runtime_tenant_code"])
	deployment := cleanAnyString(body["hzy_runtime_deployment_code"])
	actor := cleanAnyString(body["hzy_runtime_service_client_id"])
	if tenant == "" || deployment == "" || actor == "" || len(actor) > 191 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "workflow_delivery_context_required", "trusted delivery context required")
	}
	expectedVersion := anyInt64(body["expectedEffectVersion"])
	if expectedVersion <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "delivery_effect_version_required", "observed delivery effect version required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer tx.Rollback()
	var status string
	var attempts, version int64
	selectSQL := fmt.Sprintf("SELECT %s, %s, version_no FROM %s WHERE id = ? FOR UPDATE", kind.statusColumn, kind.attemptColumn, kind.table)
	if err := tx.QueryRowContext(ctx, selectSQL, id).Scan(&status, &attempts, &version); err != nil {
		if err == sql.ErrNoRows {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "delivery_effect_not_found", "delivery effect not found")
		}
		return InstanceAPIResponse{}, "", err
	}
	if status == "delivered" || status == "success" {
		return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "status": status, "acknowledged": false}}, "workflow." + kind.label + ".ack", tx.Commit()
	}
	// A successful external delivery wins over a concurrent failure of the
	// observed version. The supplied version is mandatory, but ack uses the
	// current row version while the effect remains retryable.
	if status != "pending" && !(kind.label == "callback" && status == "failed") {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusConflict, "delivery_effect_not_pending", "delivery effect is not pending")
	}
	nextStatus := "delivered"
	updateSQL := fmt.Sprintf(`UPDATE %s SET %s = 'delivered', version_no = version_no + 1,
		delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW()
		WHERE id = ? AND %s = ? AND version_no = ?`, kind.table, kind.statusColumn, kind.statusColumn)
	nextAttempts := attempts
	if kind.label == "callback" {
		nextStatus = "success"
		nextAttempts++
		updateSQL = `UPDATE flow_callback_logs SET status='success', attempts=?, version_no=version_no+1,
			last_error=NULL, next_attempt_at=NULL, updated_at=NOW()
			WHERE id=? AND status=? AND version_no=?`
	}
	var result sql.Result
	if kind.label == "callback" {
		result, err = tx.ExecContext(ctx, updateSQL, nextAttempts, id, status, version)
	} else {
		result, err = tx.ExecContext(ctx, updateSQL, id, status, version)
	}
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return InstanceAPIResponse{}, "", fmt.Errorf("workflow acknowledge version conflict: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO flow_delivery_audit
		(delivery_kind,effect_id,event_code,prior_status,next_status,prior_version_no,next_version_no,
		 attempt_count,actor_code,reason_code,tenant_code,deployment_code)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, kind.label, id, "ack", status, nextStatus, version, version+1,
		nextAttempts, actor, "delivered", tenant, deployment); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "effect_id": id, "status": nextStatus, "acknowledged": true}}, "workflow." + kind.label + ".ack", nil
}
