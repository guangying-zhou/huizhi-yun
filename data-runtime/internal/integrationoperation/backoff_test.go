package integrationoperation

import (
	"testing"
	"time"
)

func TestBackoffDelayExponentialCapAndJitter(t *testing.T) {
	policy := BackoffPolicy{
		BaseDelay:   30 * time.Second,
		MaxDelay:    4 * time.Minute,
		JitterRatio: 0.5,
	}
	tests := []struct {
		attempt    int
		randomUnit float64
		want       time.Duration
	}{
		{1, 1, 30 * time.Second},
		{2, 1, 60 * time.Second},
		{3, 1, 2 * time.Minute},
		{4, 1, 4 * time.Minute},
		{20, 1, 4 * time.Minute},
		{1, 0, 15 * time.Second},
		{4, 0, 2 * time.Minute},
		{2, 0.5, 45 * time.Second},
	}
	for _, test := range tests {
		got, err := policy.Delay(test.attempt, test.randomUnit)
		if err != nil || got != test.want {
			t.Errorf("Delay(%d, %.2f) = (%s, %v), want %s", test.attempt, test.randomUnit, got, err, test.want)
		}
	}
}

func TestBackoffNextAttemptAtUsesInjectedInputs(t *testing.T) {
	policy := BackoffPolicy{BaseDelay: time.Minute, MaxDelay: 10 * time.Minute, JitterRatio: 0}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	got, err := policy.NextAttemptAt(3, now, 0.25)
	want := now.Add(4 * time.Minute)
	if err != nil || !got.Equal(want) {
		t.Fatalf("NextAttemptAt() = (%s, %v), want %s", got, err, want)
	}
}

func TestBackoffRejectsInvalidPolicyAndInputs(t *testing.T) {
	tests := []struct {
		policy  BackoffPolicy
		attempt int
		random  float64
	}{
		{BackoffPolicy{}, 1, 0},
		{BackoffPolicy{BaseDelay: 2 * time.Second, MaxDelay: time.Second}, 1, 0},
		{BackoffPolicy{BaseDelay: time.Second, MaxDelay: time.Second, JitterRatio: 1.1}, 1, 0},
		{BackoffPolicy{BaseDelay: time.Second, MaxDelay: time.Second}, 0, 0},
		{BackoffPolicy{BaseDelay: time.Second, MaxDelay: time.Second}, 1, -0.1},
	}
	for _, test := range tests {
		if _, err := test.policy.Delay(test.attempt, test.random); err == nil {
			t.Errorf("Delay(%#v, %d, %.2f) unexpectedly succeeded", test.policy, test.attempt, test.random)
		}
	}
}
