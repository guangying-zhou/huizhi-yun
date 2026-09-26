package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"strings"
	"time"
)

// NotificationRepository supports the original notification wire contract with
// either legacy persistence or a generation-guarded transaction implementation.
type NotificationRepository interface {
	ListPendingFailureNotifications(context.Context, string, string, string, int) ([]integrationoperation.FailureNotificationCandidate, error)
	ListPendingDeadLetterActionables(context.Context, string, string, string, int, time.Time) ([]integrationoperation.DeadLetterActionableCandidate, error)
	ListPendingDeadLetterClosures(context.Context, string, string, string, int) ([]integrationoperation.DeadLetterClosureCandidate, error)
	MarkFailureNotified(context.Context, integrationoperation.MarkFailureNotifiedInput) (bool, error)
	MarkDeadLetterActionablePublished(context.Context, integrationoperation.MarkDeadLetterActionablePublishedInput) (bool, error)
	MarkDeadLetterClosureAcknowledged(context.Context, integrationoperation.MarkDeadLetterClosureAcknowledgedInput) (bool, error)
}

func executeListPendingIntegrationOperationFailureNotifications(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, body map[string]any, now time.Time) (map[string]any, error) {
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
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

func executeListPendingDeadLetterActionables(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, body map[string]any, now time.Time) (map[string]any, error) {
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "aims", limit, now)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, aimsDeadLetterActionableResponse(item, trusted))
	}
	return map[string]any{"items": result}, nil
}

func executeListPendingDeadLetterClosures(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, body map[string]any, now time.Time) (map[string]any, error) {
	limit := aimsIntBodyValue(body, "limit")
	if limit == 0 {
		limit = 20
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

func executeMarkIntegrationOperationFailureNotified(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, operationID string, body map[string]any, now time.Time) (map[string]any, error) {
	notificationID := strings.TrimSpace(firstBodyText(body, "notificationId", "notification_id"))
	marked, err := repository.MarkFailureNotified(ctx, integrationoperation.MarkFailureNotifiedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims",
		OperationID: strings.TrimSpace(operationID), NotificationID: notificationID, Now: now,
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

func executeMarkDeadLetterActionablePublished(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, operationID string, body map[string]any, now time.Time) (map[string]any, error) {
	generation, generationErr := aimsUint64BodyValue(body, "generation")
	operationVersion, versionErr := aimsUint64BodyValue(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil || generation == 0 || operationVersion == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	recipients := serviceStringSlice(body["recipientUids"], body["recipient_uids"])
	if len(recipients) < 1 || len(recipients) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "recipientUids must contain between 1 and 100 values")
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"),
		ObjectVersion: firstBodyText(body, "objectVersion", "object_version"), NotificationID: firstBodyText(body, "notificationId", "notification_id"),
		RecipientUIDs: recipients, Now: now,
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims"}, nil
}

func executeMarkDeadLetterClosureAcknowledged(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, operationID string, body map[string]any, now time.Time) (map[string]any, error) {
	generation, generationErr := aimsUint64BodyValue(body, "generation")
	if generationErr != nil || generation == 0 {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	state := firstBodyText(body, "state")
	expectedVersion := firstBodyText(body, "expectedVersion", "expected_version")
	nextVersion := firstBodyText(body, "nextVersion", "next_version")
	if (state != "resolved" && state != "cancelled") || expectedVersion == nextVersion {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "A valid closure state and distinct versions are required")
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", OperationID: strings.TrimSpace(operationID), Generation: generation, ActionableKey: firstBodyText(body, "actionableKey", "actionable_key"), ExpectedVersion: firstBodyText(body, "expectedVersion", "expected_version"), NextVersion: firstBodyText(body, "nextVersion", "next_version"), State: firstBodyText(body, "state"), Now: now})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "aims"}, nil
}

// ExecuteIntegrationOperationNotification preserves existing input and response semantics.
// The caller supplies verified identity and persistence; request body is not authority.
func ExecuteIntegrationOperationNotification(ctx context.Context, repository NotificationRepository, trusted integrationoperation.TrustedContext, action, operationID string, body map[string]any, now time.Time) (map[string]any, error) {
	if repository == nil || trusted.SourceApp != "aims" || trusted.TenantCode == "" || trusted.DeploymentCode == "" || now.IsZero() {
		return nil, httperror.New(403, "integration_operation_context_invalid", "Trusted notification context is required")
	}
	switch action {

	case "pending-failure-notifications":
		return executeListPendingIntegrationOperationFailureNotifications(ctx, repository, trusted, body, now)

	case "pending-dead-letter-actionables":
		return executeListPendingDeadLetterActionables(ctx, repository, trusted, body, now)

	case "pending-dead-letter-closures":
		return executeListPendingDeadLetterClosures(ctx, repository, trusted, body, now)

	case "failure-notified":
		return executeMarkIntegrationOperationFailureNotified(ctx, repository, trusted, operationID, body, now)

	case "dead-letter-actionable-published":
		return executeMarkDeadLetterActionablePublished(ctx, repository, trusted, operationID, body, now)

	case "dead-letter-closure-acknowledged":
		return executeMarkDeadLetterClosureAcknowledged(ctx, repository, trusted, operationID, body, now)

	default:
		return nil, httperror.New(400, "integration_operation_action_invalid", "Unsupported notification action")
	}
}
