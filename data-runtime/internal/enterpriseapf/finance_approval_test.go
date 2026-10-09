package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"testing"
)

func TestAPF11bFinanceApprovalOwningFacts(t *testing.T) {
	f := FrozenFinanceApproval{Resource: "invoices", BizID: "IR1", Actor: "actor", Form: map[string]any{"requestNo": "APF-fixed"}}
	good := workflowapproval.Instance{ID: "31", No: "NO31", App: "finance", Resource: "invoices", Action: "request", BizID: "IR1", Initiator: "actor", CallbackPath: "/api/v1/finance/workflow/callback", Form: f.Form}
	if e := matchFinanceApprovalInstance(f, &good); e != nil {
		t.Fatal(e)
	}
	mutations := []func(*workflowapproval.Instance){func(v *workflowapproval.Instance) { v.ID = "0" }, func(v *workflowapproval.Instance) { v.No = "" }, func(v *workflowapproval.Instance) { v.App = "people" }, func(v *workflowapproval.Instance) { v.Resource = "contract" }, func(v *workflowapproval.Instance) { v.Action = "edit" }, func(v *workflowapproval.Instance) { v.BizID = "2" }, func(v *workflowapproval.Instance) { v.Initiator = "other" }, func(v *workflowapproval.Instance) { v.CallbackPath += "?x=1" }, func(v *workflowapproval.Instance) { v.Form = map[string]any{"requestNo": "other"} }}
	for n, change := range mutations {
		bad := good
		change(&bad)
		if matchFinanceApprovalInstance(f, &bad) == nil {
			t.Fatal("bad owning fact", n)
		}
	}
}

func TestFinanceApprovalRecoveryPayloadClosed(t *testing.T) {
	for _, op := range []string{"invoice-approval-request", "claims-submit", "project-requests-submit", "payment-requests-submit"} {
		good := FinanceInput{Code: "REQUEST-1", Payload: map[string]any{"expectedVersion": float64(2), "phase": "recover"}}
		if e := ValidateFinanceApprovalInput(op, good); e != nil {
			t.Fatal(op, e)
		}
		for _, extra := range []string{"key", "requestNo", "actor", "workflow_instance_id", "approved"} {
			bad := FinanceInput{Code: good.Code, Payload: map[string]any{"expectedVersion": float64(2), "phase": "recover", extra: "forged"}}
			if ValidateFinanceApprovalInput(op, bad) == nil {
				t.Fatal("browser recovery fact", op, extra)
			}
		}
		good.Payload["phase"] = "anything"
		if ValidateFinanceApprovalInput(op, good) == nil {
			t.Fatal("unregistered phase", op)
		}
	}
}
