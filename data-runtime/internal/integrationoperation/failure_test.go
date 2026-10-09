package integrationoperation

import (
	"context"
	"errors"
	"testing"
)

type testTimeoutError struct{}

func (testTimeoutError) Error() string { return "timeout" }
func (testTimeoutError) Timeout() bool { return true }

func TestClassifyFailure(t *testing.T) {
	tests := []struct {
		name      string
		input     FailureInput
		wantClass FailureClass
		wantTimed bool
	}{
		{"success", FailureInput{HTTPStatus: 204}, FailureNone, false},
		{"unauthorized", FailureInput{HTTPStatus: 401}, FailureAuthentication, false},
		{"forbidden", FailureInput{HTTPStatus: 403}, FailureAuthorization, false},
		{"deterministic bad request", FailureInput{HTTPStatus: 400}, FailureContract, false},
		{"not found", FailureInput{HTTPStatus: 404}, FailureContract, false},
		{"plain conflict", FailureInput{HTTPStatus: 409}, FailureConflict, false},
		{"explicit permanent conflict", FailureInput{HTTPStatus: 409, ConflictDisposition: ConflictPermanent}, FailureConflict, false},
		{"idempotent existing", FailureInput{HTTPStatus: 409, IdempotentExisting: true}, FailureIdempotentExisting, false},
		{"idempotent existing disposition", FailureInput{HTTPStatus: 409, ConflictDisposition: ConflictIdempotentExisting}, FailureIdempotentExisting, false},
		{"conflict in progress", FailureInput{HTTPStatus: 409, ConflictDisposition: ConflictInProgress}, FailureTransient, false},
		{"request timeout", FailureInput{HTTPStatus: 408}, FailureTransient, false},
		{"too early", FailureInput{HTTPStatus: 425}, FailureTransient, false},
		{"rate limited", FailureInput{HTTPStatus: 429}, FailureTransient, false},
		{"server error", FailureInput{HTTPStatus: 503}, FailureTransient, false},
		{"network error", FailureInput{Err: errors.New("connection reset")}, FailureTransient, false},
		{"deadline", FailureInput{Err: context.DeadlineExceeded}, FailureTransient, true},
		{"net timeout", FailureInput{Err: testTimeoutError{}}, FailureTransient, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ClassifyFailure(test.input)
			if got.Class != test.wantClass || got.TimedOut != test.wantTimed {
				t.Fatalf("ClassifyFailure() = %#v, want class=%q timedOut=%v", got, test.wantClass, test.wantTimed)
			}
			if test.input.ConflictDisposition == ConflictInProgress && got.RetryHint != RetryHintShort {
				t.Fatalf("in-progress RetryHint = %q, want %q", got.RetryHint, RetryHintShort)
			}
		})
	}
}

func TestResolveFailure(t *testing.T) {
	tests := []struct {
		name  string
		input FailureResolutionInput
		want  Status
	}{
		{"existing is success", FailureResolutionInput{Classification: FailureClassification{Class: FailureIdempotentExisting}, AttemptCount: 1, MaxAttempts: 8}, StatusSucceeded},
		{"authentication", FailureResolutionInput{Classification: FailureClassification{Class: FailureAuthentication}, AttemptCount: 1, MaxAttempts: 8}, StatusFailedPermanent},
		{"authorization", FailureResolutionInput{Classification: FailureClassification{Class: FailureAuthorization}, AttemptCount: 1, MaxAttempts: 8}, StatusFailedPermanent},
		{"contract", FailureResolutionInput{Classification: FailureClassification{Class: FailureContract}, AttemptCount: 1, MaxAttempts: 8}, StatusFailedPermanent},
		{"conflict", FailureResolutionInput{Classification: FailureClassification{Class: FailureConflict}, AttemptCount: 1, MaxAttempts: 8}, StatusFailedPermanent},
		{"legacy permanent", FailureResolutionInput{Classification: FailureClassification{Class: FailurePermanent}, AttemptCount: 1, MaxAttempts: 8}, StatusFailedPermanent},
		{"retryable", FailureResolutionInput{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: 1, MaxAttempts: 8}, StatusRetryWait},
		{"ambiguous delivery", FailureResolutionInput{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: 1, MaxAttempts: 8, DeliveryUncertain: true}, StatusPartialUnknown},
		{"max attempts wins over ambiguity", FailureResolutionInput{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: 8, MaxAttempts: 8, DeliveryUncertain: true}, StatusDeadLetter},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ResolveFailure(test.input)
			if err != nil || got != test.want {
				t.Fatalf("ResolveFailure() = (%q, %v), want %q", got, err, test.want)
			}
		})
	}

	invalid := []FailureResolutionInput{
		{Classification: FailureClassification{Class: FailureNone}, AttemptCount: 1, MaxAttempts: 8},
		{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: -1, MaxAttempts: 8},
		{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: 1, MaxAttempts: 0},
	}
	for _, input := range invalid {
		if _, err := ResolveFailure(input); err == nil {
			t.Errorf("ResolveFailure(%#v) unexpectedly succeeded", input)
		}
	}
}
