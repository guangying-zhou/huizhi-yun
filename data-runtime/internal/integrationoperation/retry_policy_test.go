package integrationoperation

import (
	"testing"
	"time"
)

func durationPointer(value time.Duration) *time.Duration {
	return &value
}

func retryDecisionInput(classification FailureClassification) RetryDecisionInput {
	first := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	return RetryDecisionInput{
		Classification: classification,
		AttemptCount:   1,
		FirstAttemptAt: first,
		Now:            first.Add(time.Minute),
		RandomUnit:     1,
	}
}

func TestDefaultRetryPolicy(t *testing.T) {
	policy := DefaultRetryPolicy()
	if err := policy.Validate(); err != nil {
		t.Fatalf("default policy invalid: %v", err)
	}
	if policy.MaxAttempts != 8 || policy.MaxElapsed != 24*time.Hour || policy.MaxRetryAfter != time.Hour {
		t.Fatalf("unexpected defaults: %#v", policy)
	}
}

func TestRetryPolicyPermanentAndResolvedDoNotUseRetryAfter(t *testing.T) {
	negative := -time.Hour
	tests := []struct {
		class FailureClass
		want  Status
	}{
		{FailureAuthentication, StatusFailedPermanent},
		{FailureAuthorization, StatusFailedPermanent},
		{FailureContract, StatusFailedPermanent},
		{FailureConflict, StatusFailedPermanent},
		{FailurePermanent, StatusFailedPermanent},
		{FailureIdempotentExisting, StatusSucceeded},
	}
	for _, test := range tests {
		input := RetryDecisionInput{
			Classification: FailureClassification{Class: test.class},
			AttemptCount:   1,
			RetryAfter:     &negative,
		}
		decision, err := DefaultRetryPolicy().Decide(input)
		if err != nil || decision.Status != test.want || decision.Retry || decision.Delay != 0 {
			t.Errorf("Decide(%q) = (%#v, %v), want status=%q without retry", test.class, decision, err, test.want)
		}
	}
}

func TestRetryPolicyThresholdsDeadLetter(t *testing.T) {
	policy := DefaultRetryPolicy()
	input := retryDecisionInput(FailureClassification{Class: FailureTransient})
	input.AttemptCount = policy.MaxAttempts
	decision, err := policy.Decide(input)
	if err != nil || decision.Status != StatusDeadLetter || decision.Reason != RetryReasonAttemptLimit {
		t.Fatalf("attempt threshold = (%#v, %v)", decision, err)
	}

	input = retryDecisionInput(FailureClassification{Class: FailureTransient})
	input.Now = input.FirstAttemptAt.Add(policy.MaxElapsed)
	decision, err = policy.Decide(input)
	if err != nil || decision.Status != StatusDeadLetter || decision.Reason != RetryReasonElapsedLimit {
		t.Fatalf("elapsed threshold = (%#v, %v)", decision, err)
	}
}

func TestRetryPolicyUsesBoundedRetryAfterForTransientOnly(t *testing.T) {
	policy := DefaultRetryPolicy()
	input := retryDecisionInput(FailureClassification{Class: FailureTransient})
	input.RetryAfter = durationPointer(3 * time.Hour)
	decision, err := policy.Decide(input)
	if err != nil || decision.Delay != policy.MaxRetryAfter || !decision.Retry {
		t.Fatalf("bounded Retry-After = (%#v, %v), want %s", decision, err, policy.MaxRetryAfter)
	}

	input.RetryAfter = durationPointer(20 * time.Minute)
	decision, err = policy.Decide(input)
	if err != nil || decision.Delay != 20*time.Minute {
		t.Fatalf("Retry-After = (%#v, %v), want 20m", decision, err)
	}

	input.RetryAfter = durationPointer(-time.Second)
	if _, err := policy.Decide(input); err == nil {
		t.Fatal("negative transient Retry-After unexpectedly accepted")
	}
}

func TestRetryPolicyInProgressUsesShortDelay(t *testing.T) {
	policy := DefaultRetryPolicy()
	classification := ClassifyFailure(FailureInput{HTTPStatus: 409, ConflictDisposition: ConflictInProgress})
	input := retryDecisionInput(classification)
	decision, err := policy.Decide(input)
	if err != nil || decision.Delay != policy.InProgressDelay || decision.Status != StatusRetryWait {
		t.Fatalf("in-progress decision = (%#v, %v)", decision, err)
	}

	input.RetryAfter = durationPointer(45 * time.Second)
	decision, err = policy.Decide(input)
	if err != nil || decision.Delay != 45*time.Second {
		t.Fatalf("in-progress Retry-After precedence = (%#v, %v)", decision, err)
	}
}

func TestRetryPolicyBackoffAmbiguityAndElapsedBoundary(t *testing.T) {
	policy := DefaultRetryPolicy()
	input := retryDecisionInput(FailureClassification{Class: FailureTransient})
	input.AttemptCount = 3
	input.DeliveryUncertain = true
	decision, err := policy.Decide(input)
	if err != nil || decision.Delay != 2*time.Minute || decision.Status != StatusPartialUnknown {
		t.Fatalf("backoff ambiguity = (%#v, %v)", decision, err)
	}

	input = retryDecisionInput(FailureClassification{Class: FailureTransient})
	input.Now = input.FirstAttemptAt.Add(policy.MaxElapsed - 5*time.Second)
	input.RetryAfter = durationPointer(time.Hour)
	decision, err = policy.Decide(input)
	if err != nil || decision.Delay != 5*time.Second || !decision.NextAttemptAt.Equal(input.FirstAttemptAt.Add(policy.MaxElapsed)) {
		t.Fatalf("elapsed boundary cap = (%#v, %v)", decision, err)
	}
}

func TestRetryPolicyRejectsInvalidTransientInputs(t *testing.T) {
	policy := DefaultRetryPolicy()
	tests := []RetryDecisionInput{
		{Classification: FailureClassification{Class: FailureTransient}, AttemptCount: 1},
		func() RetryDecisionInput {
			input := retryDecisionInput(FailureClassification{Class: FailureTransient})
			input.AttemptCount = 0
			return input
		}(),
		func() RetryDecisionInput {
			input := retryDecisionInput(FailureClassification{Class: FailureTransient})
			input.Now = input.FirstAttemptAt.Add(-time.Second)
			return input
		}(),
	}
	for _, input := range tests {
		if _, err := policy.Decide(input); err == nil {
			t.Errorf("Decide(%#v) unexpectedly succeeded", input)
		}
	}
}
