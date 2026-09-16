package integrationoperation

import (
	"fmt"
	"time"
)

type LeaseState struct {
	Status      Status
	LockedUntil time.Time
}

// ResolveExpiredLease converts an expired processing lease into
// partial_unknown. This is intentionally a pure decision helper; a SQL repo is
// expected to persist the transition with an optimistic status/lease predicate.
func ResolveExpiredLease(state LeaseState, now time.Time) (LeaseState, bool, error) {
	if !state.Status.Valid() {
		return state, false, fmt.Errorf("%w: %q", ErrInvalidStatus, state.Status)
	}
	if state.Status != StatusProcessing || state.LockedUntil.IsZero() || now.Before(state.LockedUntil) {
		return state, false, nil
	}
	if err := ValidateTransition(state.Status, StatusPartialUnknown); err != nil {
		return state, false, err
	}
	state.Status = StatusPartialUnknown
	state.LockedUntil = time.Time{}
	return state, true, nil
}
