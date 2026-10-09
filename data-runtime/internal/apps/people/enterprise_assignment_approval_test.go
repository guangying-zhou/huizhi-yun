package people

import (
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"testing"
)

func TestIndependentAssignmentBindingMatrix(t *testing.T) {
	row := map[string]any{"assignment_code": "ASN-1", "created_by": "HR", "employee_uid": "Employee", "change_type": "transfer", "effective_from": "2099-01-01"}
	_, hash := AssignmentSnapshot(row, "HR")
	for _, kind := range []string{"valid", "snapshot", "initiator", "biz", "status", "callback", "tuple", "id"} {
		t.Run(kind, func(t *testing.T) {
			v := &workflowapproval.Instance{ID: "1", App: "people", Resource: "assignments", Action: "change", BizID: "ASN-1", Initiator: "HR", Status: "running", CallbackPath: workflowapproval.CallbackPath, Form: map[string]any{"snapshotHash": hash}}
			switch kind {
			case "snapshot":
				v.Form["snapshotHash"] = "other"
			case "initiator":
				v.Initiator = "hr"
			case "biz":
				v.BizID = "other"
			case "status":
				v.Status = "pending"
			case "callback":
				v.CallbackPath = "/other"
			case "tuple":
				v.Resource = "employees"
			case "id":
				v.ID = "2"
			}
			if e := ValidateAssignmentApproval(row, v, "1", "running"); (e == nil) != (kind == "valid") {
				t.Fatal(kind, e)
			}
		})
	}
}
