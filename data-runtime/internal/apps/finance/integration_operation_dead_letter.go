package finance

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Finance exposes the same source-owned dead-letter lifecycle as the other
// integration-operation producers. The Console receives only these frozen,
// safe fields; command payloads and operation keys never leave the runtime.
func (a *Adapter) listFinanceDeadLetterActionables(ctx context.Context, body jsonBody) (map[string]any, error) {
	trusted, err := financeDeadLetterWorkerContext(body)
	if err != nil {
		return nil, err
	}
	limit := financeDeadLetterLimit(body)
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "finance", limit, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{
			"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "finance",
			"targetApp": item.TargetApp, "operationId": item.OperationID, "operationCode": item.OperationCode,
			"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
			"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
			"lastErrorCode": nullableFinanceText(item.LastErrorCode), "lastErrorClass": nullableFinanceText(item.LastErrorClass),
			"deadLetteredAt": item.DeadLetteredAt.UTC().Format(time.RFC3339Nano), "originalActorUid": nullableFinanceText(item.OriginalActorUID),
			"generation": item.Generation, "operationVersion": item.OperationVersion,
			"actionableKey": item.ActionableKey, "objectVersion": item.ObjectVersion,
		})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markFinanceDeadLetterActionablePublished(ctx context.Context, operationID string, body jsonBody) (map[string]any, error) {
	trusted, err := financeDeadLetterWorkerContext(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := financeDeadLetterUint64(body, "generation")
	operationVersion, versionErr := financeDeadLetterUint64(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion,
		ActionableKey: financeDeadLetterText(body, "actionableKey", "actionable_key"), ObjectVersion: financeDeadLetterText(body, "objectVersion", "object_version"),
		NotificationID: financeDeadLetterText(body, "notificationId", "notification_id"), RecipientUIDs: financeDeadLetterUIDs(body["recipientUids"], body["recipient_uids"]), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "finance"}, nil
}

func (a *Adapter) listFinanceDeadLetterClosures(ctx context.Context, body jsonBody) (map[string]any, error) {
	trusted, err := financeDeadLetterWorkerContext(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterClosures(ctx, trusted.TenantCode, trusted.DeploymentCode, "finance", financeDeadLetterLimit(body))
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]any{
			"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "finance",
			"operationId": item.OperationID, "generation": item.Generation, "actionableKey": item.ActionableKey,
			"expectedVersion": item.ExpectedVersion, "nextVersion": item.NextVersion, "state": item.State, "recipientUids": item.RecipientUIDs,
		})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markFinanceDeadLetterClosureAcknowledged(ctx context.Context, operationID string, body jsonBody) (map[string]any, error) {
	trusted, err := financeDeadLetterWorkerContext(body)
	if err != nil {
		return nil, err
	}
	generation, generationErr := financeDeadLetterUint64(body, "generation")
	if generationErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", OperationID: strings.TrimSpace(operationID), Generation: generation,
		ActionableKey: financeDeadLetterText(body, "actionableKey", "actionable_key"), ExpectedVersion: financeDeadLetterText(body, "expectedVersion", "expected_version"),
		NextVersion: financeDeadLetterText(body, "nextVersion", "next_version"), State: financeDeadLetterText(body, "state"), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "finance"}, nil
}

func (a *Adapter) replayFinanceIntegrationOperation(ctx context.Context, operationID string, body jsonBody) (map[string]any, error) {
	if err := financeRequireIntegrationOperationAction(body, "replay"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "finance")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation context is required")
	}
	actor := financeDeadLetterText(body, "current_user", "operator_uid")
	expectedVersion, versionErr := financeDeadLetterUint64(body, "expectedVersion", "expected_version")
	reason := financeDeadLetterText(body, "reason")
	if actor == "" || actor == "system" || versionErr != nil || expectedVersion == 0 || reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_replay_invalid", "trusted actor, expectedVersion and reason are required")
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	result, err := repository.Replay(ctx, integrationoperation.ReplayInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", OperationID: strings.TrimSpace(operationID), ExpectedVersion: expectedVersion, ActorUID: actor, Reason: reason, Now: time.Now().UTC()})
	if errors.Is(err, integrationoperation.ErrReplayRejected) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_replay_rejected", "operation is not replayable or its version changed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "finance", "status": string(result.Status), "version": result.Version}, nil
}

func financeDeadLetterWorkerContext(body jsonBody) (integrationoperation.TrustedContext, error) {
	if err := requireFinanceIntegrationScope(body); err != nil {
		return integrationoperation.TrustedContext{}, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "finance")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation worker context is required")
	}
	return trusted, nil
}

func financeDeadLetterLimit(body jsonBody) int {
	value, err := financeDeadLetterUint64(body, "limit")
	if err != nil || value == 0 {
		return 20
	}
	if value > 20 {
		return 21
	}
	return int(value)
}

func financeDeadLetterUint64(body jsonBody, keys ...string) (uint64, error) {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			parsed, err := strconv.ParseUint(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
			if err != nil || parsed == 0 {
				return 0, fmt.Errorf("invalid %s", key)
			}
			return parsed, nil
		}
	}
	return 0, fmt.Errorf("missing value")
}

func financeDeadLetterText(body jsonBody, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(cleanStringValue(body[key])); value != "" {
			return value
		}
	}
	return ""
}

func financeDeadLetterUIDs(values ...any) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		switch typed := value.(type) {
		case []string:
			for _, item := range typed {
				addFinanceDeadLetterUID(&result, seen, item)
			}
		case []any:
			for _, item := range typed {
				addFinanceDeadLetterUID(&result, seen, cleanStringValue(item))
			}
		}
	}
	sort.Strings(result)
	return result
}

func addFinanceDeadLetterUID(result *[]string, seen map[string]bool, raw string) {
	value := strings.TrimSpace(raw)
	if value != "" && !seen[value] {
		seen[value] = true
		*result = append(*result, value)
	}
}

func financeRequireIntegrationOperationAction(body jsonBody, action string) error {
	required := "finance:integration_operations:" + action
	for _, scope := range financeIntegrationScopes(body["current_user_scopes"]) {
		if scope == "*" || scope == "finance.*" || scope == required {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", required+" scope is required")
}

// ListIntegrationOperationDiagnostics is intentionally limited to the
// Finance source partition and is only exposed through the tenant-global
// administration BFF. It never returns the frozen command payload.
func (a *Adapter) ListIntegrationOperationDiagnostics(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := financeRequireIntegrationOperationAction(jsonBody{"current_user_scopes": query.Get("current_user_scopes")}, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(financeNotificationTrustedQuery(query), "finance")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation context is required")
	}
	limit := integrationoperation.DefaultDiagnosticLimit
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be an integer")
		}
	}
	statuses, err := financeIntegrationOperationStatuses(query.Get("status"))
	if err != nil {
		return nil, err
	}
	cursor, err := integrationoperation.DecodeDiagnosticCursor(query.Get("cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_cursor_invalid", "cursor is invalid")
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	page, err := repository.ListDiagnostics(ctx, integrationoperation.DiagnosticListInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", Statuses: statuses, Limit: limit, Cursor: cursor})
	if err != nil {
		return nil, err
	}
	nextCursor, err := integrationoperation.EncodeDiagnosticCursor(page.NextCursor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": page.Items, "nextCursor": nullableFinanceText(nextCursor)}, nil
}

func (a *Adapter) ListIntegrationOperationAttempts(ctx context.Context, operationID string, query url.Values) (map[string]any, error) {
	if err := financeRequireIntegrationOperationAction(jsonBody{"current_user_scopes": query.Get("current_user_scopes")}, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(financeNotificationTrustedQuery(query), "finance")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation context is required")
	}
	limit := 100
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be an integer")
		}
	}
	repository, err := integrationoperation.NewRepository(a.db)
	if err != nil {
		return nil, err
	}
	items, err := repository.ListAttemptTimeline(ctx, integrationoperation.AttemptTimelineInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", OperationID: strings.TrimSpace(operationID), Limit: limit})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "items": items}, nil
}

func financeIntegrationOperationStatuses(value string) ([]integrationoperation.Status, error) {
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
