package people

import (
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

// Validate against the current locked People row, including on receipt replay.
func ValidateAssignmentApproval(row map[string]any, v *workflowapproval.Instance, id, status string) error {
	_, hash := AssignmentSnapshot(row, fmt.Sprint(row["created_by"]))
	if v == nil {
		return httperror.New(503, "people_workflow_unavailable", "Workflow unavailable")
	}
	if v.ID != id || !workflowapproval.PeopleRegistered(v.App, v.Resource, v.Action) || v.CallbackPath != workflowapproval.CallbackPath || v.BizID != fmt.Sprint(row["assignment_code"]) || v.Initiator != row["created_by"] || v.Form["snapshotHash"] != hash || v.Status != status {
		return httperror.New(403, "people_workflow_binding_invalid", "Workflow binding invalid")
	}
	return nil
}
