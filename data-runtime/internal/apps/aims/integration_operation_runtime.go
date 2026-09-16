package aims

import (
	"context"
	"database/sql"
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

const aimsIntegrationOperationLease = time.Minute

func (a *Adapter) handleIntegrationOperationRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (map[string]any, string, bool, error) {
	if method == http.MethodGet && path == "/v1/aims/integration-operations" {
		data, err := a.listIntegrationOperationDiagnostics(ctx, query)
		return data, "aims.integration_operations.diagnostics.list", true, err
	}
	if method == http.MethodGet {
		if operationID, ok := pathParam(path, "/v1/aims/integration-operations/", "/attempts"); ok {
			data, err := a.listIntegrationOperationAttempts(ctx, operationID, query)
			return data, "aims.integration_operations.attempts.list", true, err
		}
	}
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	if path == "/v1/aims/integration-operations:claim-next" {
		data, err := a.claimNextIntegrationOperation(ctx, body)
		return data, "aims.integration_operations.claim_next", true, err
	}
	if path == "/v1/aims/integration-operations:pending-failure-notifications" {
		data, err := a.listPendingIntegrationOperationFailureNotifications(ctx, body)
		return data, "aims.integration_operations.failure_notifications.list", true, err
	}
	if path == "/v1/aims/integration-operations:pending-dead-letter-actionables" {
		data, err := a.listPendingDeadLetterActionables(ctx, body)
		return data, "aims.integration_operations.dead_letter_actionables.list", true, err
	}
	if path == "/v1/aims/integration-operations:pending-dead-letter-closures" {
		data, err := a.listPendingDeadLetterClosures(ctx, body)
		return data, "aims.integration_operations.dead_letter_closures.list", true, err
	}
	if operationKey, ok := pathParam(path, "/v1/aims/integration-operations/", ":claim"); ok {
		data, err := a.claimIntegrationOperation(ctx, operationKey, body)
		return data, "aims.integration_operations.claim", true, err
	}
	if operationKey, ok := pathParam(path, "/v1/aims/integration-operations/", ":fail"); ok {
		data, err := a.failIntegrationOperation(ctx, operationKey, body)
		return data, "aims.integration_operations.fail", true, err
	}
	if operationKey, ok := pathParam(path, "/v1/aims/integration-operations/", ":succeed"); ok {
		data, err := a.succeedIntegrationOperation(ctx, operationKey, body)
		return data, "aims.integration_operations.succeed", true, err
	}
	if operationID, ok := pathParam(path, "/v1/aims/integration-operations/", ":replay"); ok {
		data, err := a.replayIntegrationOperation(ctx, operationID, body)
		return data, "aims.integration_operations.replay", true, err
	}
	if operationID, ok := pathParam(path, "/v1/aims/integration-operations/", ":failure-notified"); ok {
		data, err := a.markIntegrationOperationFailureNotified(ctx, operationID, body)
		return data, "aims.integration_operations.failure_notifications.mark", true, err
	}
	if operationID, ok := pathParam(path, "/v1/aims/integration-operations/", ":dead-letter-actionable-published"); ok {
		data, err := a.markDeadLetterActionablePublished(ctx, operationID, body)
		return data, "aims.integration_operations.dead_letter_actionables.mark", true, err
	}
	if operationID, ok := pathParam(path, "/v1/aims/integration-operations/", ":dead-letter-closure-acknowledged"); ok {
		data, err := a.markDeadLetterClosureAcknowledged(ctx, operationID, body)
		return data, "aims.integration_operations.dead_letter_closures.mark", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) listPendingDeadLetterActionables(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", limit, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, aimsDeadLetterActionableResponse(item, trusted))
	}
	return map[string]any{"items": result}, nil
}

func aimsDeadLetterActionableResponse(item integrationoperation.DeadLetterActionableCandidate, trusted integrationoperation.TrustedContext) map[string]any {
	return map[string]any{
		"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims",
		"targetApp": item.TargetApp, "operationId": item.OperationID, "operationCode": item.OperationCode,
		"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
		"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
		"lastErrorCode": nullableAimsText(item.LastErrorCode), "lastErrorClass": nullableAimsText(item.LastErrorClass),
		"deadLetteredAt": item.DeadLetteredAt.UTC().Format(time.RFC3339Nano), "originalActorUid": nullableAimsText(item.OriginalActorUID),
		"generation": item.Generation, "operationVersion": item.OperationVersion,
		"actionableKey": item.ActionableKey, "objectVersion": item.ObjectVersion,
	}
}

func (a *Adapter) markDeadLetterActionablePublished(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := aimsUint64BodyValue(body, "generation")
	operationVersion, versionErr := aimsUint64BodyValue(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"),
		ObjectVersion: firstBodyText(body, "objectVersion", "object_version"), NotificationID: firstBodyText(body, "notificationId", "notification_id"),
		RecipientUIDs: serviceStringSlice(body["recipientUids"], body["recipient_uids"]), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims"}, nil
}

func (a *Adapter) listPendingDeadLetterClosures(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterClosures(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims", "operationId": item.OperationID, "generation": item.Generation, "actionableKey": item.ActionableKey, "expectedVersion": item.ExpectedVersion, "nextVersion": item.NextVersion, "state": item.State, "recipientUids": item.RecipientUIDs})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markDeadLetterClosureAcknowledged(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := aimsUint64BodyValue(body, "generation")
	if generationErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", OperationID: strings.TrimSpace(operationID), Generation: generation, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"), ExpectedVersion: firstBodyText(body, "expectedVersion", "expected_version"), NextVersion: firstBodyText(body, "nextVersion", "next_version"), State: firstBodyText(body, "state"), Now: time.Now().UTC()})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims"}, nil
}

func (a *Adapter) listIntegrationOperationAttempts(ctx context.Context, operationID string, query url.Values) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationAction(query.Get("current_user_scopes"), "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(aimsIntegrationOperationTrustedQuery(query), "aims")
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
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims",
		OperationID: strings.TrimSpace(operationID), Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "items": items}, nil
}

func (a *Adapter) listPendingIntegrationOperationFailureNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingFailureNotifications(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, aimsFailureNotificationResponse(item, trusted))
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markIntegrationOperationFailureNotified(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	notificationID := strings.TrimSpace(firstBodyText(body, "notificationId", "notification_id"))
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkFailureNotified(ctx, integrationoperation.MarkFailureNotifiedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims",
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
		"sourceApp": "aims", "failureNotified": marked,
	}, nil
}

func aimsFailureNotificationResponse(item integrationoperation.FailureNotificationCandidate, trusted integrationoperation.TrustedContext) map[string]any {
	return map[string]any{
		"operationId": item.OperationID, "operationKey": item.OperationKey,
		"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode,
		"sourceApp": "aims", "targetApp": item.TargetApp, "operationCode": item.OperationCode,
		"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
		"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
		"lastErrorCode": nullableAimsText(item.LastErrorCode), "lastErrorClass": nullableAimsText(item.LastErrorClass),
		"deadLetteredAt":   item.DeadLetteredAt.UTC().Format(time.RFC3339Nano),
		"originalActorUid": nullableAimsText(item.OriginalActorUID),
	}
}

func (a *Adapter) listIntegrationOperationDiagnostics(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationAction(query.Get("current_user_scopes"), "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(aimsIntegrationOperationTrustedQuery(query), "aims")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	statuses, err := aimsIntegrationOperationStatuses(query.Get("status"))
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
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims",
		Statuses: statuses, Limit: limit, Cursor: cursor,
	})
	if err != nil {
		return nil, err
	}
	nextCursor, err := integrationoperation.EncodeDiagnosticCursor(page.NextCursor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": page.Items, "nextCursor": nullableAimsText(nextCursor)}, nil
}

func (a *Adapter) replayIntegrationOperation(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationAction(body["current_user_scopes"], "replay"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
	}
	actor := strings.TrimSpace(firstBodyText(body, "current_user", "operator_uid"))
	expectedVersion, versionErr := aimsUint64BodyValue(body, "expectedVersion", "expected_version")
	reason := strings.TrimSpace(firstBodyText(body, "reason"))
	if actor == "" || actor == "system" || versionErr != nil || expectedVersion == 0 || reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_replay_invalid", "trusted actor, expectedVersion and reason are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.Replay(ctx, integrationoperation.ReplayInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims",
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
		"deploymentCode": trusted.DeploymentCode, "sourceApp": "aims",
		"status": string(result.Status), "version": result.Version,
	}, nil
}

func aimsIntegrationOperationTrustedQuery(query url.Values) map[string]any {
	result := map[string]any{}
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

func aimsIntegrationOperationStatuses(value string) ([]integrationoperation.Status, error) {
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

func aimsRequireIntegrationOperationAction(value any, action string) error {
	required := "aims:integration_operations:" + action
	for _, scope := range aimsScopeStrings(value) {
		if scope == "*" || scope == "aims.*" || scope == required {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", required+" scope is required")
}

func nullableAimsText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (a *Adapter) claimNextIntegrationOperation(ctx context.Context, body map[string]any) (map[string]any, error) {
	return a.claimIntegrationOperation(ctx, "", body)
}

func (a *Adapter) claimIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedAimsIntegrationOperationWorker(body)
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
		claimed, err = repository.ClaimNext(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", worker, now, aimsIntegrationOperationLease)
	} else {
		claimed, err = repository.ClaimByOperationKey(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", strings.TrimSpace(operationKey), worker, now, aimsIntegrationOperationLease)
	}
	if err != nil {
		return nil, err
	}
	return claimedAimsIntegrationOperationResponse(claimed)
}

func (a *Adapter) failIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationKey = strings.TrimSpace(operationKey)
	operationID := strings.TrimSpace(firstBodyText(body, "operationId", "operation_id"))
	fencingToken, fenceErr := aimsUint64BodyValue(body, "fencingToken", "fencing_token")
	if !integrationoperation.IsValidOperationID(operationID) || operationKey == "" || fenceErr != nil || fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId, operation key and fencing token are required")
	}
	targetApp, operationCode, command, err := a.loadLeasedIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken)
	if err != nil {
		return nil, err
	}
	if err := validateServiceTicketDeliveryOperation(targetApp, operationCode, command); err != nil {
		return nil, err
	}
	failure := integrationoperation.FailureInput{HTTPStatus: aimsIntBodyValue(body, "httpStatus", "http_status")}
	if aimsBoolBodyValue(body, "timedOut", "timed_out") {
		failure.Err = context.DeadlineExceeded
	} else if aimsBoolBodyValue(body, "networkError", "network_error") {
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
		Lease:             integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencingToken},
		Now:               time.Now().UTC(),
		Failure:           failure,
		ErrorCode:         strings.TrimSpace(firstBodyText(body, "errorCode", "error_code")),
		ErrorSummary:      strings.TrimSpace(firstBodyText(body, "errorSummary", "error_summary")),
		DeliveryUncertain: aimsBoolBodyValue(body, "deliveryUncertain", "delivery_uncertain"),
	})
	if err != nil {
		return nil, err
	}
	if operationCode == companyWeeklySummaryOperationCode &&
		(result.Status == integrationoperation.StatusFailedPermanent || result.Status == integrationoperation.StatusDeadLetter) {
		versionID, versionErr := bodyPositiveInt64(command, "summaryVersionId", "summary_version_id")
		if versionErr != nil || versionID <= 0 {
			return nil, httperror.New(http.StatusConflict, "company_weekly_summary_operation_invalid", "summary version identity is invalid")
		}
		if _, err := a.DB().ExecContext(ctx, `
			UPDATE company_weekly_summary_versions
			SET publish_status = 'failed'
			WHERE id = ? AND publish_status = 'pending'
		`, versionID); err != nil {
			return nil, err
		}
	}
	return aimsIntegrationOperationResultResponse(operationID, operationKey, trusted, targetApp, operationCode, result), nil
}

func (a *Adapter) succeedIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedAimsIntegrationOperationWorker(body)
	if err != nil {
		return nil, err
	}
	operationKey = strings.TrimSpace(operationKey)
	operationID := strings.TrimSpace(firstBodyText(body, "operationId", "operation_id"))
	fencingToken, fenceErr := aimsUint64BodyValue(body, "fencingToken", "fencing_token")
	if !integrationoperation.IsValidOperationID(operationID) || operationKey == "" || fenceErr != nil || fencingToken == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId, operation key and fencing token are required")
	}
	targetApp, operationCode, command, err := a.loadLeasedIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken)
	if err != nil {
		return nil, err
	}
	if err := validateServiceTicketDeliveryOperation(targetApp, operationCode, command); err != nil {
		return nil, err
	}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	targetBizType, targetBizCode := aimsIntegrationOperationExpectedTarget(operationCode, command)
	targetReceiptID := strings.TrimSpace(firstBodyText(body, "targetReceiptId", "target_receipt_id"))
	responseSummarySHA256 := strings.TrimSpace(firstBodyText(body, "responseSummarySha256", "response_summary_sha256"))
	if err := integrationoperation.ValidateReceiptEvidence(
		integrationoperation.ReceiptEvidence{
			OperationID: operationID, OperationCode: operationCode, IdempotencyKey: operationKey,
			CommandSchemaVersion: aimsIntegrationOperationCommandSchema(operationCode), CommandSHA256: commandSHA256,
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
	); err != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "target receipt does not match the leased integration operation")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	successInput := integrationoperation.RecordSuccessInput{
		Lease:                 integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencingToken},
		Now:                   time.Now().UTC(),
		HTTPStatus:            aimsIntBodyValue(body, "httpStatus", "http_status"),
		TargetReceiptID:       targetReceiptID,
		TargetBizType:         targetBizType,
		TargetBizCode:         targetBizCode,
		ResponseSummarySHA256: responseSummarySHA256,
	}
	var result integrationoperation.RecordResult
	if operationCode == companyWeeklySummaryOperationCode {
		result, err = repository.RecordSuccessWithMutation(ctx, successInput, func(ctx context.Context, tx *sql.Tx) error {
			return completeCompanyWeeklySummaryPublishTx(ctx, tx, command, body)
		})
	} else {
		result, err = repository.RecordSuccess(ctx, successInput)
	}
	if err != nil {
		return nil, err
	}
	return aimsIntegrationOperationResultResponse(operationID, operationKey, trusted, targetApp, operationCode, result), nil
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
		  AND source_app = 'aims'
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

func validateServiceTicketDeliveryOperation(targetApp string, operationCode string, command map[string]any) error {
	valid := false
	switch operationCode {
	case productCostRulesOperationCode:
		valid = targetApp == "finance" && validProductCostRulesOperation(command)
	case productFeedbackProgressOperationCode:
		valid = targetApp == "altoc" && validProductFeedbackProgressCommand(command)
	case productFeedbackStatusOperationCode:
		valid = targetApp == "altoc" && validProductFeedbackStatusCommand(command)
	case productDocumentCreateOperationCode:
		valid = targetApp == "codocs" && validProductDocumentCreationCommand(command)
	case serviceTicketDeliveryOperationCode:
		valid = targetApp == "altoc" && strings.TrimSpace(fmt.Sprint(command["ticketCode"])) != ""
	case milestoneReceivableOperationCode:
		valid = targetApp == "altoc" && strings.TrimSpace(fmt.Sprint(command["paymentTermId"])) != ""
	case aimsPeopleContributionOperation:
		valid = targetApp == "people" && strings.TrimSpace(fmt.Sprint(command["cycle_code"])) != "" && strings.TrimSpace(fmt.Sprint(command["project_code"])) != ""
	case companyWeeklySummaryOperationCode:
		valid = targetApp == "codocs" &&
			strings.TrimSpace(fmt.Sprint(command["periodKey"])) != "" &&
			strings.TrimSpace(fmt.Sprint(command["summaryVersionId"])) != "" &&
			strings.TrimSpace(fmt.Sprint(command["markdownSha256"])) != ""
	}
	if !valid {
		return httperror.New(http.StatusConflict, "integration_operation_identity_mismatch", "integration operation target, code or command is invalid")
	}
	return nil
}

func aimsIntegrationOperationExpectedTarget(operationCode string, command map[string]any) (string, string) {
	switch operationCode {
	case productCostRulesOperationCode:
		return productCostRulesTarget(command)
	case productFeedbackStatusOperationCode, productFeedbackProgressOperationCode:
		return "product_feedback", strings.TrimSpace(fmt.Sprint(command["requestBizId"]))
	case productDocumentCreateOperationCode:
		return "product_document", strings.TrimSpace(fmt.Sprint(command["documentUuid"]))
	case serviceTicketDeliveryOperationCode:
		return "service_ticket", strings.TrimSpace(fmt.Sprint(command["ticketCode"]))
	case milestoneReceivableOperationCode:
		return "receivable_plan_set", "payment-term:" + strings.TrimSpace(fmt.Sprint(command["paymentTermId"]))
	case aimsPeopleContributionOperation:
		return "performance_contribution_scope", strings.TrimSpace(fmt.Sprint(command["cycle_code"])) + ":" + strings.TrimSpace(fmt.Sprint(command["project_code"]))
	case companyWeeklySummaryOperationCode:
		return "company_weekly_summary_document", strings.TrimSpace(fmt.Sprint(command["periodKey"]))
	default:
		return "", ""
	}
}

func trustedAimsIntegrationOperationWorker(body map[string]any) (integrationoperation.TrustedContext, string, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation dispatcher context is missing or invalid")
	}
	worker := fmt.Sprintf("aims:%s:%s", trusted.ServiceClientID, trusted.RequestID)
	if len(worker) > 240 {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation dispatcher identity is too long")
	}
	return trusted, worker, nil
}

func claimedAimsIntegrationOperationResponse(claimed *integrationoperation.ClaimedOperation) (map[string]any, error) {
	if claimed == nil {
		return nil, nil
	}
	command := map[string]any{}
	if err := json.Unmarshal(claimed.Command, &command); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": claimed.OperationID, "operationKey": claimed.OperationKey, "correlationKey": claimed.CorrelationKey,
		"tenantCode": claimed.Identity.TenantCode, "deploymentCode": claimed.Identity.DeploymentCode,
		"sourceApp": claimed.Identity.SourceApp, "targetApp": claimed.Identity.TargetApp,
		"operationCode": claimed.Identity.OperationCode, "requiredCapability": claimed.RequiredCapability,
		"sourceBizType": claimed.Identity.SourceBizType, "sourceBizCode": claimed.Identity.SourceBizCode,
		"idempotencyKey": claimed.Identity.IdempotencyKey, "commandSchemaVersion": claimed.CommandSchemaVersion,
		"commandSha256":    claimed.Identity.CommandSHA256,
		"originalActorUid": nullableAimsText(claimed.OriginalActorUID),
		"command":          command, "attemptId": claimed.AttemptID, "attemptCount": claimed.AttemptCount,
		"maxAttempts": claimed.MaxAttempts, "lockedBy": claimed.Worker,
		"lockedUntil": claimed.LockedUntil.UTC().Format(time.RFC3339Nano), "fencingToken": claimed.FencingToken,
		"version": claimed.Version,
	}, nil
}

func aimsIntegrationOperationResultResponse(operationID string, operationKey string, trusted integrationoperation.TrustedContext, targetApp string, operationCode string, result integrationoperation.RecordResult) map[string]any {
	response := map[string]any{
		"operationId": operationID, "operationKey": operationKey,
		"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode,
		"sourceApp": "aims", "targetApp": targetApp, "operationCode": operationCode,
		"status": string(result.Status), "version": result.Version,
	}
	if result.Decision.Retry {
		response["nextAttemptAt"] = result.Decision.NextAttemptAt.UTC().Format(time.RFC3339Nano)
	} else {
		response["nextAttemptAt"] = nil
	}
	return response
}

func aimsRequireIntegrationOperationScope(body map[string]any) error {
	for _, scope := range aimsScopeStrings(body["current_user_scopes"]) {
		if scope == "aims:integration_operation:execute" {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", "aims:integration_operation:execute scope is required")
}

func aimsScopeStrings(value any) []string {
	var raw []string
	switch typed := value.(type) {
	case string:
		raw = strings.FieldsFunc(typed, func(r rune) bool { return r == ',' || r == ' ' })
	case []string:
		raw = typed
	case []any:
		for _, item := range typed {
			raw = append(raw, fmt.Sprint(item))
		}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func aimsUint64BodyValue(body map[string]any, keys ...string) (uint64, error) {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			return strconv.ParseUint(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		}
	}
	return 0, fmt.Errorf("value is missing")
}

func aimsIntBodyValue(body map[string]any, keys ...string) int {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			parsed, _ := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
			return parsed
		}
	}
	return 0
}

func aimsBoolBodyValue(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			if typed, ok := value.(bool); ok {
				return typed
			}
			parsed, _ := strconv.ParseBool(strings.TrimSpace(fmt.Sprint(value)))
			return parsed
		}
	}
	return false
}
