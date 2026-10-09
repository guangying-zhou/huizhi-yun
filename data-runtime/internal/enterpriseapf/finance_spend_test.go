package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"testing"
)

func TestAPF13aClosedOperationsAndInput(t *testing.T) {
	if len(financeSpendOps) != 27 {
		t.Fatal("budget", len(financeSpendOps))
	}
	for _, op := range []string{"expenses-create", "claims-create", "project-requests-create"} {
		p := map[string]any{"currencyCode": "CNY", "projectCode": "P1", "title": "Marked", "items": []any{map[string]any{"description": "Marked", "amount": "10.01"}}}
		if op == "expenses-create" {
			p = map[string]any{"currencyCode": "CNY", "expenseDate": "2026-10-03", "expenseAmount": "10.01"}
		}
		if e := ValidateFinanceSpendInput(op, FinanceInput{Payload: p}); e != nil {
			t.Fatal(op, e)
		}
		for _, k := range []string{"actor", "status", "applicantUid", "handlerUid", "confirmedBy", "workflowInstanceId", "table", "sourceRequestCode"} {
			p[k] = "forged"
			if ValidateFinanceSpendInput(op, FinanceInput{Payload: p}) == nil {
				t.Fatal(op, k)
			}
			delete(p, k)
		}
	}
	for _, v := range []any{nil, []any{}, []any{map[string]any{"description": "Marked", "amount": 1.01}}, []any{map[string]any{"description": "Marked", "amount": "-1"}}, []any{map[string]any{"description": "Marked", "amount": "1.00", "actor": "other"}}} {
		if _, e := spendItems(v); e == nil {
			t.Fatal(v)
		}
	}
	if spendTotal([]any{map[string]any{"description": "A", "amount": "90071992547409.91"}, map[string]any{"description": "B", "amount": "0.01"}}) != "90071992547409.92" {
		t.Fatal("decimal precision")
	}
	for _, actor := range []string{"maker", "handler", ""} {
		if requireSpendDutySeparation(map[string]any{"created_by": "maker", "handler_uid": "handler"}, actor) == nil {
			t.Fatal("separation", actor)
		}
	}
	if requireSpendDutySeparation(map[string]any{"created_by": "maker"}, "cashier") != nil {
		t.Fatal("cashier")
	}
	if spendScope(map[string]any{"applicant_uid": "maker"}, altoc.BasicReadScope{Access: "self"}, "other") {
		t.Fatal("scope leak")
	}
	for _, action := range []string{"claim", "project_expense", "payment"} {
		if !workflowapproval.FinanceRegistered("finance", "expenses", action) {
			t.Fatal(action)
		}
	}
	if workflowapproval.FinanceRegistered("finance", "expenses", "unknown") {
		t.Fatal("13b prematurely enabled")
	}
}

func TestAPF13aExpenseApprovalEightFacts(t *testing.T) {
	for _, action := range []string{"claim", "project_expense", "payment"} {
		f := FrozenFinanceApproval{Resource: "expenses", Action: action, BizID: "CLM1", Actor: "maker", Form: map[string]any{"requestNo": "APF-FIN-marked"}}
		v := workflowapproval.Instance{ID: "31", No: "NO31", App: "finance", Resource: "expenses", Action: action, BizID: "CLM1", Initiator: "maker", CallbackPath: "/api/v1/finance/workflow/callback", Form: f.Form}
		if matchFinanceApprovalInstance(f, &v) != nil {
			t.Fatal("correct")
		}
		for _, change := range []func(*workflowapproval.Instance){func(v *workflowapproval.Instance) { v.ID = "0" }, func(v *workflowapproval.Instance) { v.No = "" }, func(v *workflowapproval.Instance) { v.App = "altoc" }, func(v *workflowapproval.Instance) { v.Resource = "invoices" }, func(v *workflowapproval.Instance) { v.Action = "unknown" }, func(v *workflowapproval.Instance) { v.BizID = "other" }, func(v *workflowapproval.Instance) { v.Initiator = "other" }, func(v *workflowapproval.Instance) { v.CallbackPath += "?" }, func(v *workflowapproval.Instance) { v.Form = map[string]any{"requestNo": "changed"} }} {
			bad := v
			change(&bad)
			if matchFinanceApprovalInstance(f, &bad) == nil {
				t.Fatal("mismatched fact")
			}
		}
	}
}
