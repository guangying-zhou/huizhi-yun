package people

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPeopleC1ClosedOperationsAndInputs(t *testing.T) {
	ops := []string{"employees-create", "employees-update", "assignments-create", "assignments-update", "assignments-delete", "assignments-change", "assignments-attach-workflow", "onboarding-list", "onboarding-view", "onboarding-create", "onboarding-update"}
	for _, op := range ops {
		if _, _, ok := FactsPermission(op); !ok {
			t.Fatal(op)
		}
	}
	good := EnterpriseFactsInput{EmployeeUID: "User-A", Payload: map[string]any{"display_name": "姓名", "dept_code": "D-A"}}
	if e := ValidateFactsInput("employees-create", good); e != nil {
		t.Fatal(e)
	}
	masked := good
	masked.Payload = map[string]any{"display_name": "姓名", "cost_center_code": "C"}
	if ValidateFactsInput("employees-create", masked) == nil {
		t.Fatal("unsigned sensitive field allowed")
	}
	masked.SensitiveAllowed = true
	if e := ValidateFactsInput("employees-create", masked); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"approval_status", "source_app", "status", "login_name", "created_by", "sourceRevision", "row_version", "metadata"} {
		i := good
		i.Payload = map[string]any{"display_name": "姓名", field: "approved"}
		if e := ValidateFactsInput("employees-create", i); e == nil {
			t.Fatal("accepted body fact", field)
		}
	}
	for _, uid := range []string{"dt-synthetic", "User A", "../User", "User\n"} {
		i := good
		i.EmployeeUID = uid
		if e := ValidateFactsInput("employees-create", i); e == nil {
			t.Fatal("invalid uid", uid)
		}
	}
	if e := ValidateFactsInput("provision", good); e == nil {
		t.Fatal("c2 operation enabled")
	}
	i := EnterpriseFactsInput{ID: "1", EmployeeUID: "User-A", Payload: map[string]any{"expectedVersion": float64(1), "workflowInstanceId": "1"}}
	if e := ValidateFactsInput("assignments-attach-workflow", i); e != nil {
		t.Fatal(e)
	}
	i.Payload["expectedVersion"] = "1"
	if e := ValidateFactsInput("assignments-attach-workflow", i); e == nil {
		t.Fatal("untyped version")
	}
}
func TestPeopleC1FrozenSnapshotSurvivesProtocolVersionButNotFactChanges(t *testing.T) {
	row := map[string]any{"id": "1", "employee_uid": "User-A", "dept_code": "A", "row_version": int64(1)}
	a, h := AssignmentSnapshot(row, "Actor")
	row["row_version"] = 2
	_, h2 := AssignmentSnapshot(row, "Actor")
	if h != h2 {
		t.Fatal("protocol version changed frozen fact digest")
	}
	row["dept_code"] = "B"
	_, h2 = AssignmentSnapshot(row, "Actor")
	if h == h2 {
		t.Fatal("fact tampering accepted")
	}
	b, _ := json.Marshal(a)
	var decoded map[string]any
	json.Unmarshal(b, &decoded)
	if !reflect.DeepEqual(decoded["requestedBy"], "Actor") {
		t.Fatal("actor missing")
	}
}
