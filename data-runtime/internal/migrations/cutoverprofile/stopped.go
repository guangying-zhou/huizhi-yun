package cutoverprofile

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ErrRuntimeRunning is returned whenever the Runtime cannot be proven stopped.
var ErrRuntimeRunning = fmt.Errorf("%w: Runtime must be disabled, stopped and not listening", ErrProfile)

// SystemdStopped accepts only explicit disabled/masked and inactive/failed.
func SystemdStopped(enabled, active string) bool {
	e, a := strings.TrimSpace(enabled), strings.TrimSpace(active)
	return (e == "disabled" || e == "masked") && (a == "inactive" || a == "failed")
}

// LaunchdDisabled requires exactly one explicit entry for label.
func LaunchdDisabled(raw, label string) bool {
	matches, disabled := 0, false
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), " => ", 2)
		if len(parts) != 2 || parts[0] != `"`+label+`"` {
			continue
		}
		matches++
		disabled = parts[1] == "disabled" || parts[1] == "true"
	}
	return matches == 1 && disabled
}

// RuntimeStopped proves the configured Runtime service is disabled, not
// running and its listen address refuses connections. Unknown platforms or
// an incomplete profile fail closed; there is no override.
func (p Profile) RuntimeStopped(ctx context.Context) error {
	r := p.Runtime
	if r.Listen == "" {
		return ErrRuntimeRunning
	}
	switch runtime.GOOS {
	case "linux":
		if r.SystemdUnit == "" {
			return ErrRuntimeRunning
		}
		// is-enabled/is-active exit non-zero for disabled/inactive; the
		// printed state is the evidence.
		enabled, _ := exec.CommandContext(ctx, "systemctl", "is-enabled", r.SystemdUnit).Output()
		active, _ := exec.CommandContext(ctx, "systemctl", "is-active", r.SystemdUnit).Output()
		if !SystemdStopped(string(enabled), string(active)) {
			return ErrRuntimeRunning
		}
	case "darwin":
		if r.LaunchdLabel == "" {
			return ErrRuntimeRunning
		}
		domain := fmt.Sprintf("gui/%d", os.Getuid())
		raw, err := exec.CommandContext(ctx, "launchctl", "print-disabled", domain).Output()
		if err != nil || !LaunchdDisabled(string(raw), r.LaunchdLabel) {
			return ErrRuntimeRunning
		}
		out, err := exec.CommandContext(ctx, "launchctl", "print", domain+"/"+r.LaunchdLabel).CombinedOutput()
		if err == nil || !strings.Contains(string(out), "Could not find service") {
			return ErrRuntimeRunning
		}
	default:
		return ErrRuntimeRunning
	}
	if c, err := net.DialTimeout("tcp", r.Listen, time.Second); err == nil {
		c.Close()
		return ErrRuntimeRunning
	}
	return nil
}
