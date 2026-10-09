package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"testing"
)

func TestAPFApprovalEightOwningFacts(t *testing.T) {
	f := FrozenAltocApproval{Resource: "quotation", BizID: "1", Actor: "actor", Form: map[string]any{"requestNo": "APF-fixed"}}
	good := workflowapproval.Instance{ID: "31", No: "NO31", App: "altoc", Resource: "quotation", Action: "approve", BizID: "1", Initiator: "actor", CallbackPath: workflowapproval.CallbackPath, Form: f.Form}
	if e := matchApprovalInstance(f, &good); e != nil {
		t.Fatal(e)
	}
	mutations := []func(*workflowapproval.Instance){func(v *workflowapproval.Instance) { v.ID = "0" }, func(v *workflowapproval.Instance) { v.No = "" }, func(v *workflowapproval.Instance) { v.App = "people" }, func(v *workflowapproval.Instance) { v.Resource = "contract" }, func(v *workflowapproval.Instance) { v.Action = "edit" }, func(v *workflowapproval.Instance) { v.BizID = "2" }, func(v *workflowapproval.Instance) { v.Initiator = "other" }, func(v *workflowapproval.Instance) { v.CallbackPath += "?x=1" }, func(v *workflowapproval.Instance) { v.Form = map[string]any{"requestNo": "other"} }}
	for n, change := range mutations {
		bad := good
		change(&bad)
		if matchApprovalInstance(f, &bad) == nil {
			t.Fatal("bad owning fact", n)
		}
	}
	if approvalRequestNo("quotation", "1", "actor", "same", 1) != approvalRequestNo("quotation", "1", "actor", "same", 1) {
		t.Fatal("unstable key")
	}
	if approvalRequestNo("quotation", "1", "actor", "same", 1) == approvalRequestNo("quotation", "1", "actor", "same", 2) {
		t.Fatal("version crosses intent")
	}
}
