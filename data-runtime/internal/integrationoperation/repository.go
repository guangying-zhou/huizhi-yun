package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"
)

var (
	ErrOperationNotFound = errors.New("integration operation not found")
	ErrStaleFencing      = errors.New("stale integration operation fencing token")
	ErrPersistenceRace   = errors.New("integration operation persistence race")
	ErrReplayRejected    = errors.New("integration operation replay rejected")
	ErrCorruptOperation  = errors.New("corrupt integration operation")
)

type AttemptTrigger string

const (
	AttemptTriggerImmediate     AttemptTrigger = "immediate"
	AttemptTriggerScheduled     AttemptTrigger = "scheduled"
	AttemptTriggerManualReplay  AttemptTrigger = "manual_replay"
	AttemptTriggerLeaseRecovery AttemptTrigger = "lease_recovery"
)

type Repository struct {
	outboxTables *OutboxTables
	db           *sql.DB
	retryPolicy  RetryPolicy
	randomUnit   func() float64
	newAttemptID func() (string, error)
}

type RepositoryOption func(*Repository) error

func WithRepositoryRetryPolicy(policy RetryPolicy) RepositoryOption {
	return func(repository *Repository) error {
		if err := policy.Validate(); err != nil {
			return err
		}
		repository.retryPolicy = policy
		return nil
	}
}

func WithRepositoryRandomUnit(randomUnit func() float64) RepositoryOption {
	return func(repository *Repository) error {
		if randomUnit == nil {
			return fmt.Errorf("repository random source is required")
		}
		repository.randomUnit = randomUnit
		return nil
	}
}

func WithAttemptIDGenerator(generator func() (string, error)) RepositoryOption {
	return func(repository *Repository) error {
		if generator == nil {
			return fmt.Errorf("attempt ID generator is required")
		}
		repository.newAttemptID = generator
		return nil
	}
}

func NewRepository(db *sql.DB, options ...RepositoryOption) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("integration operation database is required")
	}
	repository := &Repository{
		db:           db,
		retryPolicy:  DefaultRetryPolicy(),
		randomUnit:   rand.Float64,
		newAttemptID: NewOperationID,
	}
	for _, option := range options {
		if option == nil {
			return nil, fmt.Errorf("nil repository option")
		}
		if err := option(repository); err != nil {
			return nil, err
		}
	}
	return repository, nil
}

type ClaimedOperation struct {
	OperationID           string
	OperationKey          string
	CorrelationKey        string
	SequenceNo            uint64
	DependsOnOperationKey string
	Identity              Identity
	RequiredCapability    string
	TargetBizType         string
	TargetBizCode         string
	CommandSchemaVersion  string
	Command               json.RawMessage
	AttemptID             string
	AttemptCount          int
	MaxAttempts           int
	FencingToken          uint64
	Version               uint64
	Worker                string
	LockedUntil           time.Time
	OriginalRequestID     string
	CorrelationID         string
	OriginalActorUID      string
	ServiceClientID       string
	CreatedAt             time.Time
	Trigger               AttemptTrigger
}

type CompletionLease struct {
	OperationID  string
	Worker       string
	FencingToken uint64
}

type RecordSuccessInput struct {
	Lease                 CompletionLease
	Now                   time.Time
	HTTPStatus            int
	TargetReceiptID       string
	TargetBizType         string
	TargetBizCode         string
	ResponseSummarySHA256 string
	Duration              time.Duration
}

type RecordFailureInput struct {
	Lease                 CompletionLease
	Now                   time.Time
	Failure               FailureInput
	ErrorCode             string
	ErrorSummary          string
	RetryAfter            *time.Duration
	DeliveryUncertain     bool
	ResponseSummarySHA256 string
	Duration              time.Duration
}

type RecordResult struct {
	Status   Status
	Version  uint64
	Decision RetryDecision
}

type ReplayInput struct {
	TenantCode      string
	DeploymentCode  string
	SourceApp       string
	OperationID     string
	ExpectedVersion uint64
	ActorUID        string
	Reason          string
	Now             time.Time
}

func validateRepositoryScope(tenantCode string, deploymentCode string, sourceApp string, worker string, now time.Time, lease time.Duration) error {
	for name, value := range map[string]string{
		"tenant_code":     tenantCode,
		"deployment_code": deploymentCode,
		"source_app":      sourceApp,
		"worker":          worker,
	} {
		if !identityValuePattern.MatchString(value) {
			return fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
		}
	}
	if now.IsZero() {
		return fmt.Errorf("claim time is required")
	}
	if lease <= 0 {
		return fmt.Errorf("lease duration must be positive")
	}
	return nil
}

func validateCompletionLease(lease CompletionLease) error {
	if err := ValidateOperationID(lease.OperationID); err != nil {
		return err
	}
	if !identityValuePattern.MatchString(lease.Worker) {
		return fmt.Errorf("%w: worker", ErrInvalidIdentity)
	}
	if lease.FencingToken == 0 {
		return fmt.Errorf("fencing token must be positive")
	}
	return nil
}

func validateOptionalIdentityValue(name string, value string) error {
	if value != "" && !identityValuePattern.MatchString(value) {
		return fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
	}
	return nil
}

func validateOptionalSHA256(name string, value string) error {
	if value != "" && !sha256Pattern.MatchString(value) {
		return fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
	}
	return nil
}

func validateHTTPStatus(status int) error {
	if status != 0 && (status < 100 || status > 599) {
		return fmt.Errorf("HTTP status must be zero or between 100 and 599")
	}
	return nil
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableHTTPStatus(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func durationMilliseconds(duration time.Duration) (uint64, error) {
	if duration < 0 {
		return 0, fmt.Errorf("duration must not be negative")
	}
	return uint64(duration / time.Millisecond), nil
}

func rollback(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}

func requireOneRow(result sql.Result) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrPersistenceRace
	}
	return nil
}

func beginTx(ctx context.Context, db *sql.DB) (*sql.Tx, error) {
	return db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
}
