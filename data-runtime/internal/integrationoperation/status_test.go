package integrationoperation

import (
	"errors"
	"testing"
)

func TestStatusValidationAndTerminal(t *testing.T) {
	tests := []struct {
		status   Status
		valid    bool
		terminal bool
	}{
		{StatusPending, true, false},
		{StatusProcessing, true, false},
		{StatusRetryWait, true, false},
		{StatusPartialUnknown, true, false},
		{StatusSucceeded, true, true},
		{StatusFailedPermanent, true, true},
		{StatusDeadLetter, true, true},
		{StatusCancelled, true, true},
		{"unknown", false, false},
	}
	for _, test := range tests {
		t.Run(string(test.status), func(t *testing.T) {
			if got := test.status.Valid(); got != test.valid {
				t.Fatalf("Valid() = %v, want %v", got, test.valid)
			}
			if got := test.status.Terminal(); got != test.terminal {
				t.Fatalf("Terminal() = %v, want %v", got, test.terminal)
			}
		})
	}
}

func TestValidateTransition(t *testing.T) {
	legal := [][2]Status{
		{StatusPending, StatusProcessing},
		{StatusProcessing, StatusSucceeded},
		{StatusProcessing, StatusRetryWait},
		{StatusProcessing, StatusPartialUnknown},
		{StatusRetryWait, StatusProcessing},
		{StatusPartialUnknown, StatusSucceeded},
		{StatusPending, StatusCancelled},
	}
	for _, transition := range legal {
		if err := ValidateTransition(transition[0], transition[1]); err != nil {
			t.Errorf("ValidateTransition(%q, %q): %v", transition[0], transition[1], err)
		}
	}

	illegal := [][2]Status{
		{StatusPending, StatusSucceeded},
		{StatusSucceeded, StatusPending},
		{StatusDeadLetter, StatusProcessing},
		{StatusProcessing, StatusProcessing},
	}
	for _, transition := range illegal {
		err := ValidateTransition(transition[0], transition[1])
		if !errors.Is(err, ErrIllegalTransition) {
			t.Errorf("ValidateTransition(%q, %q) error = %v, want ErrIllegalTransition", transition[0], transition[1], err)
		}
	}

	if err := ValidateTransition("bogus", StatusPending); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("invalid source error = %v, want ErrInvalidStatus", err)
	}
}

func TestValidateReplayTransition(t *testing.T) {
	for _, from := range []Status{StatusFailedPermanent, StatusDeadLetter} {
		if err := ValidateReplayTransition(from, StatusPending); err != nil {
			t.Errorf("replay %q -> pending: %v", from, err)
		}
	}
	for _, from := range []Status{StatusSucceeded, StatusCancelled, StatusProcessing, StatusRetryWait} {
		if err := ValidateReplayTransition(from, StatusPending); !errors.Is(err, ErrIllegalTransition) {
			t.Errorf("replay %q -> pending error = %v, want ErrIllegalTransition", from, err)
		}
	}
}
