package integrationoperation

import (
	"fmt"
	"time"
)

type BackoffPolicy struct {
	BaseDelay   time.Duration
	MaxDelay    time.Duration
	JitterRatio float64
}

func DefaultBackoffPolicy() BackoffPolicy {
	return BackoffPolicy{
		BaseDelay:   30 * time.Second,
		MaxDelay:    30 * time.Minute,
		JitterRatio: 0.5,
	}
}

func (p BackoffPolicy) Validate() error {
	if p.BaseDelay <= 0 {
		return fmt.Errorf("base delay must be positive")
	}
	if p.MaxDelay < p.BaseDelay {
		return fmt.Errorf("max delay must be greater than or equal to base delay")
	}
	if p.JitterRatio < 0 || p.JitterRatio > 1 {
		return fmt.Errorf("jitter ratio must be between 0 and 1")
	}
	return nil
}

// Delay returns a deterministic exponential delay for a one-based attempt.
// randomUnit must be in [0, 1] and is supplied by the caller so SQL workers can
// inject a reproducible random source in tests. Jitter only reduces the capped
// delay: ratio 0.5 produces a value in [50%, 100%].
func (p BackoffPolicy) Delay(attempt int, randomUnit float64) (time.Duration, error) {
	if err := p.Validate(); err != nil {
		return 0, err
	}
	if attempt <= 0 {
		return 0, fmt.Errorf("attempt must be positive")
	}
	if randomUnit < 0 || randomUnit > 1 {
		return 0, fmt.Errorf("random unit must be between 0 and 1")
	}

	delay := p.BaseDelay
	for current := 1; current < attempt && delay < p.MaxDelay; current++ {
		if delay > p.MaxDelay/2 {
			delay = p.MaxDelay
			break
		}
		delay *= 2
	}
	if delay > p.MaxDelay {
		delay = p.MaxDelay
	}

	factor := (1 - p.JitterRatio) + p.JitterRatio*randomUnit
	return time.Duration(float64(delay) * factor), nil
}

func (p BackoffPolicy) NextAttemptAt(attempt int, now time.Time, randomUnit float64) (time.Time, error) {
	delay, err := p.Delay(attempt, randomUnit)
	if err != nil {
		return time.Time{}, err
	}
	return now.Add(delay), nil
}
