package deliveryledger

import (
	"context"
	"errors"
	"time"
)

type State string

const (
	StateProcessing     State = "processing"
	StateSucceeded      State = "succeeded"
	StateFailed         State = "failed"
	StatePartialUnknown State = "partial_unknown"
)

type Decision string

const (
	DecisionExecute         Decision = "execute"
	DecisionReplaySucceeded Decision = "replay_succeeded"
	DecisionInProgress      Decision = "in_progress"
	DecisionPartialUnknown  Decision = "partial_unknown"
)

var (
	ErrPayloadMismatch  = errors.New("delivery idempotency key already has a different request hash")
	ErrStaleClaim       = errors.New("delivery claim lease or fencing token is stale")
	ErrStoreUnavailable = errors.New("notification delivery store unavailable")
	ErrInvalidClaim     = errors.New("notification delivery claim is invalid")
	ErrInvalidQuery     = errors.New("notification delivery query is invalid")
	ErrDeliveryNotFound = errors.New("notification delivery was not found")
	ErrInvalidState     = errors.New("notification delivery state cannot be reconciled")
	ErrInvalidEvidence  = errors.New("notification delivery reconciliation evidence is invalid")
)

type Identity struct {
	Tenant         string
	Deployment     string
	SourceApp      string
	SourceClientID string
	IdempotencyKey string
}

type ClaimInput struct {
	Identity      Identity
	RequestHash   string
	Provider      string
	Integration   string
	LeaseOwner    string
	LeaseDuration time.Duration
}

type Claim struct {
	DeliveryID int64
	Decision   Decision
	State      State
	Fencing    int64
	ResultJSON []byte
}

type Completion struct {
	DeliveryID   int64
	LeaseOwner   string
	Fencing      int64
	ResultJSON   []byte
	ErrorCode    string
	ErrorSummary string
}

type ListInput struct {
	Tenant     string
	Deployment string
	State      State
	Limit      int
	BeforeID   int64
}

type Delivery struct {
	ID            int64      `json:"deliveryId"`
	SourceApp     string     `json:"sourceApp"`
	Provider      string     `json:"provider"`
	Integration   string     `json:"integrationCode"`
	State         State      `json:"status"`
	AttemptCount  int        `json:"attemptCount"`
	LastErrorCode string     `json:"lastErrorCode,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	SucceededAt   *time.Time `json:"succeededAt,omitempty"`
}

type ListResult struct {
	Deliveries []Delivery
	NextID     int64
}

type ReconcileInput struct {
	Tenant            string
	Deployment        string
	DeliveryID        int64
	ExpectedState     State
	Result            State
	ActorSourceApp    string
	ActorClientID     string
	ActorSubject      string
	Reason            string
	EvidenceType      string
	EvidenceReference string
	ProviderMessageID string
}

type ReconcileResult struct {
	Delivery Delivery
	AuditID  int64
}

type Store interface {
	Ready(context.Context) error
	List(context.Context, ListInput) (ListResult, error)
	Reconcile(context.Context, ReconcileInput) (ReconcileResult, error)
	Claim(context.Context, ClaimInput) (Claim, error)
	Succeed(context.Context, Completion) error
	Fail(context.Context, Completion) error
	MarkUnknown(context.Context, Completion) error
	Close() error
}
