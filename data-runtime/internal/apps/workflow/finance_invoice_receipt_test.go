package workflow

import "testing"

// 目标页地址的所有权从 Finance 冻结命令转移到 Workflow 接收端（与 Codocs publish
// 一致），转义行为必须保持不变：发票编码含 '/' 时不得逃出目标路径。
func TestFinanceInvoiceWorkflowBizPathEscapesExactCode(t *testing.T) {
	if got, want := financeInvoiceWorkflowBizPath(" IR/42 "), "/finance/invoices/requests/IR%2F42"; got != want {
		t.Fatalf("financeInvoiceWorkflowBizPath() = %q, want %q", got, want)
	}
}

func TestFinanceInvoiceWorkflowCallbackIsFixed(t *testing.T) {
	if financeInvoiceWorkflowCallback != "/finance/api/v1/finance/workflow/callback" {
		t.Fatalf("callback drifted: %q", financeInvoiceWorkflowCallback)
	}
}
