package integrationoperation

import (
	"fmt"
	"time"
)

const (
	DefaultMaxAttempts     = 8
	DefaultMaxElapsed      = 24 * time.Hour
	DefaultRetryAfterCap   = time.Hour
	DefaultInProgressDelay = 10 * time.Second
)

type RetryDecisionReason string

const (
	RetryReasonResolved     RetryDecisionReason = "resolved"
	RetryReasonPermanent    RetryDecisionReason = "permanent"
	RetryReasonAttemptLimit RetryDecisionReason = "attempt_limit"
	RetryReasonElapsedLimit RetryDecisionReason = "elapsed_limit"
	RetryReasonScheduled    RetryDecisionReason = "scheduled"
)

type RetryPolicy struct {
	MaxAttempts     int
	MaxElapsed      time.Duration
	MaxRetryAfter   time.Duration
	InProgressDelay time.Duration
	Backoff         BackoffPolicy
}

func DefaultRetryPolicy() RetryPolicy {
	return RetryPolicy{
		MaxAttempts:     DefaultMaxAttempts,
		MaxElapsed:      DefaultMaxElapsed,
		MaxRetryAfter:   DefaultRetryAfterCap,
		InProgressDelay: DefaultInProgressDelay,
		Backoff:         DefaultBackoffPolicy(),
	}
}

func (p RetryPolicy) Validate() error {
	if p.MaxAttempts <= 0 {
		return fmt.Errorf("max attempts must be positive")
	}
	if p.MaxElapsed <= 0 {
		return fmt.Errorf("max elapsed must be positive")
	}
	if p.MaxRetryAfter <= 0 {
		return fmt.Errorf("max Retry-After must be positive")
	}
	if p.InProgressDelay <= 0 {
		return fmt.Errorf("in-progress delay must be positive")
	}
	return p.Backoff.Validate()
}

type RetryDecisionInput struct {
	Classification    FailureClassification
	AttemptCount      int
	FirstAttemptAt    time.Time
	Now               time.Time
	RetryAfter        *time.Duration
	RandomUnit        float64
	DeliveryUncertain bool
}

type RetryDecision struct {
	Status        Status
	Reason        RetryDecisionReason
	Retry         bool
	Delay         time.Duration
	NextAttemptAt time.Time
}

func (p RetryPolicy) Decide(input RetryDecisionInput) (RetryDecision, error) {
	if err := p.Validate(); err != nil {
		return RetryDecision{}, err
	}
	if input.AttemptCount < 0 {
		return RetryDecision{}, fmt.Errorf("attempt count must not be negative")
	}

	switch input.Classification.Class {
	case FailureIdempotentExisting:
		return RetryDecision{Status: StatusSucceeded, Reason: RetryReasonResolved}, nil
	case FailureAuthentication, FailureAuthorization, FailureContract, FailureConflict, FailurePermanent:
		return RetryDecision{Status: StatusFailedPermanent, Reason: RetryReasonPermanent}, nil
	case FailureNone:
		return RetryDecision{}, fmt.Errorf("cannot decide retry for a non-failure classification")
	case FailureTransient:
		// Continue below.
	default:
		return RetryDecision{}, fmt.Errorf("unknown failure classification %q", input.Classification.Class)
	}

	if input.FirstAttemptAt.IsZero() || input.Now.IsZero() {
		return RetryDecision{}, fmt.Errorf("first attempt and current time are required for transient retry decisions")
	}
	if input.Now.Before(input.FirstAttemptAt) {
		return RetryDecision{}, fmt.Errorf("current time must not precede first attempt")
	}
	if input.AttemptCount == 0 {
		return RetryDecision{}, fmt.Errorf("attempt count must be positive for transient retry decisions")
	}
	if input.AttemptCount >= p.MaxAttempts {
		return RetryDecision{Status: StatusDeadLetter, Reason: RetryReasonAttemptLimit}, nil
	}
	deadline := input.FirstAttemptAt.Add(p.MaxElapsed)
	if !input.Now.Before(deadline) {
		return RetryDecision{Status: StatusDeadLetter, Reason: RetryReasonElapsedLimit}, nil
	}

	delay, err := p.transientDelay(input)
	if err != nil {
		return RetryDecision{}, err
	}
	remaining := deadline.Sub(input.Now)
	if delay > remaining {
		delay = remaining
	}
	status := StatusRetryWait
	if input.DeliveryUncertain {
		status = StatusPartialUnknown
	}
	return RetryDecision{
		Status:        status,
		Reason:        RetryReasonScheduled,
		Retry:         true,
		Delay:         delay,
		NextAttemptAt: input.Now.Add(delay),
	}, nil
}

func (p RetryPolicy) transientDelay(input RetryDecisionInput) (time.Duration, error) {
	if input.RetryAfter != nil {
		if *input.RetryAfter < 0 {
			return 0, fmt.Errorf("Retry-After must not be negative")
		}
		if *input.RetryAfter > p.MaxRetryAfter {
			return p.MaxRetryAfter, nil
		}
		return *input.RetryAfter, nil
	}
	if input.Classification.RetryHint == RetryHintShort {
		return p.InProgressDelay, nil
	}
	return p.Backoff.Delay(input.AttemptCount, input.RandomUnit)
}
