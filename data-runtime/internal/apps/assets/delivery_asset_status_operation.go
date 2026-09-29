package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	assetsAltocStatusOperationCode = "assets.delivery-asset.status-sync.v1"
	assetsAltocStatusCapability    = "altoc:contract:delivery-asset-status:sync"
	assetsIntegrationLease         = time.Minute
)

func (a *Adapter) enqueueAltocDeliveryAssetStatusOperationTx(ctx context.Context, tx *sql.Tx, asset map[string]any, body map[string]any, actor string) (map[string]any, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "assets")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets integration operation context is required")
	}
	assetCode := strings.TrimSpace(fmt.Sprint(asset["delivery_asset_code"]))
	status := strings.TrimSpace(fmt.Sprint(asset["status"]))
	if assetCode == "" || status == "" {
		return nil, httperror.New(http.StatusConflict, "delivery_asset_status_identity_missing", "formal delivery asset code and status are required")
	}
	facts := map[string]any{
		"deliveryAssetCode": assetCode,
		"sourcePlanCode":    nullableAssetsText(assetText(asset, "source_plan_code")),
		"customerCode":      nullableAssetsText(assetText(asset, "customer_code")),
		"contractCode":      nullableAssetsText(assetText(asset, "contract_code")),
		"contractLineCode":  nullableAssetsText(assetText(asset, "contract_line_code")),
		"projectCode":       nullableAssetsText(assetText(asset, "project_code")),
		"environmentCode":   nullableAssetsText(assetText(asset, "environment_code")),
		"status":            status,
		"deliveredAt":       asset["delivered_at"],
		"goLiveAt":          asset["go_live_at"],
		"acceptedAt":        asset["accepted_at"],
	}
	factsSHA, err := integrationoperation.ValidateAndDigestCommand(facts)
	if err != nil {
		return nil, err
	}
	revision := uint64(asInt(asset["altoc_status_sync_revision"]))
	storedFingerprint := assetText(asset, "altoc_status_sync_fingerprint")
	occurredAt := asset["altoc_status_sync_occurred_at"]
	revision, changed := nextAssetsStatusRevision(revision, storedFingerprint, factsSHA)
	if changed {
		if _, err := tx.ExecContext(ctx, `UPDATE customer_delivery_assets SET altoc_status_sync_revision=?,altoc_status_sync_fingerprint=?,altoc_status_sync_occurred_at=UTC_TIMESTAMP(3) WHERE id=?`, revision, factsSHA, asset["id"]); err != nil {
			return nil, err
		}
		if err := tx.QueryRowContext(ctx, `SELECT altoc_status_sync_occurred_at FROM customer_delivery_assets WHERE id=?`, asset["id"]).Scan(&occurredAt); err != nil {
			return nil, err
		}
	}
	operationKey := fmt.Sprintf("assets:delivery-asset:%s:altoc-status:revision:%d:v1", assetCode, revision)
	command := facts
	command["sourceRevision"] = revision
	command["occurredAt"] = occurredAt
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	createdBy := strings.TrimSpace(actor)
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	result, err := tx.ExecContext(ctx, trusted.SQL(`INSERT IGNORE INTO integration_operation (
		operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,
		operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,
		command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by
	) VALUES (?,?,?,1,?,?,'assets','altoc',?,?,'customer_delivery_asset',?,?,'v1',?,?,'pending',?,?,?,?,?)`),
		operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
		assetsAltocStatusOperationCode, assetsAltocStatusCapability, assetCode, operationKey, string(commandJSON), commandSHA,
		nullableAssetsText(trusted.RequestID), nullableAssetsText(actor), nullableAssetsText(trusted.ServiceClientID), nullableAssetsText(createdBy), nullableAssetsText(createdBy))
	if err != nil {
		return nil, err
	}
	created, _ := result.RowsAffected()
	var storedID, storedSHA, storedStatus string
	if err := tx.QueryRowContext(ctx, trusted.SQL(`SELECT operation_id,command_sha256,status FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='assets' AND operation_key=? LIMIT 1`), trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&storedID, &storedSHA, &storedStatus); err != nil {
		return nil, err
	}
	if storedSHA != commandSHA {
		return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing Assets status operation has different formal evidence")
	}
	return map[string]any{"operationId": storedID, "operationKey": operationKey, "status": storedStatus, "created": created == 1}, nil
}

func nextAssetsStatusRevision(current uint64, storedFingerprint, nextFingerprint string) (uint64, bool) {
	if current > 0 && storedFingerprint == nextFingerprint {
		return current, false
	}
	return current + 1, true
}

func (a *Adapter) handleAssetsIntegrationOperation(ctx context.Context, method, path string, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch {
	case path == "/v1/assets/integration-operations:pending-dead-letter-actionables":
		data, err := a.listPendingAssetsDeadLetterActionables(ctx, body)
		return ok(data), "assets.integration_operations.dead_letter_actionables.list", true, err
	case path == "/v1/assets/integration-operations:pending-dead-letter-closures":
		data, err := a.listPendingAssetsDeadLetterClosures(ctx, body)
		return ok(data), "assets.integration_operations.dead_letter_closures.list", true, err
	case path == "/v1/assets/integration-operations:claim-next":
		data, err := a.claimAssetsIntegrationOperation(ctx, "", body)
		return ok(data), "assets.integration_operations.claim_next", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":replay"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":replay")
		data, err := a.replayAssetsIntegrationOperation(ctx, operationID, body)
		return ok(data), "assets.integration_operations.replay", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":dead-letter-actionable-published"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":dead-letter-actionable-published")
		data, err := a.markAssetsDeadLetterActionablePublished(ctx, operationID, body)
		return ok(data), "assets.integration_operations.dead_letter_actionables.mark", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":dead-letter-closure-acknowledged"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":dead-letter-closure-acknowledged")
		data, err := a.markAssetsDeadLetterClosureAcknowledged(ctx, operationID, body)
		return ok(data), "assets.integration_operations.dead_letter_closures.mark", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":claim"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":claim")
		data, err := a.claimAssetsIntegrationOperation(ctx, key, body)
		return ok(data), "assets.integration_operations.claim", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":succeed"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":succeed")
		data, err := a.succeedAssetsIntegrationOperation(ctx, key, body)
		return ok(data), "assets.integration_operations.succeed", true, err
	case strings.HasPrefix(path, "/v1/assets/integration-operations/") && strings.HasSuffix(path, ":fail"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/assets/integration-operations/"), ":fail")
		data, err := a.failAssetsIntegrationOperation(ctx, key, body)
		return ok(data), "assets.integration_operations.fail", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) listPendingAssetsDeadLetterActionables(ctx context.Context, body map[string]any) (map[string]any, error) {
	trusted, _, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	limit, err := assetsIntegrationOperationLimit(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "assets", limit, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{
			"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "assets",
			"targetApp": item.TargetApp, "operationId": item.OperationID, "operationCode": item.OperationCode,
			"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
			"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
			"lastErrorCode": nullableAssetsText(item.LastErrorCode), "lastErrorClass": nullableAssetsText(item.LastErrorClass),
			"deadLetteredAt": item.DeadLetteredAt.UTC().Format(time.RFC3339Nano), "originalActorUid": nullableAssetsText(item.OriginalActorUID),
			"generation": item.Generation, "operationVersion": item.OperationVersion,
			"actionableKey": item.ActionableKey, "objectVersion": item.ObjectVersion,
		})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markAssetsDeadLetterActionablePublished(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	trusted, _, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := assetsUint64BodyValue(body, "generation")
	operationVersion, versionErr := assetsUint64BodyValue(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion, ActionableKey: assetsIntegrationOperationText(body, "actionableKey", "actionable_key"),
		ObjectVersion: assetsIntegrationOperationText(body, "objectVersion", "object_version"), NotificationID: assetsIntegrationOperationText(body, "notificationId", "notification_id"),
		RecipientUIDs: assetsStringSlice(body["recipientUids"], body["recipient_uids"]), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "assets"}, nil
}

func (a *Adapter) listPendingAssetsDeadLetterClosures(ctx context.Context, body map[string]any) (map[string]any, error) {
	trusted, _, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	limit, err := assetsIntegrationOperationLimit(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterClosures(ctx, trusted.TenantCode, trusted.DeploymentCode, "assets", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "assets", "operationId": item.OperationID, "generation": item.Generation, "actionableKey": item.ActionableKey, "expectedVersion": item.ExpectedVersion, "nextVersion": item.NextVersion, "state": item.State, "recipientUids": item.RecipientUIDs})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markAssetsDeadLetterClosureAcknowledged(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	trusted, _, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := assetsUint64BodyValue(body, "generation")
	if generationErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets", OperationID: strings.TrimSpace(operationID), Generation: generation,
		ActionableKey: assetsIntegrationOperationText(body, "actionableKey", "actionable_key"), ExpectedVersion: assetsIntegrationOperationText(body, "expectedVersion", "expected_version"),
		NextVersion: assetsIntegrationOperationText(body, "nextVersion", "next_version"), State: assetsIntegrationOperationText(body, "state"), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "assets"}, nil
}

func (a *Adapter) replayAssetsIntegrationOperation(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := requireAssetsIntegrationOperationAction(body, "replay"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "assets")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets integration operation context is missing or invalid")
	}
	actor := assetsIntegrationOperationText(body, "current_user", "operator_uid")
	expectedVersion, versionErr := assetsUint64BodyValue(body, "expectedVersion", "expected_version")
	reason := assetsIntegrationOperationText(body, "reason")
	if actor == "" || actor == "system" || versionErr != nil || expectedVersion == 0 || reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_replay_invalid", "trusted actor, expectedVersion and reason are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.Replay(ctx, integrationoperation.ReplayInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets", OperationID: strings.TrimSpace(operationID), ExpectedVersion: expectedVersion, ActorUID: actor, Reason: reason, Now: time.Now().UTC()})
	if errors.Is(err, integrationoperation.ErrReplayRejected) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_replay_rejected", "operation is not replayable or its version changed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "assets", "status": string(result.Status), "version": result.Version}, nil
}

func (a *Adapter) claimAssetsIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	trusted, worker, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	var claimed *integrationoperation.ClaimedOperation
	if strings.TrimSpace(operationKey) == "" {
		claimed, err = repository.ClaimNext(ctx, trusted.TenantCode, trusted.DeploymentCode, "assets", worker, time.Now().UTC(), assetsIntegrationLease)
	} else {
		claimed, err = repository.ClaimByOperationKey(ctx, trusted.TenantCode, trusted.DeploymentCode, "assets", operationKey, worker, time.Now().UTC(), assetsIntegrationLease)
	}
	if err != nil || claimed == nil {
		return nil, err
	}
	if claimed.Identity.TargetApp != "altoc" || claimed.Identity.OperationCode != assetsAltocStatusOperationCode || claimed.RequiredCapability != assetsAltocStatusCapability {
		return nil, httperror.New(http.StatusConflict, "integration_operation_identity_mismatch", "claimed operation is not an Assets Altoc status sync")
	}
	var command map[string]any
	if err := json.Unmarshal(claimed.Command, &command); err != nil {
		return nil, err
	}
	return map[string]any{"operationId": claimed.OperationID, "operationKey": claimed.OperationKey, "tenantCode": claimed.Identity.TenantCode,
		"deploymentCode": claimed.Identity.DeploymentCode, "sourceApp": "assets", "targetApp": "altoc", "operationCode": claimed.Identity.OperationCode,
		"requiredCapability": claimed.RequiredCapability, "idempotencyKey": claimed.Identity.IdempotencyKey,
		"commandSchemaVersion": claimed.CommandSchemaVersion, "commandSha256": claimed.Identity.CommandSHA256, "command": command, "fencingToken": claimed.FencingToken}, nil
}

func (a *Adapter) assetsCompletionIdentity(body map[string]any) (integrationoperation.TrustedContext, string, string, uint64, error) {
	trusted, worker, err := trustedAssetsIntegrationWorker(body)
	if err != nil {
		return integrationoperation.TrustedContext{}, "", "", 0, err
	}
	operationID := strings.TrimSpace(fmt.Sprint(body["operationId"]))
	fencing, err := strconv.ParseUint(strings.TrimSpace(fmt.Sprint(body["fencingToken"])), 10, 64)
	if !integrationoperation.IsValidOperationID(operationID) || err != nil || fencing == 0 {
		return integrationoperation.TrustedContext{}, "", "", 0, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId and fencingToken are required")
	}
	return trusted, worker, operationID, fencing, nil
}

func (a *Adapter) validateLeasedAssetsStatusOperation(ctx context.Context, trusted integrationoperation.TrustedContext, worker, operationID, operationKey string, fencing uint64) (map[string]any, error) {
	var targetApp, operationCode string
	var commandJSON []byte
	err := a.DB().QueryRowContext(ctx, trusted.SQL(`SELECT target_app,operation_code,command_json FROM integration_operation WHERE operation_id=? AND operation_key=? AND tenant_code=? AND deployment_code=? AND source_app='assets' AND status='processing' AND locked_by=? AND fencing_token=? LIMIT 1`), operationID, operationKey, trusted.TenantCode, trusted.DeploymentCode, worker, fencing).Scan(&targetApp, &operationCode, &commandJSON)
	if err != nil || targetApp != "altoc" || operationCode != assetsAltocStatusOperationCode {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "Assets status operation lease is stale")
	}
	var command map[string]any
	if json.Unmarshal(commandJSON, &command) != nil {
		return nil, httperror.New(http.StatusConflict, "integration_operation_command_invalid", "stored Assets status command is invalid")
	}
	return command, nil
}

func (a *Adapter) succeedAssetsIntegrationOperation(ctx context.Context, key string, body map[string]any) (map[string]any, error) {
	trusted, worker, operationID, fencing, err := a.assetsCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	command, err := a.validateLeasedAssetsStatusOperation(ctx, trusted, worker, operationID, key, fencing)
	if err != nil {
		return nil, err
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	targetCode := fmt.Sprintf("%s:revision:%d", strings.TrimSpace(fmt.Sprint(command["deliveryAssetCode"])), uint64(assetNumber(command["sourceRevision"])))
	receipt := integrationoperation.ReceiptEvidence{ReceiptID: strings.TrimSpace(fmt.Sprint(body["targetReceiptId"])), OperationID: strings.TrimSpace(fmt.Sprint(body["receiptOperationId"])), OperationCode: strings.TrimSpace(fmt.Sprint(body["receiptOperationCode"])), IdempotencyKey: strings.TrimSpace(fmt.Sprint(body["receiptIdempotencyKey"])), CommandSchemaVersion: strings.TrimSpace(fmt.Sprint(body["receiptCommandSchemaVersion"])), CommandSHA256: strings.TrimSpace(fmt.Sprint(body["receiptCommandSha256"])), TargetBizType: strings.TrimSpace(fmt.Sprint(body["targetBizType"])), TargetBizCode: strings.TrimSpace(fmt.Sprint(body["targetBizCode"])), ResponseSummarySHA256: strings.TrimSpace(fmt.Sprint(body["responseSummarySha256"]))}
	if err := integrationoperation.ValidateReceiptEvidence(integrationoperation.ReceiptEvidence{OperationID: operationID, OperationCode: assetsAltocStatusOperationCode, IdempotencyKey: key, CommandSchemaVersion: "v1", CommandSHA256: commandSHA, TargetBizType: "contract_delivery_asset_status", TargetBizCode: targetCode}, receipt); err != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "Altoc receipt does not match leased Assets operation")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordSuccess(ctx, integrationoperation.RecordSuccessInput{Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencing}, Now: time.Now().UTC(), HTTPStatus: http.StatusOK, TargetReceiptID: receipt.ReceiptID, TargetBizType: receipt.TargetBizType, TargetBizCode: receipt.TargetBizCode, ResponseSummarySHA256: receipt.ResponseSummarySHA256})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": key, "status": string(result.Status), "version": result.Version}, nil
}

func (a *Adapter) failAssetsIntegrationOperation(ctx context.Context, key string, body map[string]any) (map[string]any, error) {
	trusted, worker, operationID, fencing, err := a.assetsCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	if _, err := a.validateLeasedAssetsStatusOperation(ctx, trusted, worker, operationID, key, fencing); err != nil {
		return nil, err
	}
	failure := integrationoperation.FailureInput{HTTPStatus: int(assetNumber(body["httpStatus"]))}
	if body["timedOut"] == true {
		failure.Err = context.DeadlineExceeded
	} else if body["networkError"] == true {
		failure.Err = errors.New("network error")
	}
	switch strings.TrimSpace(fmt.Sprint(body["conflictDisposition"])) {
	case "processing":
		failure.ConflictDisposition = integrationoperation.ConflictInProgress
	case "idempotent_success":
		failure.ConflictDisposition = integrationoperation.ConflictIdempotentExisting
	case "payload_mismatch", "binding_conflict", "permanent":
		failure.ConflictDisposition = integrationoperation.ConflictPermanent
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordFailure(ctx, integrationoperation.RecordFailureInput{Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencing}, Now: time.Now().UTC(), Failure: failure, ErrorCode: strings.TrimSpace(fmt.Sprint(body["errorCode"])), ErrorSummary: strings.TrimSpace(fmt.Sprint(body["errorSummary"])), DeliveryUncertain: body["deliveryUncertain"] == true})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": key, "status": string(result.Status), "version": result.Version}, nil
}

func trustedAssetsIntegrationWorker(body map[string]any) (integrationoperation.TrustedContext, string, error) {
	if !hasAssetsIntegrationScope(body["current_user_scopes"]) {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "insufficient_scope", "assets:integration_operation:execute scope is required")
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "assets")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets worker context is required")
	}
	worker := "assets:" + trusted.ServiceClientID + ":" + trusted.RequestID
	if len(worker) > 240 {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "Assets worker identity is too long")
	}
	return trusted, worker, nil
}

func hasAssetsIntegrationScope(value any) bool {
	for _, scope := range strings.FieldsFunc(fmt.Sprint(value), func(r rune) bool { return r == ',' || r == ' ' || r == '[' || r == ']' }) {
		if scope == "*" || scope == "assets.*" || scope == "assets:integration_operation:execute" {
			return true
		}
	}
	return false
}
func assetText(row map[string]any, key string) string {
	value := strings.TrimSpace(fmt.Sprint(row[key]))
	if value == "<nil>" {
		return ""
	}
	return value
}
func firstNonEmptyAssetText(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := assetText(row, key); value != "" {
			return value
		}
	}
	return ""
}
func statusTimestampColumn(status string) string {
	switch status {
	case "accepted":
		return "accepted_at"
	case "online":
		return "go_live_at"
	default:
		return "delivered_at"
	}
}
func nullableAssetsText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
func assetNumber(value any) float64 {
	parsed, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	return parsed
}
