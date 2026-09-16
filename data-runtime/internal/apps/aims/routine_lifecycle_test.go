package aims

import (
	"errors"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestRoutineProjectStartsActiveWithoutInitiation(t *testing.T) {
	if got := projectInitialLifecycleStatus("routine"); got != "active" {
		t.Fatalf("routine initial lifecycle = %q, want active", got)
	}
	if got := projectInitialLifecycleStatus("custom_dev"); got != "draft" {
		t.Fatalf("custom_dev initial lifecycle = %q, want draft", got)
	}
}

func TestRoutineProjectCannotEnterInitiationApproval(t *testing.T) {
	err := validateProjectInitiationLifecycle("routine", "approval_pending")
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "routine_initiation_not_applicable" {
		t.Fatalf("error = %#v", err)
	}
	if err := validateProjectInitiationLifecycle("routine", "active"); err != nil {
		t.Fatalf("active routine container should pass: %v", err)
	}
	if err := validateProjectInitiationLifecycle("custom_dev", "approval_pending"); err != nil {
		t.Fatalf("custom_dev initiation should pass: %v", err)
	}
}
