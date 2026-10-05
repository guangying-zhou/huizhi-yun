package assets

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) listAssetsIntegrationOperationDiagnostics(ctx context.Context, query url.Values) (map[string]any, error) {
	body := assetsIntegrationOperationQueryBody(query)
	if err := requireAssetsIntegrationOperationAction(body, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "assets")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets integration operation context is missing or invalid")
	}
	statuses, err := assetsIntegrationOperationStatuses(query.Get("status"))
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
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets",
		Statuses: statuses, Limit: limit, Cursor: cursor,
	})
	if err != nil {
		return nil, err
	}
	nextCursor, err := integrationoperation.EncodeDiagnosticCursor(page.NextCursor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": page.Items, "nextCursor": nullableAssetsText(nextCursor)}, nil
}

func (a *Adapter) listAssetsIntegrationOperationAttempts(ctx context.Context, operationID string, query url.Values) (map[string]any, error) {
	body := assetsIntegrationOperationQueryBody(query)
	if err := requireAssetsIntegrationOperationAction(body, "view"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "assets")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets integration operation context is missing or invalid")
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
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets",
		OperationID: strings.TrimSpace(operationID), Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": strings.TrimSpace(operationID), "items": items}, nil
}

func assetsIntegrationOperationQueryBody(query url.Values) map[string]any {
	body := map[string]any{
		"current_user":        strings.TrimSpace(query.Get("current_user")),
		"current_user_scopes": strings.Fields(query.Get("current_user_scopes")),
	}
	for _, key := range []string{
		integrationoperation.TrustedTenantCodeKey, integrationoperation.TrustedDeploymentCodeKey,
		integrationoperation.TrustedSourceAppKey, integrationoperation.TrustedServiceClientIDKey,
		integrationoperation.TrustedRequestIDKey,
	} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			body[key] = value
		}
	}
	return body
}

func assetsIntegrationOperationStatuses(value string) ([]integrationoperation.Status, error) {
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

func requireAssetsIntegrationOperationAction(body map[string]any, action string) error {
	required := "assets:integration_operations:" + action
	for _, scope := range assetsScopeStrings(body["current_user_scopes"]) {
		if scope == "*" || scope == "assets.*" || scope == required {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", required+" scope is required")
}

func assetsScopeStrings(value any) []string {
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

func assetsUint64BodyValue(body map[string]any, keys ...string) (uint64, error) {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			return strconv.ParseUint(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		}
	}
	return 0, fmt.Errorf("value is missing")
}

func assetsIntegrationOperationLimit(body map[string]any) (int, error) {
	value, exists := body["limit"]
	if !exists {
		return 20, nil
	}
	limit, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
	if err != nil || limit < 1 || limit > 20 {
		return 0, httperror.New(http.StatusBadRequest, "integration_operation_limit_invalid", "limit must be between 1 and 20")
	}
	return limit, nil
}

func assetsIntegrationOperationText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, exists := body[key]; exists {
			return strings.TrimSpace(fmt.Sprint(value))
		}
	}
	return ""
}

func assetsStringSlice(values ...any) []string {
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
