package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrIdempotencyPayloadMismatch = errors.New("service command idempotency payload mismatch")
	ErrReceiptInProgress          = errors.New("service command receipt is still processing")
	ErrReceiptRejected            = errors.New("service command receipt was rejected")
)

const loadReceiptSQL = `
SELECT
  receipt_id,
  operation_id,
  required_capability,
  command_schema_version,
  command_sha256,
  status,
  target_biz_type,
  target_biz_code,
  response_http_status,
  response_summary_sha256,
  version_no
FROM service_command_receipt
WHERE tenant_code = ?
  AND source_deployment_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND target_app = ?
  AND operation_code = ?
  AND idempotency_key = ?
LIMIT 1
FOR UPDATE`

const insertReceiptSQL = `
INSERT INTO service_command_receipt (
  receipt_id,
  operation_id,
  operation_code,
  tenant_code,
  source_deployment_code,
  deployment_code,
  source_app,
  target_app,
  required_capability,
  idempotency_key,
  command_schema_version,
  command_sha256,
  status,
  fencing_token,
  version_no,
  first_request_id,
  last_request_id,
  correlation_id,
  original_actor_uid,
  service_client_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 1, 1, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE receipt_id = service_command_receipt.receipt_id`

const touchExistingReceiptSQL = `
UPDATE service_command_receipt
SET last_request_id = ?,
    last_received_at = UTC_TIMESTAMP(3),
    version_no = version_no + 1,
    updated_at = UTC_TIMESTAMP(3)
WHERE receipt_id = ?
  AND version_no = ?`

const repairExistingReceiptSummarySQL = `
UPDATE service_command_receipt
SET response_summary_sha256 = ?,
    last_request_id = ?,
    last_received_at = UTC_TIMESTAMP(3),
    version_no = version_no + 1,
    updated_at = UTC_TIMESTAMP(3)
WHERE receipt_id = ?
  AND status = 'succeeded'
  AND version_no = ?
  AND (response_summary_sha256 IS NULL OR response_summary_sha256 = '')`

const succeedReceiptSQL = `
UPDATE service_command_receipt
SET status = 'succeeded',
    target_biz_type = ?,
    target_biz_code = ?,
    response_http_status = ?,
    response_summary_sha256 = ?,
    locked_by = NULL,
    locked_until = NULL,
    completed_at = UTC_TIMESTAMP(3),
    version_no = version_no + 1,
    updated_at = UTC_TIMESTAMP(3)
WHERE receipt_id = ?
  AND status = 'processing'
  AND version_no = 1`

type ReceiptRepository struct {
	db           *sql.DB
	newReceiptID func() (string, error)
}

type ReceiptRepositoryOption func(*ReceiptRepository) error

func WithReceiptIDGenerator(generator func() (string, error)) ReceiptRepositoryOption {
	return func(repository *ReceiptRepository) error {
		if generator == nil {
			return fmt.Errorf("receipt ID generator is required")
		}
		repository.newReceiptID = generator
		return nil
	}
}

func NewReceiptRepository(db *sql.DB, options ...ReceiptRepositoryOption) (*ReceiptRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("service command receipt database is required")
	}
	repository := &ReceiptRepository{db: db, newReceiptID: NewOperationID}
	for _, option := range options {
		if option == nil {
			return nil, fmt.Errorf("nil receipt repository option")
		}
		if err := option(repository); err != nil {
			return nil, err
		}
	}
	return repository, nil
}

type ReceiptCommandInput struct {
	TrustedContext       TrustedContext
	SourceDeploymentCode string
	TargetDeploymentCode string
	TargetApp            string
	OperationID          string
	OperationCode        string
	RequiredCapability   string
	IdempotencyKey       string
	CommandSchemaVersion string
	CommandSHA256        string
	Command              json.RawMessage
	CorrelationID        string
	OriginalActorUID     string
}

type ReceiptBusinessResult struct {
	TargetBizType         string
	TargetBizCode         string
	HTTPStatus            int
	ResponseSummarySHA256 string
	Value                 any
}

type ReceiptExecutionResult struct {
	ReceiptID             string
	Existing              bool
	TargetBizType         string
	TargetBizCode         string
	HTTPStatus            int
	ResponseSummarySHA256 string
	Value                 any
}

type ReceiptEvidence struct {
	ReceiptID             string
	OperationID           string
	OperationCode         string
	IdempotencyKey        string
	CommandSchemaVersion  string
	CommandSHA256         string
	TargetBizType         string
	TargetBizCode         string
	ResponseSummarySHA256 string
}

func ValidateReceiptEvidence(expected ReceiptEvidence, actual ReceiptEvidence) error {
	if err := ValidateOperationID(actual.ReceiptID); err != nil {
		return ErrIdempotencyPayloadMismatch
	}
	if expected.OperationID != actual.OperationID ||
		expected.OperationCode != actual.OperationCode ||
		expected.IdempotencyKey != actual.IdempotencyKey ||
		expected.CommandSchemaVersion != actual.CommandSchemaVersion ||
		expected.CommandSHA256 != actual.CommandSHA256 ||
		expected.TargetBizType != actual.TargetBizType ||
		expected.TargetBizCode != actual.TargetBizCode ||
		!sha256Pattern.MatchString(actual.ResponseSummarySHA256) {
		return ErrIdempotencyPayloadMismatch
	}
	return nil
}

type ReceiptHandler func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error)

type receiptRow struct {
	receiptID             string
	operationID           string
	requiredCapability    string
	commandSchemaVersion  string
	commandSHA256         string
	status                string
	targetBizType         sql.NullString
	targetBizCode         sql.NullString
	responseHTTPStatus    sql.NullInt64
	responseSummarySHA256 sql.NullString
	version               uint64
}

func (r *ReceiptRepository) Execute(ctx context.Context, input ReceiptCommandInput, handler ReceiptHandler) (ReceiptExecutionResult, error) {
	if err := validateReceiptCommandInput(input); err != nil {
		return ReceiptExecutionResult{}, err
	}
	if handler == nil {
		return ReceiptExecutionResult{}, fmt.Errorf("service command receipt handler is required")
	}

	tx, err := beginTx(ctx, r.db)
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	defer rollback(tx)

	existing, err := loadReceipt(ctx, tx, input)
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	if existing != nil {
		return finishExistingReceipt(ctx, tx, input, *existing)
	}

	receiptID, err := r.newReceiptID()
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	if err := ValidateOperationID(receiptID); err != nil {
		return ReceiptExecutionResult{}, fmt.Errorf("invalid generated receipt ID: %w", err)
	}
	insertResult, err := tx.ExecContext(
		ctx,
		insertReceiptSQL,
		receiptID,
		input.OperationID,
		input.OperationCode,
		input.TrustedContext.TenantCode,
		receiptSourceDeployment(input),
		receiptTargetDeployment(input),
		input.TrustedContext.SourceApp,
		input.TargetApp,
		input.RequiredCapability,
		input.IdempotencyKey,
		input.CommandSchemaVersion,
		input.CommandSHA256,
		nullableText(input.TrustedContext.RequestID),
		nullableText(input.TrustedContext.RequestID),
		nullableText(input.CorrelationID),
		nullableText(input.OriginalActorUID),
		nullableText(input.TrustedContext.ServiceClientID),
	)
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	inserted, err := insertResult.RowsAffected()
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	if inserted == 0 {
		existing, err := loadReceipt(ctx, tx, input)
		if err != nil {
			return ReceiptExecutionResult{}, err
		}
		if existing == nil {
			return ReceiptExecutionResult{}, ErrIdempotencyPayloadMismatch
		}
		return finishExistingReceipt(ctx, tx, input, *existing)
	}
	if inserted != 1 {
		return ReceiptExecutionResult{}, fmt.Errorf("unexpected service command receipt insert count %d", inserted)
	}

	business, err := handler(ctx, tx, append(json.RawMessage(nil), input.Command...))
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	if err := validateReceiptBusinessResult(business); err != nil {
		return ReceiptExecutionResult{}, err
	}
	if business.ResponseSummarySHA256 == "" {
		business.ResponseSummarySHA256, err = ValidateAndDigestCommand(map[string]any{
			"targetBizType": business.TargetBizType,
			"targetBizCode": business.TargetBizCode,
		})
		if err != nil {
			return ReceiptExecutionResult{}, err
		}
	}
	httpStatus := business.HTTPStatus
	if httpStatus == 0 {
		httpStatus = 200
	}
	result, err := tx.ExecContext(
		ctx,
		succeedReceiptSQL,
		nullableText(business.TargetBizType),
		nullableText(business.TargetBizCode),
		httpStatus,
		nullableText(business.ResponseSummarySHA256),
		receiptID,
	)
	if err != nil {
		return ReceiptExecutionResult{}, err
	}
	if err := requireOneRow(result); err != nil {
		return ReceiptExecutionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ReceiptExecutionResult{}, err
	}
	return ReceiptExecutionResult{
		ReceiptID:             receiptID,
		TargetBizType:         business.TargetBizType,
		TargetBizCode:         business.TargetBizCode,
		HTTPStatus:            httpStatus,
		ResponseSummarySHA256: business.ResponseSummarySHA256,
		Value:                 business.Value,
	}, nil
}

func finishExistingReceipt(
	ctx context.Context,
	tx *sql.Tx,
	input ReceiptCommandInput,
	existing receiptRow,
) (ReceiptExecutionResult, error) {
	if !receiptMatchesInput(existing, input) {
		return ReceiptExecutionResult{}, ErrIdempotencyPayloadMismatch
	}
	switch existing.status {
	case "succeeded":
		if !sha256Pattern.MatchString(existing.responseSummarySHA256.String) {
			if existing.responseSummarySHA256.String != "" {
				return ReceiptExecutionResult{}, fmt.Errorf("%w: invalid succeeded receipt response summary", ErrCorruptOperation)
			}
			if err := validateOptionalIdentityValue("target_biz_type", existing.targetBizType.String); err != nil ||
				existing.targetBizType.String == "" {
				return ReceiptExecutionResult{}, fmt.Errorf("%w: missing succeeded receipt target business type", ErrCorruptOperation)
			}
			if err := validateOptionalIdentityValue("target_biz_code", existing.targetBizCode.String); err != nil ||
				existing.targetBizCode.String == "" {
				return ReceiptExecutionResult{}, fmt.Errorf("%w: missing succeeded receipt target business code", ErrCorruptOperation)
			}
			digest, err := ValidateAndDigestCommand(map[string]any{
				"targetBizType": existing.targetBizType.String,
				"targetBizCode": existing.targetBizCode.String,
			})
			if err != nil {
				return ReceiptExecutionResult{}, err
			}
			result, err := tx.ExecContext(
				ctx,
				repairExistingReceiptSummarySQL,
				digest,
				nullableText(input.TrustedContext.RequestID),
				existing.receiptID,
				existing.version,
			)
			if err != nil {
				return ReceiptExecutionResult{}, err
			}
			if err := requireOneRow(result); err != nil {
				return ReceiptExecutionResult{}, err
			}
			if err := tx.Commit(); err != nil {
				return ReceiptExecutionResult{}, err
			}
			existing.responseSummarySHA256 = sql.NullString{String: digest, Valid: true}
			return receiptExecutionFromRow(existing), nil
		}
		result, err := tx.ExecContext(ctx, touchExistingReceiptSQL, nullableText(input.TrustedContext.RequestID), existing.receiptID, existing.version)
		if err != nil {
			return ReceiptExecutionResult{}, err
		}
		if err := requireOneRow(result); err != nil {
			return ReceiptExecutionResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return ReceiptExecutionResult{}, err
		}
		return receiptExecutionFromRow(existing), nil
	case "processing":
		return ReceiptExecutionResult{}, ErrReceiptInProgress
	case "rejected":
		return ReceiptExecutionResult{}, ErrReceiptRejected
	default:
		return ReceiptExecutionResult{}, fmt.Errorf("unknown service command receipt status %q", existing.status)
	}
}

func validateReceiptCommandInput(input ReceiptCommandInput) error {
	if err := ValidateOperationID(input.OperationID); err != nil {
		return err
	}
	identity := Identity{
		TenantCode:     strings.TrimSpace(input.TrustedContext.TenantCode),
		DeploymentCode: receiptSourceDeployment(input),
		SourceApp:      strings.TrimSpace(input.TrustedContext.SourceApp),
		TargetApp:      strings.TrimSpace(input.TargetApp),
		OperationCode:  strings.TrimSpace(input.OperationCode),
		SourceBizType:  "service_command",
		SourceBizCode:  input.OperationID,
		IdempotencyKey: strings.TrimSpace(input.IdempotencyKey),
		CommandSHA256:  strings.TrimSpace(input.CommandSHA256),
	}
	if err := identity.Validate(); err != nil {
		return err
	}
	if !identityValuePattern.MatchString(receiptTargetDeployment(input)) {
		return fmt.Errorf("%w: target_deployment_code", ErrInvalidIdentity)
	}
	if !identityValuePattern.MatchString(strings.TrimSpace(input.RequiredCapability)) {
		return fmt.Errorf("%w: required_capability", ErrInvalidIdentity)
	}
	if !identityValuePattern.MatchString(strings.TrimSpace(input.CommandSchemaVersion)) {
		return fmt.Errorf("%w: command_schema_version", ErrInvalidIdentity)
	}
	for name, value := range map[string]string{
		"service_client_id":  input.TrustedContext.ServiceClientID,
		"request_id":         input.TrustedContext.RequestID,
		"correlation_id":     input.CorrelationID,
		"original_actor_uid": input.OriginalActorUID,
	} {
		if err := validateOptionalIdentityValue(name, strings.TrimSpace(value)); err != nil {
			return err
		}
	}
	var command any
	if len(input.Command) == 0 || json.Unmarshal(input.Command, &command) != nil {
		return fmt.Errorf("service command must be valid JSON")
	}
	digest, err := ValidateAndDigestCommand(command)
	if err != nil {
		return err
	}
	if digest != input.CommandSHA256 {
		return ErrIdempotencyPayloadMismatch
	}
	return nil
}

func validateReceiptBusinessResult(result ReceiptBusinessResult) error {
	if (strings.TrimSpace(result.TargetBizType) == "") != (strings.TrimSpace(result.TargetBizCode) == "") {
		return fmt.Errorf("target business type and code must be supplied together")
	}
	if err := validateOptionalIdentityValue("target_biz_type", strings.TrimSpace(result.TargetBizType)); err != nil {
		return err
	}
	if err := validateOptionalIdentityValue("target_biz_code", strings.TrimSpace(result.TargetBizCode)); err != nil {
		return err
	}
	if err := validateHTTPStatus(result.HTTPStatus); err != nil {
		return err
	}
	return validateOptionalSHA256("response_summary_sha256", strings.TrimSpace(result.ResponseSummarySHA256))
}

func loadReceipt(ctx context.Context, tx *sql.Tx, input ReceiptCommandInput) (*receiptRow, error) {
	var row receiptRow
	err := tx.QueryRowContext(
		ctx,
		loadReceiptSQL,
		input.TrustedContext.TenantCode,
		receiptSourceDeployment(input),
		receiptTargetDeployment(input),
		input.TrustedContext.SourceApp,
		input.TargetApp,
		input.OperationCode,
		input.IdempotencyKey,
	).Scan(
		&row.receiptID,
		&row.operationID,
		&row.requiredCapability,
		&row.commandSchemaVersion,
		&row.commandSHA256,
		&row.status,
		&row.targetBizType,
		&row.targetBizCode,
		&row.responseHTTPStatus,
		&row.responseSummarySHA256,
		&row.version,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func receiptSourceDeployment(input ReceiptCommandInput) string {
	if value := strings.TrimSpace(input.SourceDeploymentCode); value != "" {
		return value
	}
	return strings.TrimSpace(input.TrustedContext.DeploymentCode)
}

func receiptTargetDeployment(input ReceiptCommandInput) string {
	if value := strings.TrimSpace(input.TargetDeploymentCode); value != "" {
		return value
	}
	return strings.TrimSpace(input.TrustedContext.DeploymentCode)
}

func receiptMatchesInput(row receiptRow, input ReceiptCommandInput) bool {
	return row.operationID == input.OperationID &&
		row.requiredCapability == input.RequiredCapability &&
		row.commandSchemaVersion == input.CommandSchemaVersion &&
		row.commandSHA256 == input.CommandSHA256
}

func receiptExecutionFromRow(row receiptRow) ReceiptExecutionResult {
	return ReceiptExecutionResult{
		ReceiptID:             row.receiptID,
		Existing:              true,
		TargetBizType:         row.targetBizType.String,
		TargetBizCode:         row.targetBizCode.String,
		HTTPStatus:            int(row.responseHTTPStatus.Int64),
		ResponseSummarySHA256: row.responseSummarySHA256.String,
	}
}
