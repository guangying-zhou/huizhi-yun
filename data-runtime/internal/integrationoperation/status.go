package integrationoperation

import (
	"errors"
	"fmt"
)

type Status string

const (
	StatusPending         Status = "pending"
	StatusProcessing      Status = "processing"
	StatusRetryWait       Status = "retry_wait"
	StatusPartialUnknown  Status = "partial_unknown"
	StatusSucceeded       Status = "succeeded"
	StatusFailedPermanent Status = "failed_permanent"
	StatusDeadLetter      Status = "dead_letter"
	StatusCancelled       Status = "cancelled"
)

var (
	ErrInvalidStatus     = errors.New("invalid integration operation status")
	ErrIllegalTransition = errors.New("illegal integration operation status transition")
)

var legalTransitions = map[Status]map[Status]struct{}{
	StatusPending: {
		StatusProcessing:      {},
		StatusFailedPermanent: {},
		StatusDeadLetter:      {},
		StatusCancelled:       {},
	},
	StatusProcessing: {
		StatusSucceeded:       {},
		StatusRetryWait:       {},
		StatusPartialUnknown:  {},
		StatusFailedPermanent: {},
		StatusDeadLetter:      {},
	},
	StatusRetryWait: {
		StatusProcessing:      {},
		StatusFailedPermanent: {},
		StatusDeadLetter:      {},
		StatusCancelled:       {},
	},
	StatusPartialUnknown: {
		StatusProcessing:      {},
		StatusSucceeded:       {},
		StatusFailedPermanent: {},
		StatusDeadLetter:      {},
		StatusCancelled:       {},
	},
	StatusSucceeded:       {},
	StatusFailedPermanent: {},
	StatusDeadLetter:      {},
	StatusCancelled:       {},
}

func (s Status) Valid() bool {
	_, ok := legalTransitions[s]
	return ok
}

func (s Status) Terminal() bool {
	switch s {
	case StatusSucceeded, StatusFailedPermanent, StatusDeadLetter, StatusCancelled:
		return true
	default:
		return false
	}
}

func CanTransition(from Status, to Status) bool {
	if !from.Valid() || !to.Valid() || from == to {
		return false
	}
	_, ok := legalTransitions[from][to]
	return ok
}

func ValidateTransition(from Status, to Status) error {
	if !from.Valid() {
		return fmt.Errorf("%w: source %q", ErrInvalidStatus, from)
	}
	if !to.Valid() {
		return fmt.Errorf("%w: target %q", ErrInvalidStatus, to)
	}
	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %q -> %q", ErrIllegalTransition, from, to)
	}
	return nil
}

// ValidateReplayTransition is deliberately separate from normal worker
// transitions. Only a controlled administrative replay may reopen a terminal
// failed operation, and it must return to pending without changing identity.
func ValidateReplayTransition(from Status, to Status) error {
	if !from.Valid() {
		return fmt.Errorf("%w: source %q", ErrInvalidStatus, from)
	}
	if !to.Valid() {
		return fmt.Errorf("%w: target %q", ErrInvalidStatus, to)
	}
	if to == StatusPending && (from == StatusFailedPermanent || from == StatusDeadLetter) {
		return nil
	}
	return fmt.Errorf("%w: replay %q -> %q", ErrIllegalTransition, from, to)
}
