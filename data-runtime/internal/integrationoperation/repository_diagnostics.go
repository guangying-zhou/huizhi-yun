package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	DefaultDiagnosticLimit = 50
	MaxDiagnosticLimit     = 100
)

type DiagnosticCursor struct {
	UpdatedAt   time.Time `json:"updatedAt"`
	OperationID string    `json:"operationId"`
}

type DiagnosticListInput struct {
	TenantCode     string
	DeploymentCode string
	SourceApp      string
	Statuses       []Status
	Limit          int
	Cursor         *DiagnosticCursor
}

// DiagnosticOperation deliberately omits command_json and all response bodies.
// Operators receive immutable identity, hashes, state and already-sanitized
// failure metadata only.
type DiagnosticOperation struct {
	OperationID          string     `json:"operationId"`
	OperationKey         string     `json:"operationKey"`
	CorrelationKey       string     `json:"correlationKey"`
	TargetApp            string     `json:"targetApp"`
	OperationCode        string     `json:"operationCode"`
	RequiredCapability   string     `json:"requiredCapability"`
	SourceBizType        string     `json:"sourceBizType"`
	SourceBizCode        string     `json:"sourceBizCode"`
	TargetBizType        string     `json:"targetBizType,omitempty"`
	TargetBizCode        string     `json:"targetBizCode,omitempty"`
	IdempotencyKey       string     `json:"idempotencyKey"`
	CommandSchemaVersion string     `json:"commandSchemaVersion"`
	CommandSHA256        string     `json:"commandSha256"`
	Status               Status     `json:"status"`
	AttemptCount         int        `json:"attemptCount"`
	MaxAttempts          int        `json:"maxAttempts"`
	NextAttemptAt        time.Time  `json:"nextAttemptAt"`
	LastAttemptAt        *time.Time `json:"lastAttemptAt,omitempty"`
	LockedBy             string     `json:"lockedBy,omitempty"`
	LockedUntil          *time.Time `json:"lockedUntil,omitempty"`
	Version              uint64     `json:"version"`
	ReplayCount          int        `json:"replayCount"`
	LastHTTPStatus       int        `json:"lastHttpStatus,omitempty"`
	LastErrorCode        string     `json:"lastErrorCode,omitempty"`
	LastErrorClass       string     `json:"lastErrorClass,omitempty"`
	LastErrorSummary     string     `json:"lastErrorSummary,omitempty"`
	LastErrorAt          *time.Time `json:"lastErrorAt,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type DiagnosticPage struct {
	Items      []DiagnosticOperation `json:"items"`
	NextCursor *DiagnosticCursor     `json:"-"`
}

func EncodeDiagnosticCursor(cursor *DiagnosticCursor) (string, error) {
	if cursor == nil {
		return "", nil
	}
	if cursor.UpdatedAt.IsZero() || !IsValidOperationID(cursor.OperationID) {
		return "", fmt.Errorf("invalid diagnostic cursor")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func DecodeDiagnosticCursor(value string) (*DiagnosticCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("invalid diagnostic cursor")
	}
	var cursor DiagnosticCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.UpdatedAt.IsZero() || !IsValidOperationID(cursor.OperationID) {
		return nil, fmt.Errorf("invalid diagnostic cursor")
	}
	return &cursor, nil
}

func (r *Repository) ListDiagnostics(ctx context.Context, input DiagnosticListInput) (DiagnosticPage, error) {
	for name, value := range map[string]string{
		"tenant_code":     input.TenantCode,
		"deployment_code": input.DeploymentCode,
		"source_app":      input.SourceApp,
	} {
		if !identityValuePattern.MatchString(value) {
			return DiagnosticPage{}, fmt.Errorf("%w: diagnostic %s", ErrInvalidIdentity, name)
		}
	}
	limit := input.Limit
	if limit < 1 || limit > MaxDiagnosticLimit {
		return DiagnosticPage{}, fmt.Errorf("diagnostic limit must be between 1 and %d", MaxDiagnosticLimit)
	}
	statuses := input.Statuses
	if len(statuses) == 0 {
		statuses = []Status{
			StatusPending, StatusProcessing, StatusRetryWait, StatusPartialUnknown,
			StatusSucceeded, StatusFailedPermanent, StatusDeadLetter, StatusCancelled,
		}
	}
	statusPlaceholders := make([]string, 0, len(statuses))
	args := []any{input.TenantCode, input.DeploymentCode, input.SourceApp}
	seen := make(map[Status]struct{}, len(statuses))
	for _, status := range statuses {
		if !status.Valid() {
			return DiagnosticPage{}, fmt.Errorf("%w: diagnostic status %q", ErrInvalidStatus, status)
		}
		if _, exists := seen[status]; exists {
			continue
		}
		seen[status] = struct{}{}
		statusPlaceholders = append(statusPlaceholders, "?")
		args = append(args, status)
	}

	query := diagnosticListSelect + "\nWHERE tenant_code = ? AND deployment_code = ? AND source_app = ?" +
		"\n  AND status IN (" + strings.Join(statusPlaceholders, ", ") + ")"
	if input.Cursor != nil {
		if input.Cursor.UpdatedAt.IsZero() || !IsValidOperationID(input.Cursor.OperationID) {
			return DiagnosticPage{}, fmt.Errorf("invalid diagnostic cursor")
		}
		query += "\n  AND (updated_at < ? OR (updated_at = ? AND operation_id < ?))"
		args = append(args, input.Cursor.UpdatedAt, input.Cursor.UpdatedAt, input.Cursor.OperationID)
	}
	query += "\nORDER BY updated_at DESC, operation_id DESC\nLIMIT ?"
	args = append(args, limit+1)

	rows, err := r.db.QueryContext(ctx, r.sql(query), args...)
	if err != nil {
		return DiagnosticPage{}, err
	}
	defer rows.Close()
	items := make([]DiagnosticOperation, 0, limit+1)
	for rows.Next() {
		item, err := scanDiagnosticOperation(rows)
		if err != nil {
			return DiagnosticPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return DiagnosticPage{}, err
	}
	page := DiagnosticPage{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = &DiagnosticCursor{UpdatedAt: last.UpdatedAt, OperationID: last.OperationID}
	}
	return page, nil
}

const diagnosticListSelect = `SELECT
  operation_id, operation_key, correlation_key, target_app, operation_code,
  required_capability, source_biz_type, source_biz_code,
  target_biz_type, target_biz_code, idempotency_key,
  command_schema_version, command_sha256, status,
  attempt_count, max_attempts, next_attempt_at, last_attempt_at,
  locked_by, locked_until, version_no, replay_count,
  last_http_status, last_error_code, last_error_class, last_error_summary,
  last_error_at, created_at, updated_at
FROM integration_operation`

type diagnosticScanner interface {
	Scan(dest ...any) error
}

func scanDiagnosticOperation(scanner diagnosticScanner) (DiagnosticOperation, error) {
	var item DiagnosticOperation
	var targetBizType, targetBizCode, lockedBy sql.NullString
	var lastAttemptAt, lockedUntil, lastErrorAt sql.NullTime
	var lastHTTPStatus sql.NullInt64
	var lastErrorCode, lastErrorClass, lastErrorSummary sql.NullString
	var status string
	if err := scanner.Scan(
		&item.OperationID, &item.OperationKey, &item.CorrelationKey, &item.TargetApp, &item.OperationCode,
		&item.RequiredCapability, &item.SourceBizType, &item.SourceBizCode,
		&targetBizType, &targetBizCode, &item.IdempotencyKey,
		&item.CommandSchemaVersion, &item.CommandSHA256, &status,
		&item.AttemptCount, &item.MaxAttempts, &item.NextAttemptAt, &lastAttemptAt,
		&lockedBy, &lockedUntil, &item.Version, &item.ReplayCount,
		&lastHTTPStatus, &lastErrorCode, &lastErrorClass, &lastErrorSummary,
		&lastErrorAt, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return DiagnosticOperation{}, err
	}
	item.Status = Status(status)
	if !item.Status.Valid() || !IsValidOperationID(item.OperationID) {
		return DiagnosticOperation{}, ErrCorruptOperation
	}
	item.TargetBizType = targetBizType.String
	item.TargetBizCode = targetBizCode.String
	item.LockedBy = lockedBy.String
	item.LastErrorCode = lastErrorCode.String
	item.LastErrorClass = lastErrorClass.String
	item.LastErrorSummary = lastErrorSummary.String
	if lastHTTPStatus.Valid {
		item.LastHTTPStatus = int(lastHTTPStatus.Int64)
	}
	if lastAttemptAt.Valid {
		value := lastAttemptAt.Time
		item.LastAttemptAt = &value
	}
	if lockedUntil.Valid {
		value := lockedUntil.Time
		item.LockedUntil = &value
	}
	if lastErrorAt.Valid {
		value := lastErrorAt.Time
		item.LastErrorAt = &value
	}
	return item, nil
}
