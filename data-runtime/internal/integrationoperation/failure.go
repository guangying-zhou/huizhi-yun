package integrationoperation

import (
	"context"
	"errors"
	"fmt"
)

type FailureClass string

const (
	FailureNone               FailureClass = "none"
	FailureAuthentication     FailureClass = "authentication"
	FailureAuthorization      FailureClass = "authorization"
	FailureContract           FailureClass = "contract"
	FailureConflict           FailureClass = "conflict"
	FailureTransient          FailureClass = "transient"
	FailureIdempotentExisting FailureClass = "idempotent_existing"

	// FailurePermanent is retained for compatibility with the first P0 API and
	// any rows serialized with that value. ClassifyFailure never emits it; new
	// code should persist and branch on the specific permanent class.
	FailurePermanent FailureClass = "permanent"
)

type ConflictDisposition string

const (
	ConflictUnspecified        ConflictDisposition = ""
	ConflictPermanent          ConflictDisposition = "permanent"
	ConflictIdempotentExisting ConflictDisposition = "idempotent_existing"
	ConflictInProgress         ConflictDisposition = "in_progress"
)

type RetryHint string

const (
	RetryHintDefault RetryHint = ""
	RetryHintShort   RetryHint = "short"
)

type FailureInput struct {
	HTTPStatus          int
	Err                 error
	ConflictDisposition ConflictDisposition

	// IdempotentExisting is retained for callers compiled against the first
	// P0 API. ConflictDisposition takes precedence when both are supplied.
	IdempotentExisting bool
}

type FailureClassification struct {
	Class      FailureClass
	HTTPStatus int
	TimedOut   bool
	RetryHint  RetryHint
}

type timeoutError interface {
	Timeout() bool
}

func ClassifyFailure(input FailureInput) FailureClassification {
	timedOut := errors.Is(input.Err, context.DeadlineExceeded)
	var timeout timeoutError
	if errors.As(input.Err, &timeout) && timeout.Timeout() {
		timedOut = true
	}

	classification := FailureClassification{
		Class:      FailureNone,
		HTTPStatus: input.HTTPStatus,
		TimedOut:   timedOut,
	}

	status := input.HTTPStatus
	if status == 409 {
		disposition := input.ConflictDisposition
		if disposition == ConflictUnspecified && input.IdempotentExisting {
			disposition = ConflictIdempotentExisting
		}
		switch disposition {
		case ConflictIdempotentExisting:
			classification.Class = FailureIdempotentExisting
		case ConflictInProgress:
			classification.Class = FailureTransient
			classification.RetryHint = RetryHintShort
		default:
			classification.Class = FailureConflict
		}
		return classification
	}
	if status == 408 || status == 425 || status == 429 || status >= 500 && status <= 599 {
		classification.Class = FailureTransient
		return classification
	}
	if status == 401 {
		classification.Class = FailureAuthentication
		return classification
	}
	if status == 403 {
		classification.Class = FailureAuthorization
		return classification
	}
	if status >= 300 {
		classification.Class = FailureContract
		return classification
	}
	if input.Err != nil {
		classification.Class = FailureTransient
	}
	return classification
}

type FailureResolutionInput struct {
	Classification    FailureClassification
	AttemptCount      int
	MaxAttempts       int
	DeliveryUncertain bool
}

func ResolveFailure(input FailureResolutionInput) (Status, error) {
	if input.AttemptCount < 0 {
		return "", fmt.Errorf("attempt count must not be negative")
	}
	if input.MaxAttempts <= 0 {
		return "", fmt.Errorf("max attempts must be positive")
	}

	switch input.Classification.Class {
	case FailureIdempotentExisting:
		return StatusSucceeded, nil
	case FailureAuthentication, FailureAuthorization, FailureContract, FailureConflict, FailurePermanent:
		return StatusFailedPermanent, nil
	case FailureTransient:
		if input.AttemptCount >= input.MaxAttempts {
			return StatusDeadLetter, nil
		}
		if input.DeliveryUncertain {
			return StatusPartialUnknown, nil
		}
		return StatusRetryWait, nil
	case FailureNone:
		return "", fmt.Errorf("cannot resolve a non-failure classification")
	default:
		return "", fmt.Errorf("unknown failure classification %q", input.Classification.Class)
	}
}
