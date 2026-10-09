package integrationoperation

import (
	"testing"
	"time"
)

func TestResolveExpiredLease(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		state       LeaseState
		wantStatus  Status
		wantChanged bool
	}{
		{"before expiry", LeaseState{Status: StatusProcessing, LockedUntil: now.Add(time.Second)}, StatusProcessing, false},
		{"at expiry", LeaseState{Status: StatusProcessing, LockedUntil: now}, StatusPartialUnknown, true},
		{"after expiry", LeaseState{Status: StatusProcessing, LockedUntil: now.Add(-time.Second)}, StatusPartialUnknown, true},
		{"no lease", LeaseState{Status: StatusProcessing}, StatusProcessing, false},
		{"non-processing", LeaseState{Status: StatusRetryWait, LockedUntil: now.Add(-time.Second)}, StatusRetryWait, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, changed, err := ResolveExpiredLease(test.state, now)
			if err != nil || got.Status != test.wantStatus || changed != test.wantChanged {
				t.Fatalf("ResolveExpiredLease() = (%#v, %v, %v), want status=%q changed=%v", got, changed, err, test.wantStatus, test.wantChanged)
			}
			if changed && !got.LockedUntil.IsZero() {
				t.Fatalf("expired lease was not cleared: %s", got.LockedUntil)
			}
		})
	}

	if _, _, err := ResolveExpiredLease(LeaseState{Status: "invalid", LockedUntil: now}, now); err == nil {
		t.Fatal("invalid status unexpectedly succeeded")
	}
}
