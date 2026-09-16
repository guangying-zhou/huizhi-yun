package people

import (
	"context"
	"database/sql"
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

// People intentionally exposes dead-letter administration only for the two
// caller-owned lifecycle families. A new People outbox must opt in here before
// it can create a Console actionable, be replayed from the browser, or expose
// its notification detail evidence.
func (a *Adapter) handlePeopleIntegrationOperationAdminRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method == http.MethodGet && path == "/v1/people/integration-operations" {
		data, err := a.listPeopleIntegrationOperationDiagnostics(ctx, query)
		return data, "people.integration_operations.diagnostics.list", true, err
	}
	if method == http.MethodGet {
		if operationID, ok := peopleOperationPathParam(path, "/attempts"); ok {
			data, err := a.listPeopleIntegrationOperationAttempts(ctx, operationID, query)
			return data, "people.integration_operations.attempts.list", true, err
		}
	}
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch {
	case path == "/v1/people/integration-operations:pending-dead-letter-actionables":
		data, err := a.listPendingPeopleDeadLetterActionables(ctx, body)
		return data, "people.integration_operations.dead_letter_actionables.list", true, err
	case path == "/v1/people/integration-operations:pending-dead-letter-closures":
		data, err := a.listPendingPeopleDeadLetterClosures(ctx, body)
		return data, "people.integration_operations.dead_letter_closures.list", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":replay"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":replay")
		data, err := a.replayPeopleIntegrationOperation(ctx, operationID, body)
		return data, "people.integration_operations.replay", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":dead-letter-actionable-published"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":dead-letter-actionable-published")
		data, err := a.markPeopleDeadLetterActionablePublished(ctx, operationID, body)
		return data, "people.integration_operations.dead_letter_actionables.mark", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":dead-letter-closure-acknowledged"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":dead-letter-closure-acknowledged")
		data, err := a.markPeopleDeadLetterClosureAcknowledged(ctx, operationID, body)
		return data, "people.integration_operations.dead_letter_closures.mark", true, err
	default:
		return nil, "", false, nil
	}
}

func peopleOperationPathParam(path, suffix string) (string, bool) {
	const prefix = "/v1/people/integration-operations/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func (a *Adapter) listPendingPeopleDeadLetterActionables(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	limit, err := peopleIntegrationOperationLimit(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterActionables(ctx, trusted.TenantCode, trusted.DeploymentCode, "people", limit, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if !validPeopleIntegrationOperation(item.TargetApp, item.OperationCode, peopleCapabilityForOperation(item.OperationCode)) {
			continue
		}
		// This is the explicit safe DTO boundary. Do not add operation_key,
		// idempotency_key, command, error summary, token or URL fields here.
		result = append(result, map[string]any{
			"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "people",
			"targetApp": item.TargetApp, "operationId": item.OperationID, "operationCode": item.OperationCode,
			"sourceBizType": item.SourceBizType, "sourceBizCode": item.SourceBizCode,
			"attemptCount": item.AttemptCount, "maxAttempts": item.MaxAttempts,
			"lastErrorCode": nullablePeopleText(item.LastErrorCode), "lastErrorClass": nullablePeopleText(item.LastErrorClass),
			"deadLetteredAt": item.DeadLetteredAt.UTC().Format(time.RFC3339Nano), "originalActorUid": nullablePeopleText(item.OriginalActorUID),
			"generation": item.Generation, "operationVersion": item.OperationVersion,
			"actionableKey": item.ActionableKey, "objectVersion": item.ObjectVersion,
		})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markPeopleDeadLetterActionablePublished(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, operationID); err != nil {
		return nil, err
	}
	generation, generationErr := peopleUint64BodyValue(body, "generation")
	operationVersion, versionErr := peopleUint64BodyValue(body, "operationVersion", "operation_version")
	if generationErr != nil || versionErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_ack_invalid", "generation and operationVersion are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterActionablePublished(ctx, integrationoperation.MarkDeadLetterActionablePublishedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", OperationID: strings.TrimSpace(operationID),
		Generation: generation, OperationVersion: operationVersion, ActionableKey: peopleOperationText(body, "actionableKey", "actionable_key"),
		ObjectVersion: peopleOperationText(body, "objectVersion", "object_version"), NotificationID: peopleOperationText(body, "notificationId", "notification_id"),
		RecipientUIDs: peopleStringSlice(body["recipientUids"], body["recipient_uids"]), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_ack_conflict", "dead-letter actionable acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "published": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "people"}, nil
}

func (a *Adapter) listPendingPeopleDeadLetterClosures(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	limit, err := peopleIntegrationOperationLimit(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, err := repository.ListPendingDeadLetterClosures(ctx, trusted.TenantCode, trusted.DeploymentCode, "people", limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, item.OperationID); err != nil {
			if peopleUnsupportedOperation(err) {
				continue
			}
			return nil, err
		}
		result = append(result, map[string]any{"tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "people", "operationId": item.OperationID, "generation": item.Generation, "actionableKey": item.ActionableKey, "expectedVersion": item.ExpectedVersion, "nextVersion": item.NextVersion, "state": item.State, "recipientUids": item.RecipientUIDs})
	}
	return map[string]any{"items": result}, nil
}

func (a *Adapter) markPeopleDeadLetterClosureAcknowledged(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, operationID); err != nil {
		return nil, err
	}
	generation, generationErr := peopleUint64BodyValue(body, "generation")
	if generationErr != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_dead_letter_closure_ack_invalid", "generation is required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	marked, err := repository.MarkDeadLetterClosureAcknowledged(ctx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", OperationID: strings.TrimSpace(operationID), Generation: generation,
		ActionableKey: peopleOperationText(body, "actionableKey", "actionable_key"), ExpectedVersion: peopleOperationText(body, "expectedVersion", "expected_version"),
		NextVersion: peopleOperationText(body, "nextVersion", "next_version"), State: peopleOperationText(body, "state"), Now: time.Now().UTC(),
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_dead_letter_closure_ack_conflict", "dead-letter closure acknowledgement is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "generation": generation, "closureAcknowledged": marked, "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "people"}, nil
}

func (a *Adapter) listPeopleIntegrationOperationDiagnostics(ctx context.Context, query url.Values) (map[string]any, error) {
	body := peopleIntegrationOperationQueryBody(query)
	if err := requirePeopleIntegrationOperationAction(body, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation context is missing or invalid")
	}
	statuses, err := peopleIntegrationOperationStatuses(query.Get("status"))
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
	if limit < 1 || limit > integrationoperation.MaxDiagnosticLimit {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be between 1 and 100")
	}
	cursor, err := integrationoperation.DecodeDiagnosticCursor(query.Get("cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_cursor_invalid", "cursor is invalid")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	items, nextCursor, err := listAllowedPeopleIntegrationOperationDiagnostics(ctx, repository, integrationoperation.DiagnosticListInput{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", Statuses: statuses, Limit: limit, Cursor: cursor,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "nextCursor": nextCursor}, nil
}

// listAllowedPeopleIntegrationOperationDiagnostics preserves the repository's
// (updated_at, operation_id) keyset order while hiding operation families that
// People has not explicitly approved for browser diagnostics.  We overfetch in
// bounded repository pages until we see limit+1 allowed rows: the first limit
// form this response and the last returned allowed row becomes the next cursor.
//
// The next request starts after that allowed row, so it may re-read excluded
// rows between it and the next allowed row but can never skip an allowed row.
// This is deliberately preferable to returning the cursor from a raw filtered
// page, which would omit allowed rows when an unapproved family fills a page.
func listAllowedPeopleIntegrationOperationDiagnostics(ctx context.Context, repository *integrationoperation.Repository, input integrationoperation.DiagnosticListInput) ([]integrationoperation.DiagnosticOperation, string, error) {
	allowed := make([]integrationoperation.DiagnosticOperation, 0, input.Limit+1)
	scanCursor := input.Cursor
	for {
		page, err := repository.ListDiagnostics(ctx, integrationoperation.DiagnosticListInput{
			TenantCode: input.TenantCode, DeploymentCode: input.DeploymentCode, SourceApp: input.SourceApp,
			Statuses: input.Statuses, Limit: integrationoperation.MaxDiagnosticLimit, Cursor: scanCursor,
		})
		if err != nil {
			return nil, "", err
		}
		for _, item := range page.Items {
			if !validPeopleIntegrationOperation(item.TargetApp, item.OperationCode, item.RequiredCapability) {
				continue
			}
			allowed = append(allowed, item)
			if len(allowed) <= input.Limit {
				continue
			}
			nextCursor, err := integrationoperation.EncodeDiagnosticCursor(&integrationoperation.DiagnosticCursor{
				UpdatedAt: allowed[input.Limit-1].UpdatedAt, OperationID: allowed[input.Limit-1].OperationID,
			})
			if err != nil {
				return nil, "", err
			}
			return allowed[:input.Limit], nextCursor, nil
		}
		if page.NextCursor == nil {
			return allowed, "", nil
		}
		scanCursor = page.NextCursor
	}
}

func (a *Adapter) listPeopleIntegrationOperationAttempts(ctx context.Context, operationID string, query url.Values) (map[string]any, error) {
	body := peopleIntegrationOperationQueryBody(query)
	if err := requirePeopleIntegrationOperationAction(body, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation context is missing or invalid")
	}
	if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, operationID); err != nil {
		return nil, err
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
	items, err := repository.ListAttemptTimeline(ctx, integrationoperation.AttemptTimelineInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", OperationID: strings.TrimSpace(operationID), Limit: limit})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "items": items}, nil
}

func (a *Adapter) replayPeopleIntegrationOperation(ctx context.Context, operationID string, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationAction(body, "replay"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation context is missing or invalid")
	}
	if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, operationID); err != nil {
		return nil, err
	}
	actor := peopleOperationText(body, "current_user", "operator_uid")
	expectedVersion, versionErr := peopleUint64BodyValue(body, "expectedVersion", "expected_version")
	reason := peopleOperationText(body, "reason")
	if actor == "" || actor == "system" || expectedVersion == 0 || versionErr != nil || reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_replay_invalid", "trusted actor, expectedVersion and reason are required")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.Replay(ctx, integrationoperation.ReplayInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", OperationID: strings.TrimSpace(operationID), ExpectedVersion: expectedVersion, ActorUID: actor, Reason: reason, Now: time.Now().UTC()})
	if errors.Is(err, integrationoperation.ErrReplayRejected) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_replay_rejected", "operation is not replayable or its version changed")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "tenantCode": trusted.TenantCode, "deploymentCode": trusted.DeploymentCode, "sourceApp": "people", "status": string(result.Status), "version": result.Version}, nil
}

func (a *Adapter) requireAllowedPeopleIntegrationOperation(ctx context.Context, trusted integrationoperation.TrustedContext, operationID string) error {
	operationID = strings.TrimSpace(operationID)
	if !integrationoperation.IsValidOperationID(operationID) {
		return httperror.New(http.StatusBadRequest, "integration_operation_id_invalid", "integration operation id is invalid")
	}
	var targetApp, operationCode, capability string
	err := a.DB().QueryRowContext(ctx, `SELECT target_app,operation_code,required_capability FROM integration_operation WHERE operation_id=? AND tenant_code=? AND deployment_code=? AND source_app='people' LIMIT 1`, operationID, trusted.TenantCode, trusted.DeploymentCode).Scan(&targetApp, &operationCode, &capability)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "integration_operation_not_found", "integration operation was not found")
	}
	if err != nil {
		return err
	}
	if !validPeopleIntegrationOperation(targetApp, operationCode, capability) {
		return httperror.New(http.StatusNotFound, "integration_operation_not_supported", "integration operation family is not enabled for People administration")
	}
	return nil
}

func peopleCapabilityForOperation(operationCode string) string {
	switch operationCode {
	case peopleAssetsOffboardingOperationCode:
		return peopleAssetsOffboardingCapability
	case peopleDirectoryEmploymentOperation:
		return peopleDirectoryEmploymentCapability
	case peopleDirectoryOffboardingOperation:
		return peopleDirectoryOffboardingCapability
	default:
		return ""
	}
}

func peopleUnsupportedOperation(err error) bool {
	typed, ok := err.(httperror.Error)
	return ok && (typed.Code == "integration_operation_not_found" || typed.Code == "integration_operation_not_supported")
}

func peopleIntegrationOperationQueryBody(query url.Values) map[string]any {
	body := map[string]any{"current_user": strings.TrimSpace(query.Get("current_user")), "current_user_scopes": strings.Fields(query.Get("current_user_scopes"))}
	for _, key := range []string{integrationoperation.TrustedTenantCodeKey, integrationoperation.TrustedDeploymentCodeKey, integrationoperation.TrustedSourceAppKey, integrationoperation.TrustedServiceClientIDKey, integrationoperation.TrustedRequestIDKey} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			body[key] = value
		}
	}
	return body
}

func requirePeopleIntegrationOperationAction(body map[string]any, action string) error {
	required := "people:integration_operations:" + action
	for _, scope := range peopleScopeStrings(body["current_user_scopes"]) {
		if scope == "*" || scope == "people.*" || scope == required {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", required+" scope is required")
}

func peopleIntegrationOperationStatuses(value string) ([]integrationoperation.Status, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' })
	result := make([]integrationoperation.Status, 0, len(parts))
	for _, part := range parts {
		status := integrationoperation.Status(strings.TrimSpace(part))
		if !status.Valid() {
			return nil, httperror.New(http.StatusBadRequest, "integration_operation_status_invalid", "status filter is invalid")
		}
		result = append(result, status)
	}
	return result, nil
}

func peopleIntegrationOperationLimit(body map[string]any) (int, error) {
	if _, exists := body["limit"]; !exists {
		return 20, nil
	}
	limit, err := strconv.Atoi(peopleOperationText(body, "limit"))
	if err != nil || limit < 1 || limit > 20 {
		return 0, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be between 1 and 20")
	}
	return limit, nil
}

func peopleOperationText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			return strings.TrimSpace(fmt.Sprint(value))
		}
	}
	return ""
}

func peopleUint64BodyValue(body map[string]any, keys ...string) (uint64, error) {
	value := peopleOperationText(body, keys...)
	if value == "" {
		return 0, fmt.Errorf("value is missing")
	}
	return strconv.ParseUint(value, 10, 64)
}

func peopleStringSlice(values ...any) []string {
	result := make([]string, 0)
	for _, value := range values {
		switch typed := value.(type) {
		case []string:
			result = append(result, typed...)
		case []any:
			for _, item := range typed {
				result = append(result, strings.TrimSpace(fmt.Sprint(item)))
			}
		}
	}
	return result
}
