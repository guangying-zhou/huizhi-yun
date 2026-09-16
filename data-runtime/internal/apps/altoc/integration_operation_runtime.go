package altoc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const integrationOperationLease = time.Minute

func (a *Adapter) listPendingDeadLetterActionables(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := intBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "altoc", limit, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{
			"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "altoc", "targetApp": item.TargetApp,
			"operationId": item.OperationID, "operationCode": item.OperationCode, "sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
			"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts, "lastErrorCode": nullableText(item.LastErrorCode), "lastErrorClass": nullableText(item.LastErrorClass),
			"deadLetteredAt": item.DeadLetteredAt.UTC().Format(time.RFC3339Nano), "originalActorUid": nullableText(item.OriginalActorUID),
			"generation": item.Generation, "operationVersion": item.OperationVersion, "actionableKey": item.ActionableKey, "objectVersion": item.ObjectVersion,
		})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markDeadLetterActionablePublished(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := uint64BodyValue(body, "generation")
	operationVersion, versionErr := uint64BodyValue(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"),
		ObjectVersion: firstBodyText(body, "objectVersion", "object_version"), NotificationID: firstBodyText(body, "notificationId", "notification_id"),
		RecipientUIDs: activationStringSlice(body["recipientUids"]), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "altoc"}, nil
}

func (a *Adapter) listPendingDeadLetterClosures(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := intBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterClosures(ctx, trusted.TenantCode, trusted.DeploymentCode, "altoc", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "altoc", "operationId": item.OperationID, "generation": item.Generation, "actionableKey": item.ActionableKey, "expectedVersion": item.ExpectedVersion, "nextVersion": item.NextVersion, "state": item.State, "recipientUids": item.RecipientUIDs})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markDeadLetterClosureAcknowledged(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := uint64BodyValue(body, "generation")
	if generationErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc", OperationID: strings.TrimSpace(operationID), Generation: generation, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"), ExpectedVersion: firstBodyText(body, "expectedVersion", "expected_version"), NextVersion: firstBodyText(body, "nextVersion", "next_version"), State: firstBodyText(body, "state"), Now: time.Now().UTC()})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "altoc"}, nil
}

func (a *Adapter) listIntegrationOperationAttempts(ctx context.Context, operationID string, query url.Values) (map[string]any, error) {
	authBody := altocIntegrationOperationQueryBody(query)
	if err := altocRequireActionScope(authBody, "integration_operations", "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(authBody, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	limit := 100
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be an integer")
		}
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListAttemptTimeline(ctx, integrationoperation.AttemptTimelineInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc",
		OperationID: strings.TrimSpace(operationID), Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "items": items}, nil
}

func (a *Adapter) listPendingIntegrationOperationFailureNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := intBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingFailureNotifications(ctx, trusted.TenantCode, trusted.DeploymentCode, "altoc", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, altocFailureNotificationResponse(item, trusted))
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markIntegrationOperationFailureNotified(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, _, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	notificationID := strings.TrimSpace(firstBodyText(body, "notificationId", "notification_id"))
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkFailureNotified(ctx, integrationoperation.MarkFailureNotifiedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc",
		OperationID: strings.TrimSpace(operationID), NotificationID: notificationID, Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_failure_notification_conflict", "dead-letter notification acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": strings.TrimSpace(operationID), "notificationId": notificationID,
		"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode,
		"sourceApp": "altoc", "failureNotified": marked,
	}, nil
}

func altocFailureNotificationResponse(item integrationoperation.FailureNotificationCandidate, trusted integrationoperation.TrustedContext) map[string]any {
	return map[string]any{
		"operationId": item.OperationID, "operationKey": item.OperationKey,
		"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode,
		"sourceApp": "altoc", "targetApp": item.TargetApp, "operationCode": item.OperationCode,
		"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
		"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
		"lastErrorCode": nullableText(item.LastErrorCode), "lastErrorClass": nullableText(item.LastErrorClass),
		"deadLetteredAt":   item.DeadLetteredAt.UTC().Format(time.RFC3339Nano),
		"originalActorUid": nullableText(item.OriginalActorUID),
	}
}

func (a *Adapter) listIntegrationOperationDiagnostics(ctx context.Context, query url.Values) (map[string]any, error) {
	authBody := altocIntegrationOperationQueryBody(query)
	if err := altocRequireActionScope(authBody, "integration_operations", "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(authBody, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	statuses, err := altocIntegrationOperationStatuses(query.Get("status"))
	if err != nil {
		return nil, err
	}
	limit := integrationoperation.DefaultDiagnosticLimit
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be an integer")
		}
	}
	cursor, err := integrationoperation.DecodeDiagnosticCursor(query.Get("cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_cursor_invalid", "cursor is invalid")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	page, err := repository.ListDiagnostics(ctx, integrationoperation.DiagnosticListInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc",
		Statuses: statuses, Limit: limit, Cursor: cursor,
	})
	if err != nil {
		return nil, err
	}
	nextCursor, err := integrationoperation.EncodeDiagnosticCursor(page.NextCursor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": page.Items, "nextCursor": nullableText(nextCursor)}, nil
}

func (a *Adapter) replayIntegrationOperation(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operations", "replay"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	actor := strings.TrimSpace(firstBodyText(body, "current_user", "operator_uid"))
	expectedVersion, versionErr := uint64BodyValue(body, "expectedVersion", "expected_version")
	reason := strings.TrimSpace(firstBodyText(body, "reason"))
	if actor == "" || actor == "system" || versionErr != nil || expectedVersion == 0 || reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_replay_invalid", "trusted actor, expectedVersion and reason are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.Replay(ctx, integrationoperation.ReplayInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc",
		OperationID: strings.TrimSpace(operationID), ExpectedVersion: expectedVersion,
		ActorUID: actor, Reason: reason, Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrReplayRejected) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_replay_rejected", "operation is not replayable or its version changed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": strings.TrimSpace(operationID), "tenantCode": trusted.TenantCode,
		"deploymentCode": trusted.DeploymentCode, "sourceApp": "altoc",
		"status": string(result.Status), "version": result.Version,
	}, nil
}

func altocIntegrationOperationQueryBody(query url.Values) map[string]any {
	result := map[string]any{
		"current_user":        strings.TrimSpace(query.Get("current_user")),
		"current_user_scopes": strings.Fields(query.Get("current_user_scopes")),
	}
	for _, key := range []string{
		integrationoperation.TrustedTenantCodeKey, integrationoperation.TrustedDeploymentCodeKey,
		integrationoperation.TrustedSourceAppKey, integrationoperation.TrustedServiceClientIDKey,
		integrationoperation.TrustedRequestIDKey,
	} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			result[key] = value
		}
	}
	return result
}

func altocIntegrationOperationStatuses(value string) ([]integrationoperation.Status, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' })
	statuses := make([]integrationoperation.Status, 0, len(parts))
	for _, part := range parts {
		status := integrationoperation.Status(strings.TrimSpace(part))
		if !status.Valid() {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_status_invalid", "status filter is invalid")
		}
		statuses = append(statuses, status)
	}
	return statuses, nil
}

func (a *Adapter) claimNextIntegrationOperation(ctx context.Context, body map[string]any) (map[string]any, error) {
	return a.claimIntegrationOperation(ctx, "", body)
}

func (a *Adapter) claimIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var claimed *integrationoperation.ClaimedOperation
	if strings.TrimSpace(operationKey) == "" {
		claimed, err = repository.ClaimNext(
			ctx, trusted.TenantCode, trusted.DeploymentCode, "altoc", worker, now, integrationOperationLease,
		)
	} else {
		claimed, err = repository.ClaimByOperationKey(
			ctx, trusted.TenantCode, trusted.DeploymentCode, "altoc", strings.TrimSpace(operationKey), worker, now, integrationOperationLease,
		)
	}
	if err != nil {
		return nil, err
	}
	return claimedIntegrationOperationResponse(claimed)
}

func (a *Adapter) failIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationKey = strings.TrimSpace(operationKey)
	operationID := strings.TrimSpace(firstBodyText(body, "operationId", "operation_id"))
	if !integrationoperation.IsValidOperationID(operationID) || operationKey == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId, operation key and fencing token are required")
	}
	fencingToken, err := uint64BodyValue(body, "fencingToken", "fencing_token")
	if err != nil || fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId, operation key and fencing token are required")
	}

	targetApp, operationCode, _, err := a.loadLeasedIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken)
	if err != nil {
		return nil, err
	}

	failure := integrationoperation.FailureInput{HTTPStatus: intBodyValue(body, "httpStatus", "http_status")}
	if boolBodyValue(body, "timedOut", "timed_out") {
		failure.Err = context.DeadlineExceeded
	} else if boolBodyValue(body, "networkError", "network_error") {
		failure.Err = errors.New("network error")
	}
	switch strings.TrimSpace(firstBodyText(body, "conflictDisposition", "conflict_disposition")) {
	case "idempotent_success":
		failure.ConflictDisposition = integrationoperation.ConflictIdempotentExisting
	case "processing":
		failure.ConflictDisposition = integrationoperation.ConflictInProgress
	case "payload_mismatch", "binding_conflict", "permanent":
		failure.ConflictDisposition = integrationoperation.ConflictPermanent
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordFailure(ctx, integrationoperation.RecordFailureInput{
		Lease: integrationoperation.CompletionLease{
			OperationID:  operationID,
			Worker:       worker,
			FencingToken: fencingToken,
		},
		Now:               time.Now().UTC(),
		Failure:           failure,
		ErrorCode:         strings.TrimSpace(firstBodyText(body, "errorCode", "error_code")),
		ErrorSummary:      strings.TrimSpace(firstBodyText(body, "errorSummary", "error_summary")),
		DeliveryUncertain: boolBodyValue(body, "deliveryUncertain", "delivery_uncertain"),
	})
	if err != nil {
		return nil, err
	}
	return integrationOperationResultResponse(operationID, operationKey, trusted, targetApp, operationCode, result), nil
}

func (a *Adapter) succeedIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "integration_operation", "execute"); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationKey = strings.TrimSpace(operationKey)
	operationID := strings.TrimSpace(firstBodyText(body, "operationId", "operation_id"))
	fencingToken, fenceErr := uint64BodyValue(body, "fencingToken", "fencing_token")
	if !integrationoperation.IsValidOperationID(operationID) || operationKey == "" || fenceErr != nil || fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId, operation key and fencing token are required")
	}
	targetApp, operationCode, command, err := a.loadLeasedIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken)
	if err != nil {
		return nil, err
	}
	targetBizType, targetBizCode := altocIntegrationOperationExpectedTarget(operationCode, command)
	if operationCode == altocInvoiceRequestOperationCode {
		targetBizType = strings.TrimSpace(firstBodyText(body, "targetBizType", "target_biz_type"))
		targetBizCode = strings.TrimSpace(firstBodyText(body, "targetBizCode", "target_biz_code"))
		if targetBizType != "invoice_request" || targetBizCode == "" {
			return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "Finance invoice receipt target is invalid")
		}
	}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	targetReceiptID := strings.TrimSpace(firstBodyText(body, "targetReceiptId", "target_receipt_id"))
	responseSummarySHA256 := strings.TrimSpace(firstBodyText(body, "responseSummarySha256", "response_summary_sha256"))
	if targetBizType == "" || integrationoperation.ValidateReceiptEvidence(
		integrationoperation.ReceiptEvidence{
			OperationID: operationID, OperationCode: operationCode, IdempotencyKey: operationKey,
			CommandSchemaVersion: altocOperationReceiptSchema(operationCode), CommandSHA256: commandSHA256,
			TargetBizType: targetBizType, TargetBizCode: targetBizCode,
		},
		integrationoperation.ReceiptEvidence{
			ReceiptID:             targetReceiptID,
			OperationID:           strings.TrimSpace(firstBodyText(body, "receiptOperationId", "receipt_operation_id")),
			OperationCode:         strings.TrimSpace(firstBodyText(body, "receiptOperationCode", "receipt_operation_code")),
			IdempotencyKey:        strings.TrimSpace(firstBodyText(body, "receiptIdempotencyKey", "receipt_idempotency_key")),
			CommandSchemaVersion:  strings.TrimSpace(firstBodyText(body, "receiptCommandSchemaVersion", "receipt_command_schema_version")),
			CommandSHA256:         strings.TrimSpace(firstBodyText(body, "receiptCommandSha256", "receipt_command_sha256")),
			TargetBizType:         strings.TrimSpace(firstBodyText(body, "targetBizType", "target_biz_type")),
			TargetBizCode:         strings.TrimSpace(firstBodyText(body, "targetBizCode", "target_biz_code")),
			ResponseSummarySHA256: responseSummarySHA256,
		},
	) != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "target receipt does not match the leased integration operation")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordSuccess(ctx, integrationoperation.RecordSuccessInput{
		Lease: integrationoperation.CompletionLease{
			OperationID:  operationID,
			Worker:       worker,
			FencingToken: fencingToken,
		},
		Now:                   time.Now().UTC(),
		HTTPStatus:            intBodyValue(body, "httpStatus", "http_status"),
		TargetReceiptID:       targetReceiptID,
		TargetBizType:         targetBizType,
		TargetBizCode:         targetBizCode,
		ResponseSummarySHA256: responseSummarySHA256,
	})
	if err != nil {
		return nil, err
	}
	return integrationOperationResultResponse(operationID, operationKey, trusted, targetApp, operationCode, result), nil
}

func altocIntegrationOperationExpectedTarget(operationCode string, command map[string]any) (string, string) {
	switch operationCode {
	case altocProductFeedbackOperation:
		requestID, ok := command["requestBizId"].(string)
		if !ok || !integrationoperation.IsValidOperationID(requestID) || command["action"] != "create" || len(command) != 7 {
			return "", ""
		}
		return "product_request", requestID
	case opsKnowledgeCodocsOperationCode:
		return "document", strings.TrimSpace(fmt.Sprint(command["documentUuid"]))
	case altocActivationProjectOperation:
		return "project", strings.TrimSpace(fmt.Sprint(command["projectCode"]))
	case altocActivationMilestoneOperation:
		return "project_milestones", strings.TrimSpace(fmt.Sprint(command["projectCode"]))
	default:
		return "", ""
	}
}

func (a *Adapter) loadLeasedIntegrationOperation(
	ctx context.Context,
	trusted integrationoperation.TrustedContext,
	worker string,
	operationID string,
	operationKey string,
	fencingToken uint64,
) (string, string, map[string]any, error) {
	var targetApp string
	var operationCode string
	var commandJSON []byte
	err := a.DB().QueryRowContext(ctx, `
		SELECT target_app, operation_code, command_json
		FROM integration_operation
		WHERE operation_id = ?
		  AND operation_key = ?
		  AND tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'altoc'
		  AND status = 'processing'
		  AND locked_by = ?
		  AND fencing_token = ?
		LIMIT 1
	`, operationID, operationKey, trusted.TenantCode, trusted.DeploymentCode, worker, fencingToken).Scan(&targetApp, &operationCode, &commandJSON)
	if err != nil {
		return "", "", nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "integration operation lease is missing or stale")
	}
	command := map[string]any{}
	if err := json.Unmarshal(commandJSON, &command); err != nil {
		return "", "", nil, httperror.New(http.StatusConflict, "integration_operation_command_invalid", "stored integration operation command is invalid")
	}
	return targetApp, operationCode, command, nil
}

func integrationOperationResultResponse(
	operationID string,
	operationKey string,
	trusted integrationoperation.TrustedContext,
	targetApp string,
	operationCode string,
	result integrationoperation.RecordResult,
) map[string]any {
	response := map[string]any{
		"operationId":    operationID,
		"operationKey":   operationKey,
		"tenantCode":     trusted.TenantCode,
		"deploymentCode": trusted.DeploymentCode,
		"sourceApp":      "altoc",
		"targetApp":      targetApp,
		"operationCode":  operationCode,
		"status":         string(result.Status),
		"version":        result.Version,
	}
	if result.Decision.Retry {
		response["nextAttemptAt"] = result.Decision.NextAttemptAt.UTC().Format(time.RFC3339Nano)
	} else {
		response["nextAttemptAt"] = nil
	}
	return response
}

func trustedIntegrationOperationWorker(body map[string]any) (integrationoperation.TrustedContext, string, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, "", httperror.New(
			http.StatusForbidden,
			"integration_operation_context_invalid",
			"trusted integration operation dispatcher context is missing or invalid",
		)
	}
	worker := fmt.Sprintf("altoc:%s:%s", trusted.ServiceClientID, trusted.RequestID)
	if len(worker) > 240 {
		return integrationoperation.TrustedContext{}, "", httperror.New(
			http.StatusForbidden,
			"integration_operation_context_invalid",
			"trusted integration operation dispatcher identity is too long",
		)
	}
	return trusted, worker, nil
}

func claimedIntegrationOperationResponse(claimed *integrationoperation.ClaimedOperation) (map[string]any, error) {
	if claimed == nil {
		return nil, nil
	}
	command := map[string]any{}
	if err := json.Unmarshal(claimed.Command, &command); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId":           claimed.OperationID,
		"operationKey":          claimed.OperationKey,
		"correlationKey":        claimed.CorrelationKey,
		"sequenceNo":            claimed.SequenceNo,
		"dependsOnOperationKey": nullableText(claimed.DependsOnOperationKey),
		"tenantCode":            claimed.Identity.TenantCode,
		"deploymentCode":        claimed.Identity.DeploymentCode,
		"sourceApp":             claimed.Identity.SourceApp,
		"targetApp":             claimed.Identity.TargetApp,
		"operationCode":         claimed.Identity.OperationCode,
		"requiredCapability":    claimed.RequiredCapability,
		"sourceBizType":         claimed.Identity.SourceBizType,
		"sourceBizCode":         claimed.Identity.SourceBizCode,
		"idempotencyKey":        claimed.Identity.IdempotencyKey,
		"originalActorUid":      nullableText(claimed.OriginalActorUID),
		"commandSchemaVersion":  claimed.CommandSchemaVersion,
		"commandSha256":         claimed.Identity.CommandSHA256,
		"command":               command,
		"attemptId":             claimed.AttemptID,
		"attemptCount":          claimed.AttemptCount,
		"maxAttempts":           claimed.MaxAttempts,
		"lockedBy":              claimed.Worker,
		"lockedUntil":           claimed.LockedUntil.UTC().Format(time.RFC3339Nano),
		"fencingToken":          claimed.FencingToken,
		"version":               claimed.Version,
	}, nil
}

func uint64BodyValue(body map[string]any, keys ...string) (uint64, error) {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			return strconv.ParseUint(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		}
	}
	return 0, fmt.Errorf("value is missing")
}

func intBodyValue(body map[string]any, keys ...string) int {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			parsed, _ := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
			return parsed
		}
	}
	return 0
}

func boolBodyValue(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			switch typed := value.(type) {
			case bool:
				return typed
			default:
				parsed, _ := strconv.ParseBool(strings.TrimSpace(fmt.Sprint(value)))
				return parsed
			}
		}
	}
	return false
}

func altocOperationReceiptSchema(operationCode string) string {
	if operationCode == altocProductFeedbackOperation {
		return altocProductFeedbackSchema
	}
	return "v1"
}
