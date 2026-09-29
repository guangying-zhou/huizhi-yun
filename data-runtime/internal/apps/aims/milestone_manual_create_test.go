package aims

import (
	"errors"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestManualPeriodicMilestoneCreateRejectedBeforeDatabase(t *testing.T) {
	for _, body := range []map[string]any{
		{"mode": "periodic"},
		{"mode": "periodic", "templateKey": "spoofed-template"},
		{"mode": "periodic", "template_key": "spoofed-template"},
	} {
		_, err := (&Adapter{}).createProjectMilestoneBody(t.Context(), "1", nil, body)
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 400 || denied.Code != "manual_periodic_milestone_forbidden" || denied.Message != "周期里程碑只能通过模板创建" {
			t.Fatalf("body %v: %v", body, err)
		}
	}
}

func TestManualNonPeriodicMilestoneModesRemainAllowed(t *testing.T) {
	for _, body := range []map[string]any{
		{},
		{"mode": "rolling_plan"},
		{"mode": "strong_constraint", "endDate": "2026-09-28"},
	} {
		if err := validateManualMilestoneCreate(body); err != nil {
			t.Fatalf("body %v: %v", body, err)
		}
	}
}
