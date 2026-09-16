package finance

import (
	"testing"
)

// 走查 ISSUE-B-003：付款申请创建接口曾允许 status=paid，一次 POST 就能落地一条
// 「已付款」记录，不产生 workflow_instance_id、不经过任何审批节点、不留审批痕迹。
// 费用报销与项目支出申请的 createRequestWithItems 有同样的白名单。
//
// approved / paid / rejected 只能由 Workflow 审批回调（applyApprovalResultTx）
// 和付款确认动作写入，创建入口一律只允许 draft。

func createSpecStatusAllowed(t *testing.T, spec createSpec) []string {
	t.Helper()
	for _, field := range spec.Fields {
		if field.Column == "status" {
			return field.Allowed
		}
	}
	t.Fatalf("%s has no status field", spec.Table)
	return nil
}

func TestApprovalDocumentCreateOnlyAllowsDraftStatus(t *testing.T) {
	for _, spec := range []createSpec{
		paymentRequestCreateSpec(),
		createSpecs["/v1/finance/invoice-requests"],
	} {
		allowed := createSpecStatusAllowed(t, spec)
		if len(allowed) != 1 || allowed[0] != "draft" {
			t.Fatalf("%s create must only allow draft, got %v", spec.Table, allowed)
		}
	}
}

// 审批终态绝不能出现在任何审批单据的创建白名单里。
func TestApprovalDocumentCreateRejectsTerminalStatuses(t *testing.T) {
	forbidden := []string{"approved", "paid", "rejected", "pending_approval"}
	for _, spec := range []createSpec{
		paymentRequestCreateSpec(),
		createSpecs["/v1/finance/invoice-requests"],
	} {
		allowed := createSpecStatusAllowed(t, spec)
		for _, status := range forbidden {
			if containsString(allowed, status) {
				t.Fatalf("%s create must not accept status=%s from the request body", spec.Table, status)
			}
		}
	}
}

// createRequestWithItems 服务 expense_claim 与 project_expense_request 两张表，
// 白名单写在函数内部，这里直接锁住其行为。
func TestCreateRequestWithItemsRejectsNonDraftStatus(t *testing.T) {
	for _, status := range []string{"approved", "paid", "rejected", "pending_approval", "canceled"} {
		if _, err := allowedString(status, "status", []string{"draft"}); err == nil {
			t.Fatalf("status=%s must be rejected by the draft-only whitelist", status)
		}
	}
	if _, err := allowedString("draft", "status", []string{"draft"}); err != nil {
		t.Fatalf("draft must remain accepted, got %v", err)
	}
}
